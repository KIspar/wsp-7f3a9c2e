/** Explicit, resumable live acceptance run. Never runs from normal app startup. */
import fs from 'node:fs';
import path from 'node:path';
import { createDecipheriv, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { createStore } from '../apps/server/store';
import { compilePlan } from '../apps/server/engine';
import { defaultDraft, type Asset, type Draft, type PlanItem } from '../packages/contracts';

const reportDir=path.resolve(process.argv[2] || 'docs/reports/henley-live-20261028');
const connectionDir=process.env.STUDIO_TEST_CONNECTION_DATA;
if(!connectionDir) throw new Error('Set STUDIO_TEST_CONNECTION_DATA to the authorized connection data directory');
const input=JSON.parse(fs.readFileSync(path.join(reportDir,'input.json'),'utf8'));
const workDir=path.join(reportDir,'run-data');
fs.mkdirSync(path.join(reportDir,'inputs'),{recursive:true});fs.mkdirSync(path.join(reportDir,'outputs'),{recursive:true});
const store=createStore(workDir,process.cwd());
const oldDb=new DatabaseSync(path.join(connectionDir,'studio.sqlite'),{readOnly:true});
const oldModel=JSON.parse(oldDb.prepare("SELECT data FROM models WHERE id='tt-image'").get()!.data as string);
const provider=JSON.parse(oldDb.prepare('SELECT data FROM providers WHERE id=?').get(oldModel.providerId)!.data as string);
const head=oldDb.prepare("SELECT credential_id FROM model_credential_heads WHERE model_id='tt-image'").get();
if(!head || provider.protocol!=='chuhe') throw new Error('Missing TT Image credential or unsupported protocol');
const encrypted=oldDb.prepare('SELECT secret FROM model_credentials WHERE id=? AND model_id=?').get(head.credential_id,'tt-image')!.secret as string;
oldDb.close();
const encryptedBuffer=Buffer.from(encrypted,'base64');
const cipher=createDecipheriv('aes-256-gcm',fs.readFileSync(path.join(connectionDir,'.master-key')),encryptedBuffer.subarray(0,12));
cipher.setAuthTag(encryptedBuffer.subarray(12,28));
const key=Buffer.concat([cipher.update(encryptedBuffer.subarray(28)),cipher.final()]).toString('utf8');
if(new URL(provider.baseUrl).origin!=='https://api.lk888.ai') throw new Error('Unexpected provider origin; review destination before live transmission');
const endpoint=(suffix:string)=>provider.baseUrl.replace(/\/$/,'')+(provider.baseUrl.replace(/\/$/,'').endsWith('/v1')?suffix.replace(/^\/v1/,''):suffix);
const manifestPath=path.join(reportDir,'manifest.json');
const manifest:any=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):{startedAt:new Date().toISOString(),productName:input.productName,provider:new URL(provider.baseUrl).origin,model:oldModel.modelId,mode:'real-api-test',execution:'Current skill compilePlan → direct provider adapter; isolated test store, not the application simulator worker',jobs:[]};
function persist(){fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));}
async function importImage(entry:any,index:number,kind:string){
 const name=`${kind}-${index+1}.jpg`,file=path.join(reportDir,'inputs',name);
 if(!fs.existsSync(file)) await sharp(entry.path).extract(entry.crop).jpeg({quality:95}).toFile(file);
 const id=`test-${kind}-${index+1}`,bytes=fs.readFileSync(file);fs.copyFileSync(file,path.join(workDir,'media',`${id}.jpg`));
 store.put('asset',id,{id,url:`/media/${id}.jpg`,type:'image',mime:'image/jpeg',bytes:bytes.length,source:'upload',createdAt:new Date().toISOString()} satisfies Asset);
 return id;
}
const competitors=await Promise.all(input.competitors.map((entry:any,i:number)=>importImage(entry,i,'competitor')));
const products=await Promise.all(input.products.map((entry:any,i:number)=>importImage(entry,i,'product')));
const productTruth='商品只以产品图为准：咖棕色，通身麦穗/人字纹理，短立领亨利领，前中三粒纽扣短门襟，长袖宽松落肩；不能改成拉链、翻领、V领或纯平面针织，不能沿用同行衣服的结构。禁止新增Logo，不编造面料成分、尺码数值、功效和品牌信息。';
const draft=(id:string)=>defaultDraft(store.skills().find(s=>s.id===id)!,store.models());
const definitions:{name:string;skillId:string;draft:Draft}[]=[];
const general=draft('image-generate');general.inputRoles={product:products,reference:[]};general.requirements=`产品为${input.productName}。${productTruth}生成一张干净的男性上身电商主图，人物为成年男性，自然站姿，现代简约室内暖灰背景，腰部以上中景，写实服装摄影，主体完整，无文案。`;
definitions.push({name:'01-general',skillId:'image-generate',draft:general});
const replica=draft('scene-recreate');replica.inputRoles={product:products,reference:[competitors[3]]};replica.requirements=`${productTruth}产品图为前三张，最后一张是构图参照。复刻参照的俯拍穿搭平铺、暖米色地毯和柔和光线，将白色夹克替换为咖棕色亨利领长袖T恤，不保留原夹克的拉链/翻领/抽绳/印字。以平铺方式完整展示新品，搭配深棕阔腿裤、无明显品牌运动鞋、头戴耳机。不要模特、手机UI、边框和广告文案。`;
definitions.push({name:'02-replica',skillId:'scene-recreate',draft:replica});
const detail=draft('detail-design');detail.inputRoles={product:products};detail.fields.productName=input.productName;detail.fields.sellingPoints='咖棕色；可见麦穗纹理；三粒扣亨利立领；长袖、宽松落肩。只使用这些可见特征，不推断面料成分、克重、尺码和功能。';detail.requirements=`${productTruth}统一为简约美式男装电商详情，咖棕与米白色系，成年男模，商品同款同色。屏内只使用简短准确中文标题，不出现价格、虚构标识、参数表。`;
detail.imageDesign!.screens=[{id:'hero',type:'首屏主视觉',requirements:'成年男模正面半身，突出领口三扣和整体版型；标题“麦穗纹亨利领”。',facts:''},{id:'selling',type:'核心卖点图',requirements:'突出可见麦穗纹与宽松落肩，保持真实款式；标题“纹理有型 · 从容穿搭”。',facts:''},{id:'closeup',type:'商品细节图',requirements:'近景展示亨利领、三粒扣、门襟和织物纹理；标题“亨利领 · 三粒扣”。',facts:''}];
definitions.push({name:'03-detail',skillId:'detail-design',draft:detail});
const edit=draft('image-edit');edit.inputRoles={targets:[products[1]],reference:[products[0],products[2]]};edit.selectedTargetIds=[products[1]];edit.imageDesign!.bindings=[{assetId:products[1],number:1},{assetId:products[0],number:2},{assetId:products[2],number:3}];edit.imageDesign!.nextNumber=4;edit.requirements=`图1是待编辑图，图2和图3仅用于核对衣服。保留图1的成年男模身份、眼镜、发型、姿态和完整衣服，只把室内走廊背景替换为干净米灰色摄影棚背景，自然光，去除画面边框。${productTruth}参考图2/图3核对纹理和领口，不将辅助图人物加入画面，无文案。`;
definitions.push({name:'04-edit',skillId:'image-edit',draft:edit});
const outfit=draft('model-outfit');outfit.inputRoles={product:products,targets:[competitors[2]]};outfit.selectedTargetIds=[competitors[2]];outfit.fields.targetDescription='双栏画面中的同一位成年男模身上的黑色拉链上衣，两栏均需要替换';outfit.requirements=`${productTruth}前三张为产品，最后一张为模特目标。保持同行双栏构图、男模身份、发型、眼镜、姿态、室内场景、阔腿裤与配饰，只将两栏黑色拉链上衣替换为商品同款咖棕色亨利领三粒扣长袖T恤。两栏衣服必须一致，去掉原拉链，保留新品麦穗纹。无手机UI、无边框、无新增文案。`;
definitions.push({name:'05-outfit',skillId:'model-outfit',draft:outfit});

async function request(suffix:string,body?:unknown){
 let response:Response;
 try{response=await fetch(endpoint(suffix),{method:body?'POST':'GET',headers:{Authorization:`Bearer ${key}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(body?180000:30000),redirect:'error'});}
 catch{throw new Error(body?'SUBMISSION_UNKNOWN: response missing; do not resubmit':'Status connection failed; resume polling existing task');}
 const json:any=await response.json().catch(()=>({}));
 if(!response.ok){const description=String(json.message||json.error?.message||json.error||'').replaceAll(key,'[redacted]').slice(0,500);throw new Error(`${body&&response.status>=500?'SUBMISSION_UNKNOWN: ':''}HTTP ${response.status}: ${description}`);}
 return json;
}
async function runItem(name:string,item:PlanItem){
 let job=manifest.jobs.find((j:any)=>j.name===name);
 if(job?.state==='completed')return;
 if(job&&['submitting','unknown'].includes(job.state)&&!job.upstreamId)throw new Error(`${name}: submission unresolved; manual reconciliation required, no automatic resubmission`);
 if(job?.state==='failed')throw new Error(`${name}: prior confirmed failure; no automatic paid retry`);
 if(!job){
  const params:any={...item.parameters,aspect_ratio:item.parameters.aspectRatio};delete params.aspectRatio;
  const images=item.references.map(id=>{const a=store.get<Asset>('asset',id)!;return `data:${a.mime};base64,${fs.readFileSync(path.join(workDir,'media',path.basename(a.url))).toString('base64')}`;});
  params.images=images;
  job={name,state:'submitting',submittedAt:new Date().toISOString(),prompt:item.prompt,parameters:{...params,images:item.references},references:item.references,groupIndex:item.groupIndex,screenId:item.screenId,skillModelSnapshot:item.model};manifest.jobs.push(job);persist();
  console.log(`Submitting ${name} (${images.length} references, ${params.resolution})`);
  try{const raw=await request('/v1/media/generate',{model:oldModel.modelId,prompt:item.prompt,params});const d=raw.data??raw;const tid=d.task_id??d['任务ids']?.[0];if(tid===undefined||tid===null)throw new Error('SUBMISSION_UNKNOWN: missing task id');job.upstreamId=String(tid);job.state='running';persist();console.log(`Accepted ${name}, task ${job.upstreamId}`);}
  catch(error){job.state=String(error).includes('SUBMISSION_UNKNOWN')?'unknown':'failed';job.error=(error as Error).message;persist();throw error;}
 }
 const deadline=Date.now()+20*60_000;
 while(Date.now()<deadline){
  const raw=await request(`/v1/media/status?task_id=${encodeURIComponent(job.upstreamId)}`);const d=raw.data??raw;
  job.lastCheckedAt=new Date().toISOString();job.providerState=d.state;job.progress=d.progress;job.cost=typeof d.cost==='number'?d.cost:null;
  if(d.state==='failed'&&d.is_final===true){job.state='failed';job.error=String(d.error||'Provider failed').replaceAll(key,'[redacted]');persist();throw new Error(`${name}: ${job.error}`);}
  if(d.state==='success'&&d.is_final===true){
   job.state='downloading';persist();if(typeof d.result_url!=='string')throw new Error('Final success has no result URL');
   const remote=new URL(d.result_url);if(remote.protocol!=='https:')throw new Error('Result URL must use HTTPS');
   const response=await fetch(remote,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error(`Download HTTP ${response.status}`);
   const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>40*1024*1024)throw new Error('Output exceeds40MB');
   const meta=await sharp(bytes,{limitInputPixels:40_000_000}).metadata();if(!meta.width||!meta.height)throw new Error('Output is not a readable image');
   const filename=`${name}.${meta.format==='jpeg'?'jpg':meta.format}`;fs.writeFileSync(path.join(reportDir,'outputs',filename),bytes);
   Object.assign(job,{state:'completed',output:`outputs/${filename}`,width:meta.width,height:meta.height,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),completedAt:new Date().toISOString(),resultOrigin:remote.origin});persist();console.log(`Completed ${name}: ${meta.width}x${meta.height}, provider cost=${job.cost??'unknown'}`);return;
  }
  if(!['pending','running','success','failed'].includes(d.state))throw new Error('Unrecognized upstream status; existing ID preserved');
  persist();await new Promise(resolve=>setTimeout(resolve,5000));
 }
 throw new Error(`${name}: polling timed out; upstream ID saved, resume without resubmission`);
}
try{
 for(const def of definitions){
  const plan=compilePlan(store,def.skillId,def.draft);
  fs.writeFileSync(path.join(reportDir,`${def.name}-plan.json`),JSON.stringify({skillId:def.skillId,draft:def.draft,plan},null,2));
  for(const item of plan.items)await runItem(`${def.name}-${item.index}`,item);
 }
 manifest.finishedAt=new Date().toISOString();persist();console.log('All five feature API tests completed.');
}catch(error){manifest.stoppedAt=new Date().toISOString();manifest.stopReason=(error as Error).message;persist();console.error(manifest.stopReason);process.exitCode=1;}
finally{store.close();}
