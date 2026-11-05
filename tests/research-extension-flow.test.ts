import {afterEach,beforeEach,describe,it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {researchHarness,type ResearchHarness} from './support/research-harness';
import {normalizeDouyinUrl} from '../apps/server/research-extension';

let h:ResearchHarness;
const origin='chrome-extension://'+'a'.repeat(32),other='chrome-extension://'+'b'.repeat(32);
beforeEach(async()=>{h=await researchHarness();});
afterEach(async()=>{await h.close();});
async function pair(o=origin){const code=(await h.request('POST','/api/research-extension-code',{})).json().code;const r=await h.app.inject({method:'POST',url:'/api/research-extension/pair',headers:{origin:o},payload:{code}});expect(r.statusCode,r.body).toBe(200);return r.json().token as string;}
const ext=(method:string,url:string,token:string,payload?:any,o=origin)=>h.app.inject({method:method as any,url:'/api/research-extension'+url,headers:{origin:o,'x-research-token':token},...(payload===undefined?{}:{payload})});
async function job(){await h.request('PUT',`/api/catalog/products/${h.product.id}/research/draft`,{revision:0,value:{...h.input,method:'deep'}});return (await h.request('POST',`/api/catalog/products/${h.product.id}/research/collections`,{url:'https://www.douyin.com/video/123456789',groupId:'rival-1',idempotencyKey:crypto.randomUUID()})).json().collection;}
function multipart(bytes:Buffer,name='image.png'){const boundary='research-flow-boundary';return {headers:{origin,'x-research-token':'','content-type':'multipart/form-data; boundary='+boundary},payload:Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}--\r\n`)])};}

describe('采集插件配对、真实路由、资料导入',()=>{
 it('配对码一次有效，过期拒绝，列表不泄漏令牌，撤销立即生效',async()=>{
  const code=(await h.request('POST','/api/research-extension-code',{})).json().code,key=createHash('sha256').update(code).digest('hex');h.store.put('research-extension-code',key,{expiresAt:Date.now()-1});
  expect((await h.app.inject({method:'POST',url:'/api/research-extension/pair',headers:{origin},payload:{code}})).statusCode).toBe(400);
  const fresh=(await h.request('POST','/api/research-extension-code',{})).json().code,request={method:'POST' as const,url:'/api/research-extension/pair',headers:{origin},payload:{code:fresh}};
  const r=await h.app.inject(request),token=r.json().token;expect(r.statusCode).toBe(200);expect((await h.app.inject(request)).statusCode).toBe(400);
  const list=await h.request('GET','/api/research-extension-pairs');expect(list.body).not.toContain(token);expect(list.body).not.toContain('tokenHash');
  expect((await ext('GET','/jobs',token)).statusCode).toBe(200);await h.request('POST','/api/research-extension-revoke',{extensionId:'a'.repeat(32)});expect((await ext('GET','/jobs',token)).statusCode).toBe(403);
 });
 it('拒绝网页来源、缺失来源、伪造插件ID、错误令牌；预检限于插件API',async()=>{
  const token=await pair();for(const o of ['https://www.douyin.com','http://evil.invalid','chrome-extension://invalid',''])expect((await ext('GET','/jobs',token,undefined,o)).statusCode).toBe(403);
  expect((await ext('GET','/jobs','wrong')).statusCode).toBe(403);const pre=await ext('OPTIONS','/jobs','');expect(pre.statusCode).toBe(204);expect(pre.headers['access-control-allow-origin']).toBe(origin);
  expect((await h.app.inject({method:'POST',url:'/api/research-extension-code',headers:{origin},payload:{}})).statusCode).toBe(403);
 });
 it('连续错误配对码被限流',async()=>{for(let i=0;i<10;i++)expect((await ext('POST','/pair','',{code:'0'.repeat(16)})).statusCode).toBe(400);expect((await ext('POST','/pair','',{code:'0'.repeat(16)})).statusCode).toBe(429);});
 it('Chrome后台无Origin的GET使用配对令牌与插件ID认证，网页来源和错误身份仍拒绝',async()=>{
  const token=await pair(),headers={'x-research-token':token,'x-research-extension-id':'a'.repeat(32)},url='/api/research-extension/jobs';
  expect((await h.app.inject({url,headers})).statusCode).toBe(200);
  for(const patch of [{'x-research-token':'wrong'},{'x-research-extension-id':'b'.repeat(32)},{origin:'https://www.douyin.com'}])expect((await h.app.inject({url,headers:{...headers,...patch}})).statusCode).toBe(403);
  expect((await h.app.inject({method:'POST',url:'/api/research-extension/pair',headers,payload:{code:'0'.repeat(16)}})).statusCode).toBe(403);
 });
 it.each(['http://www.douyin.com/video/1','https://douyin.com.evil.invalid/video/1','https://user@www.douyin.com/video/1','https://www.douyin.com:999/video/1','https://www.douyin.com/video/1 https://www.douyin.com/video/2'])('拒绝非法素材链接 %s',url=>{expect(()=>normalizeDouyinUrl(url)).toThrow();});
 it('分享文本提取单条链接，队列重复添加去重且草稿引用一致',async()=>{
  expect(normalizeDouyinUrl('分享 https://www.douyin.com/video/123#x 看看')).toBe('https://www.douyin.com/video/123');const c=await job();
  const r=await h.request('POST',`/api/catalog/products/${h.product.id}/research/collections`,{url:c.url,groupId:c.groupId,idempotencyKey:crypto.randomUUID()});expect(r.json().collection.id).toBe(c.id);expect(r.json().draft.value.groups[0].collectionIds).toEqual([c.id]);
 });
 it('采集状态、父子评论、评论去重、暂停继续和完整来源均保留',async()=>{
  const token=await pair(),c=await job(),parent={id:'p',level:'1',text:'尺码如何？'},reply={id:'r',parentId:'p',level:'2',text:'回复内容'};
  expect((await ext('PATCH','/jobs/'+c.id,token,{status:'waiting-login',stage:'请登录'})).statusCode).toBe(200);
  expect((await ext('PATCH','/jobs/'+c.id,token,{status:'collecting',stage:'评论',comments:[reply]})).statusCode).toBe(400);
  await ext('PATCH','/jobs/'+c.id,token,{status:'collecting',stage:'评论',comments:[parent,reply]});await ext('PATCH','/jobs/'+c.id,token,{status:'paused',stage:'暂停',comments:[parent]});
  const r=await ext('PATCH','/jobs/'+c.id,token,{status:'partial',stage:'部分采集',text:'原始内容',warnings:['商品面板未取得'],stopReason:'已到底'});expect(r.json().comments).toHaveLength(2);expect(r.json().url).toBe(c.url);
  const state=(await h.request('GET',`/api/catalog/products/${h.product.id}/research`)).json();expect(state.collections[0].comments).toHaveLength(2);expect(state.collections[0].warnings).toEqual(['商品面板未取得']);
 });
 it('一级评论上限100，媒体未导入不接受引用，任务采集中不能被其他插件覆盖',async()=>{
  const token=await pair(),b=await pair(other),c=await job();await ext('PATCH','/jobs/'+c.id,token,{status:'collecting',stage:'采集中'});
  expect((await ext('PATCH','/jobs/'+c.id,b,{status:'collecting',stage:'抢占'},other)).statusCode).toBe(409);
  expect((await ext('PATCH','/jobs/'+c.id,token,{status:'partial',stage:'评论',comments:Array.from({length:101},(_,i)=>({id:''+i,level:'1',text:'内容'}))})).statusCode).toBe(400);
  expect((await ext('PATCH','/jobs/'+c.id,token,{status:'partial',stage:'媒体',media:[{assetId:'missing',role:'content',label:'缺失'}]})).statusCode).toBe(400);
 });
 it('图片按内容验证及去重，损坏文件不落盘，媒体引用进入研究证据',async()=>{
  const token=await pair(),c=await job();await ext('PATCH','/jobs/'+c.id,token,{status:'collecting',stage:'开始'});
  const upload=async(bytes:Buffer,name?:string)=>{const f=multipart(bytes,name);f.headers['x-research-token']=token;return h.app.inject({method:'POST',url:'/api/research-extension/assets?jobId='+c.id,...f});};
  const count=h.store.list('asset').length;const invalid=await upload(Buffer.from('not an image'),'fake.png');expect(invalid.statusCode).toBeGreaterThanOrEqual(400);expect(h.store.list('asset')).toHaveLength(count);
  const bytes=fs.readFileSync(path.join(h.dir,'media',h.ids[1]+'.png')),a=(await upload(bytes)).json(),b=(await upload(bytes,'renamed.jpg')).json();expect(a.id).toBe(b.id);expect(a.mime).toBe('image/png');expect(h.store.list('asset')).toHaveLength(count+1);
  expect((await ext('PATCH','/jobs/'+c.id,token,{status:'partial',stage:'资料已保存',media:[{assetId:a.id,role:'content',label:'原图'}]})).statusCode).toBe(200);
 });
 it('插件下载是有效ZIP；会话失效与非本机访问拒绝写入',async()=>{
  const zip=await h.request('GET','/api/research-extension-package');expect(zip.statusCode).toBe(200);expect(zip.rawPayload.subarray(0,2).toString()).toBe('PK');
  const missing=await h.app.inject({method:'PUT',url:`/api/catalog/products/${h.product.id}/research/draft`,payload:{revision:0,value:h.input}});expect(missing.statusCode).toBe(403);expect(missing.json().code).toBe('SESSION_EXPIRED');
  expect((await h.app.inject({url:'/api/bootstrap',headers:{host:'evil.invalid'}})).statusCode).toBe(403);
 });
});
