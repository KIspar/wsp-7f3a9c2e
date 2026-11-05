import { afterEach,beforeEach,describe,it,expect,vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { createStore,type Store } from '../apps/server/store';
import { createAnalysisService } from '../apps/server/analysis';
import { credentialVault } from '../apps/server/credentials';
import { analysisPreview,probeVideo } from '../apps/server/analysis-media';
import { createApp } from '../apps/server/app';
import { compilePlan,submit } from '../apps/server/engine';
import { defaultDraft,type Asset } from '../packages/contracts';
import type { AnalysisInput,AnalysisJob } from '../packages/analysis';
let store:Store,dir:string;
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-analysis-'));store=createStore(dir,process.cwd());});
afterEach(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
const request=(patch:Partial<AnalysisInput>={}):AnalysisInput=>({action:'polish',text:'保留产品纹理',productName:'测试商品',assetIds:[],idempotencyKey:crypto.randomUUID(),...patch});
const tt=(text='棕色纽扣纹理',tokens=500)=>new Response(JSON.stringify({choices:[{message:{content:text}}],usage:{prompt_tokens:tokens,completion_tokens:30,total_tokens:tokens+30}}),{headers:{'X-Task-Id':'platform-id'}});
const billing=()=>new Response(JSON.stringify({data:{state:'success',cost:0.001,input_tokens:500,output_tokens:30}}));
const keyTT='sk-test-tt-12345678901234567890',keyGEM='sk-test-gem-12345678901234567890';
function service(transport=vi.fn(async(url:string,_init:RequestInit)=>url.includes('task-status')?billing():tt())){const s=createAnalysisService(store,transport);s.configure('tt-6.1-sol',{key:keyTT});s.configure('gem-3.8-flash',{key:keyGEM});return s;}
async function finish(s:ReturnType<typeof service>){s.tick();await s.idle();}
function image(){return store.list<Asset>('asset').find(a=>a.type==='image')!;}
describe('optional persistent analysis',()=>{
 it.each([true,false])('uses saved forced calling %s for congested chat estimates and submission checks',async forced=>{
  const transport=vi.fn(async(url:string,init:RequestInit)=>{
   if(url.endsWith('/balance'))return Response.json({balance:10,unit:'算力',api_key_quota:{limit:0,used:0}});
   if(url.endsWith('/key'))return Response.json({id:1,name:'test',status:1,strategy:'自定义',limit:0,used:0,api_edit_allowed:false,custom_groups_in_effect:true,custom_groups:[{model:'tt-6.1-sol',group_ids:['test'],force_group_ids:forced?['test']:[],groups:[{group_id:'test',group_name:'test',status:'offline'}]}]});
   if(url.includes('/pricing'))return Response.json({available_for_this_key:false,channel_groups:[{group_id:'test',group_name:'test',is_active:false,in_key_whitelist:true,excluded_for_this_key:false,input_token_price:1,output_token_price:2}]});
   if(url.includes('task-status'))return billing();
   expect(init.method).toBe('POST');return tt();
  });
  const s=service(transport);
  if(forced)expect(await s.estimate()).toMatchObject({estimated:.016192,affordable:true});
  else await expect(s.estimate()).rejects.toThrow('没有可用计费线路');
  const job=s.submit(request({maximumCost:.1}));await finish(s);
  expect(s.job(job.id).status).toBe(forced?'completed':'failed');
  expect(transport.mock.calls.filter(([,init])=>init.method==='POST')).toHaveLength(forced?1:0);
 });
 it('validates visual planning slots, saves structured output and refuses mismatched billed results',async()=>{
  let slot='kit-selling-1';
  const transport=vi.fn(async(url:string,_init:RequestInit)=>{
   if(url.includes('/balance'))return Response.json({balance:10,unit:'算力',api_key_quota:{limit:0,used:0}});
   if(url.includes('/pricing'))return Response.json({available_for_this_key:true,channel_groups:[{group_id:'test',group_name:'test',is_active:true,in_key_whitelist:true,excluded_for_this_key:false,input_token_price:1,output_token_price:2}]});
   if(url.includes('task-status'))return billing();
   return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({schemaVersion:1,visibleFeatures:['领口'],providedFacts:[],missing:['面料'],style:'自然光',suggestion:'展示细节',slots:[{id:slot,theme:'领口展示',evidence:'商品图可见',requirements:'领口近景'}]})}]}}],usageMetadata:{promptTokenCount:200,candidatesTokenCount:20,totalTokenCount:220}},{headers:{'X-Task-Id':'visual-test-task'}});
  });
  const s=service(transport);s.setDefault('gem-3.8-flash');
  const input={action:'visual-planning' as const,text:JSON.stringify({slots:[{id:'kit-selling-1'}]}),assetIds:[image().id]};
  expect(()=>s.submit(request({...input,assetIds:[]}))).toThrow('1–4');
  expect(()=>s.submit(request({...input,text:'{}'}))).toThrow('输出位置');
  expect((await s.estimate()).affordable).toBe(true);
  const first=s.submit(request(input));await finish(s);expect(s.job(first.id).status).toBe('completed');
  slot='unrequested-slot';const second=s.submit(request(input));await finish(s);
  expect(s.job(second.id)).toMatchObject({status:'failed'});expect(s.job(second.id).result).toContain('unrequested-slot');
  expect(transport.mock.calls.filter(c=>c[1].method==='POST')).toHaveLength(2);
 });
 it('keeps ordinary generation independent and defaults to TT',()=>{
  const transport=vi.fn(),s=service(transport);expect(s.settings().defaultModelId).toBe('tt-6.1-sol');
  const skill=store.skills().find(s=>s.id==='image-generate')!,draft={...defaultDraft(skill,store.models()),requirements:'普通生成'};const plan=compilePlan(store,skill.id,draft,'generate');
  submit(store,{skillId:skill.id,draft,action:'generate',planHash:plan.hash,expectedDraftRevision:0,idempotencyKey:crypto.randomUUID()});expect(s.jobs()).toHaveLength(0);expect(transport).not.toHaveBeenCalled();
 });
 it('uses immutable model and credential snapshots and idempotent submission across setting changes',async()=>{
  const transport=vi.fn(async(url:string,_init:RequestInit)=>url.includes('task-status')?billing():tt());const s=service(transport),input=request();const first=s.submit(input);s.setDefault('gem-3.8-flash');s.configure('tt-6.1-sol',{key:'sk-rotated-tt-12345678901234567890',enabled:false});
  expect(s.submit(input).id).toBe(first.id);expect(()=>s.submit({...input,text:'不同内容'})).toThrow('凭据');await finish(s);
  expect(transport.mock.calls[0][0]).toContain('/v1/chat/completions');expect((transport.mock.calls[0][1].headers as any).Authorization).toBe('Bearer '+keyTT);expect(s.job(first.id).model.name).toBe('TT-6.1 sol');
  expect(s.submit(request()).model.id).toBe('gem-3.8-flash');
 });
 it('never retries unknown paid submissions, including restart recovery',async()=>{
  const transport=vi.fn(async()=>{throw new Error('secret upstream text');}),s=service(transport),first=s.submit(request());await finish(s);expect(s.job(first.id).status).toBe('unknown');expect(JSON.stringify(s.jobs())).not.toContain('secret upstream');
  s.recover();await finish(s);expect(transport).toHaveBeenCalledTimes(1);
  const second=s.submit(request());store.put('analysis-job',second.id,{...second,status:'submitting'});s.recover();expect(s.job(second.id).status).toBe('unknown');await finish(s);expect(transport).toHaveBeenCalledTimes(1);
 });
 it('requeues preparation safely but not submission',async()=>{
  const s=service(),j=s.submit(request());store.put('analysis-job',j.id,{...j,status:'preparing'});s.recover();expect(s.job(j.id).status).toBe('queued');await finish(s);expect(s.job(j.id).status).toBe('completed');
 });
 it('holds TT image calls until content, tokens and final cost pass the small probe',async()=>{
  const s=service(),asset=image();expect(()=>s.submit(request({assetIds:[asset.id]}))).toThrow('阻止');
  const j=s.submit(request({action:'verify-image',assetIds:[asset.id],verificationModel:'tt-6.1-sol',expectedTerms:['棕','纽扣','纹理']}));await finish(s);
  expect(s.models().find(m=>m.id==='tt-6.1-sol')!.vision.status).toBe('passed');const saved=s.job(j.id);expect(saved.preview!.bytes).toBeLessThanOrEqual(48*1024);expect(Math.max(saved.preview!.width,saved.preview!.height)).toBeLessThanOrEqual(512);
  expect(s.submit(request({assetIds:[asset.id]})).status).toBe('queued');
 });
 it.each(['high','missing','wrong','cost'] as const)('blocks vision on %s verification failure without blocking text',async failure=>{
  const transport=vi.fn(async(url:string,_init:RequestInit)=>{
   if(url.includes('task-status')){if(failure==='cost')return new Response('{}',{status:503});return billing();}
   if(failure==='missing')return new Response(JSON.stringify({choices:[{message:{content:'棕色纽扣纹理'}}]}));return tt(failure==='wrong'?'无法辨认':'棕色纽扣纹理',failure==='high'?9000:500);
  });const s=service(transport),asset=image();const j=s.submit(request({action:'verify-image',assetIds:[asset.id],verificationModel:'tt-6.1-sol',expectedTerms:['棕','纽扣']}));await finish(s);
  expect(s.models().find(m=>m.id==='tt-6.1-sol')!.vision.status).toBe('failed');expect(s.job(j.id).result).toBeTruthy();expect(()=>s.submit(request({assetIds:[asset.id]}))).toThrow('阻止');expect(s.submit(request()).status).toBe('queued');
 });
 it('preserves completed results during failed billing and allows cost-only recovery',async()=>{
  let failCost=true;const transport=vi.fn(async(url:string,_init:RequestInit)=>url.includes('task-status')?(failCost?new Response('{}',{status:502}):billing()):tt());const s=service(transport),j=s.submit(request());await finish(s);expect(s.job(j.id).status).toBe('completed');expect(s.job(j.id).billing.error).toBeTruthy();failCost=false;await s.reconcile(j.id);expect(s.job(j.id).billing.cost).toBe(.001);expect(transport.mock.calls.filter(c=>c[1].method==='POST')).toHaveLength(1);
 });
 it('automatically rechecks pending task settlement without resending the paid request',async()=>{
  let checks=0;const transport=vi.fn(async(url:string,_init:RequestInit)=>url.includes('task-status')?++checks===1?new Response(JSON.stringify({data:{state:'running',status:'processing',is_final:false}})):new Response(JSON.stringify({data:{state:'success',status:'completed',is_final:true,cost:.004,input_tokens:300,output_tokens:80}})):tt());
  const s=service(transport),j=s.submit(request());await finish(s);expect(s.job(j.id).billing.status).toBe('pending');
  const pending=s.job(j.id);store.put('analysis-job',j.id,{...pending,billing:{...pending.billing,nextPollAt:new Date(0).toISOString()}});s.tick();await s.idle();
  expect(checks).toBe(2);expect(s.job(j.id).billing).toMatchObject({status:'final',cost:.004,inputTokens:300,outputTokens:80});expect(transport.mock.calls.filter(c=>c[1].method==='POST')).toHaveLength(1);
 });
 it('prepares all 4 originals in one numbered contact sheet with strict size limits',async()=>{
  const assets=store.list<Asset>('asset').slice(0,4),original=assets.map(a=>a.bytes);const preview=await analysisPreview(store,assets,false);expect(preview!.bytes).toBeLessThanOrEqual(128*1024);expect(Math.max(preview!.width,preview!.height)).toBeLessThanOrEqual(1024);expect((await sharp(preview!.buffer).metadata()).format).toBe('jpeg');expect(assets.map(a=>a.bytes)).toEqual(original);
  const s=service();expect(()=>s.submit(request({assetIds:[...assets.map(a=>a.id),'fifth']}))).toThrow();
 });
 it('sends GEM images and native video through inline_data and excludes thought parts',async()=>{
  const transport=vi.fn(async(url:string,_init:RequestInit)=>url.includes('task-status')?billing():new Response(JSON.stringify({candidates:[{content:{parts:[{thought:true,text:'private thought'},{text:'## 镜头分析\n[00:00-00:04] 主体动作：物体移动。场景：白色。构图：中央。运镜：固定。可辨识文案：无。分镜提示词：动态展示。\n## 整片提示词\n动态展示'}]}}],usageMetadata:{promptTokenCount:200,candidatesTokenCount:20,totalTokenCount:220}}),{headers:{'X-Task-Id':'gem-platform-id'}}));
  const s=service(transport);s.setDefault('gem-3.8-flash');const pic=s.submit(request({assetIds:[image().id]}));await finish(s);expect(s.job(pic.id).result).not.toContain('private thought');
  let body=JSON.parse(transport.mock.calls.find(c=>c[1].method==='POST')![1].body as string);expect(body.contents[0].parts[1].inline_data.mime_type).toBe('image/jpeg');expect(body.attachments).toBeUndefined();
  const filename='demo-portrait-4.mp4',asset:Asset={id:'video-fixture',url:'/examples/'+filename,source:'example',mime:'video/mp4',type:'video',bytes:fs.statSync('public/examples/'+filename).size,createdAt:new Date().toISOString()};store.put('asset',asset.id,asset);
  const video=s.submit(request({action:'reverse-video',assetIds:[asset.id]}));await finish(s);expect(s.job(video.id).status).toBe('completed');body=JSON.parse(transport.mock.calls.filter(c=>c[1].method==='POST').at(-1)![1].body as string);expect(body.contents[0].parts[1].inline_data.mime_type).toBe('video/mp4');expect(Buffer.from(body.contents[0].parts[1].inline_data.data,'base64')).toEqual(fs.readFileSync('public/examples/'+filename));
 });
 it('routes video reverse to GEM 4 argon when the new model is configured',async()=>{
  const transport=vi.fn(async(url:string,_init:RequestInit)=>url.includes('task-status')?billing():new Response(JSON.stringify({candidates:[{content:{parts:[{text:'## 镜头分析\n[00:00-00:04] 主体动作：移动。场景：室内。构图：中央。运镜：固定。可辨识文案：无。分镜提示词：展示。\n## 整片提示词\n展示'}]}}],usageMetadata:{promptTokenCount:200,candidatesTokenCount:20,totalTokenCount:220}}),{headers:{'X-Task-Id':'argon-task'}}));
  const s=service(transport);s.configure('gem-4-argon',{key:keyGEM});const asset=store.list<Asset>('asset').find(a=>a.type==='video')||(()=>{const a:Asset={id:'argon-video',url:'/examples/demo-portrait-4.mp4',source:'example',mime:'video/mp4',type:'video',bytes:fs.statSync('public/examples/demo-portrait-4.mp4').size,createdAt:new Date().toISOString()};store.put('asset',a.id,a);return a;})();
  const j=s.submit(request({action:'reverse-video',assetIds:[asset.id]}));await finish(s);const post=transport.mock.calls.find(c=>c[1].method==='POST')!;expect(post[0]).toContain('/v1beta/models/gem-4-argon:generateContent');expect(s.job(j.id).model.id).toBe('gem-4-argon');
 });
 it('rejects missing or disabled credentials and wrong media before calling',async()=>{
  const s=createAnalysisService(store);expect(()=>s.submit(request())).toThrow('密钥');s.configure('tt-6.1-sol',{key:keyTT,enabled:false});expect(()=>s.submit(request())).toThrow('禁用');expect(()=>s.setDefault('gem-3.8-flash')).toThrow('密钥');
  const invalid=path.join(dir,'fake.mp4');fs.writeFileSync(invalid,'not a video');await expect(probeVideo(invalid)).rejects.toThrow();
 });
 it('limits analysis execution to one paid request at a time',async()=>{
  let release!:(value:Response)=>void;
  const transport=vi.fn((url:string,_init:RequestInit):Promise<Response>=>url.includes('task-status')?Promise.resolve(billing()):new Promise(resolve=>{release=resolve;}));
  const s=service(transport);s.submit(request());s.submit(request());s.tick();s.tick();
  await vi.waitFor(()=>expect(transport).toHaveBeenCalledTimes(1));expect(s.jobs().filter(j=>j.status==='submitting')).toHaveLength(1);expect(s.jobs().filter(j=>j.status==='queued')).toHaveLength(1);
  release(tt());await s.idle();s.tick();await vi.waitFor(()=>expect(transport.mock.calls.filter(c=>c[1].method==='POST')).toHaveLength(2));release(tt());await s.idle();expect(s.jobs().every(j=>j.status==='completed')).toBe(true);
 });
 it.each([400,502])('does not replay HTTP %s and keeps provider details out of snapshots',async status=>{
  const transport=vi.fn(async()=>new Response(JSON.stringify({error:'sk-private-value-must-not-leak'}),{status}));const s=service(transport),j=s.submit(request());await finish(s);expect(s.job(j.id).status).toBe(status===400?'failed':'unknown');expect(JSON.stringify(s.jobs())).not.toContain('private-value');await finish(s);expect(transport).toHaveBeenCalledTimes(1);
 });
 it('retains malformed/empty response state and rejects fabricated video time ranges',async()=>{
  const transport=vi.fn(async(url:string,_init:RequestInit)=>url.includes('task-status')?billing():new Response('invalid json',{headers:{'X-Task-Id':'malformed-task'}}));const s=service(transport),j=s.submit(request());await finish(s);expect(s.job(j.id).status).toBe('failed');expect(s.job(j.id).upstreamTaskId).toBe('malformed-task');expect(s.job(j.id).billing.status).toBe('final');
 });
 it('preserves explicit image numbering when selecting a subset and rejects mismatched numbers',async()=>{
  const transport=vi.fn(async(url:string,_init:RequestInit)=>url.includes('task-status')?billing():new Response(JSON.stringify({candidates:[{content:{parts:[{text:'图3与图7'}]}}],usageMetadata:{promptTokenCount:200,candidatesTokenCount:20,totalTokenCount:220}}),{headers:{'X-Task-Id':'numbered-task'}}));const s=service(transport);s.setDefault('gem-3.8-flash');const assets=store.list<Asset>('asset').slice(0,2);const j=s.submit(request({assetIds:assets.map(a=>a.id),imageNumbers:[3,7]}));await finish(s);const body=JSON.parse(transport.mock.calls.find(c=>c[1].method==='POST')![1].body as string);expect(body.contents[0].parts[0].text).toContain('3、7');expect(s.job(j.id).input.imageNumbers).toEqual([3,7]);expect(()=>s.submit(request({assetIds:assets.map(a=>a.id),imageNumbers:[3]}))).toThrow('编号');
 });
 it('rejects videos above real duration/size limits without paid submission',async()=>{
  const source=fs.readFileSync('public/examples/demo-portrait-4.mp4'),overlong=Buffer.from(source),offset=source.indexOf(Buffer.from('mvhd'));
  expect(overlong[offset+4]).toBe(0);overlong.writeUInt32BE(121*overlong.readUInt32BE(offset+16),offset+20);
  const longFile=path.join(dir,'long.mp4');fs.writeFileSync(longFile,overlong);await expect(probeVideo(longFile)).rejects.toThrow('120 秒');
  const hugeFile=path.join(dir,'huge.mp4');fs.writeFileSync(hugeFile,source);fs.truncateSync(hugeFile,30*1024*1024+1);await expect(probeVideo(hugeFile)).rejects.toThrow('30MB');
  const transport=vi.fn(),s=service(transport);const invalid:Asset={id:'oversize',url:'/media/long.mp4',source:'upload',type:'video',mime:'video/mp4',bytes:overlong.length,createdAt:new Date().toISOString()};fs.copyFileSync(longFile,path.join(dir,'media/long.mp4'));store.put('asset',invalid.id,invalid);
  const j=s.submit(request({action:'reverse-video',assetIds:[invalid.id]}));await finish(s);expect(s.job(j.id).status).toBe('failed');expect(transport).not.toHaveBeenCalled();
 });
 it('encrypts isolated versioned credentials and never exposes them in API or ordinary backup',async()=>{
  const s=service();const a=credentialVault(dir);expect(()=>a.get('gem-3.8-flash',a.current('tt-6.1-sol')!)).toThrow();
  expect(fs.readFileSync(path.join(dir,'private/credentials.json'),'utf8')).not.toContain(keyTT);expect(fs.statSync(path.join(dir,'private/master.key')).mode&0o777).toBe(0o600);
  const app=await createApp(store,{worker:false});try{const config=await app.inject('/api/analysis/config');expect(config.body).not.toContain('sk-');expect(config.json().models[0].credentialConfigured).toBe(true);const zip=await app.inject('/api/backup');expect(zip.statusCode).toBe(200);fs.writeFileSync(path.join(dir,'backup.zip'),zip.rawPayload);const {execFileSync}=await import('node:child_process');const names=execFileSync('unzip',['-Z1',path.join(dir,'backup.zip')]).toString();expect(names).not.toContain('private');expect(names).not.toContain('master.key');expect(names).not.toContain('credentials.json');}finally{await app.close();}
  expect(JSON.stringify(s.jobs())).not.toContain(keyTT);
 });
});
