import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import archiver from 'archiver';
import type {Store} from './store';
import {fail} from './errors';
import {researchDraft} from './research';
import {collectionPatchSchema,type ResearchCollection,type ResearchDraft} from '../../packages/research';
import type {Asset} from '../../packages/contracts';
import {probeVideo} from './analysis-media';
const now=()=>new Date().toISOString(),digest=(s:string)=>createHash('sha256').update(s).digest('hex');
type Pair={extensionId:string;tokenHash:string;createdAt:string;revoked?:boolean};
export const extensionOrigin=(value:string|undefined)=>!!value&&/^chrome-extension:\/\/[a-p]{32}$/.test(value);
export function extensionTokenValid(store:Store,origin:string,token:string){const p=store.get<Pair>('research-extension-pair',origin);if(!p||p.revoked)return false;return timingSafeEqual(Buffer.from(p.tokenHash),Buffer.from(digest(token)));}
/** Only this narrow API accepts extension origins; it never exposes the app session token. */
export function guardResearchExtension(store:Store,request:FastifyRequest,reply:FastifyReply){
 // Chrome service workers omit Origin on GETs with host permission. A paired token
 // and explicit extension id authenticate those requests; web origins still fail.
 const extensionId=request.headers['x-research-extension-id'];
 const origin=request.headers.origin||(request.method==='GET'&&typeof extensionId==='string'?`chrome-extension://${extensionId}`:undefined);
 if(!extensionOrigin(origin)){reply.code(403).send({message:'仅接受已配对的浏览器插件'});return;}
 reply.header('Access-Control-Allow-Origin',origin!).header('Vary','Origin').header('Access-Control-Allow-Methods','GET, POST, PATCH, OPTIONS').header('Access-Control-Allow-Headers','content-type, x-research-token, x-research-extension-id');
 if(request.method==='OPTIONS'){reply.code(204).send();return;}
 if(request.url==='/api/research-extension/pair'&&request.method==='POST')return;
 const token=String(request.headers['x-research-token']||'');if(!token||!extensionTokenValid(store,origin!,token))reply.code(403).send({message:'插件尚未配对或授权已撤销，请重新配对'});
}
export function normalizeDouyinUrl(raw:string){const matches=raw.match(/https:\/\/[^\s<>]+/g)||[];if(matches.length!==1)fail('每次添加一条抖音链接');let url:URL;try{url=new URL(matches[0]);}catch{fail('链接无效');}if(url!.protocol!=='https:'||!(url!.hostname==='douyin.com'||url!.hostname.endsWith('.douyin.com'))||url!.username||url!.password||url!.port)fail('首版仅支持抖音 HTTPS 链接');url!.hash='';return url!.href;}
export function registerResearchExtension(app:FastifyInstance,store:Store){
 const id=(p:unknown)=>z.object({id:z.string()}).parse(p).id;
 app.post('/api/research-extension-code',async()=>{const code=randomBytes(8).toString('hex').toUpperCase(),expiresAt=Date.now()+5*60_000;store.put('research-extension-code',digest(code),{expiresAt,attempts:0});return {code,expiresAt};});
 app.get('/api/research-extension-pairs',async()=>store.list<Pair>('research-extension-pair').map(({tokenHash,...p})=>p));
 app.post('/api/research-extension-revoke',async r=>{const {extensionId}=z.object({extensionId:z.string()}).parse(r.body),key=`chrome-extension://${extensionId}`,p=store.get<Pair>('research-extension-pair',key);if(p)store.put('research-extension-pair',key,{...p,revoked:true});return {ok:true};});
 let failures=0,windowStart=Date.now();
 app.options('/api/research-extension/*',async()=>({}));
 app.post('/api/research-extension/pair',async r=>{
  if(Date.now()-windowStart>60_000){failures=0;windowStart=Date.now();}if(failures>=10)fail('配对尝试过多，请稍后重试',429);
  const {code}=z.object({code:z.string().min(16).max(16)}).parse(r.body),key=digest(code.toUpperCase()),entry=store.get<{expiresAt:number}>('research-extension-code',key);if(!entry||entry.expiresAt<Date.now()){failures++;fail('配对码已失效，请在工作台重新获取');}
  const token=randomBytes(32).toString('hex'),origin=r.headers.origin!;store.transaction(()=>{store.remove('research-extension-code',key);store.put('research-extension-pair',origin,{extensionId:origin.slice('chrome-extension://'.length),tokenHash:digest(token),createdAt:now()} satisfies Pair);});return {token};
 });
 app.get('/api/research-extension/jobs',async()=>store.list<ResearchCollection>('research-collection').filter(c=>!['completed','failed'].includes(c.status)));
 app.get('/api/research-extension/jobs/:id',async r=>store.get('research-collection',id(r.params))||fail('采集任务不存在',404));
 app.post('/api/catalog/products/:id/research/collections',async r=>{
  const pid=id(r.params),b=z.object({url:z.string().max(4000),groupId:z.string(),idempotencyKey:z.string().min(8).max(100)}).parse(r.body),url=normalizeDouyinUrl(b.url),draft=researchDraft(store,pid),group=draft.value.groups.find(g=>g.id===b.groupId)||fail('同行组不存在');
  const old=store.list<ResearchCollection>('research-collection').find(c=>c.productId===pid&&c.groupId===b.groupId&&c.url===url);if(old)return {collection:old,draft};
  const c:ResearchCollection={id:store.id('research-collection'),productId:pid,groupId:b.groupId,url,status:'queued',stage:'等待插件登录检查',createdAt:now(),updatedAt:now(),title:'',text:'',comments:[],media:[],warnings:[],productInfo:''};group.collectionIds.push(c.id);draft.revision++;draft.updatedAt=now();store.transaction(()=>{store.put('research-collection',c.id,c);store.put('research-draft',pid,draft);});return {collection:c,draft};
 });
 app.patch('/api/research-extension/jobs/:id',async r=>{
  const cid=id(r.params),b=collectionPatchSchema.parse(r.body),c=store.get<ResearchCollection>('research-collection',cid)||fail('采集任务不存在',404);const extensionId=r.headers.origin!.slice('chrome-extension://'.length);
  if(c.extensionId&&c.extensionId!==extensionId&&c.status==='collecting')fail('该任务由另一个插件采集中，请先暂停',409);
  const comments=[...new Map([...c.comments,...b.comments||[]].map(x=>[x.id,x])).values()];const primary=comments.filter(c=>c.level==='1');if(primary.length>100)fail('每条素材最多100条不同一级评论');const parents=new Set(primary.map(c=>c.id));if(comments.some(c=>c.level==='2'&&(!c.parentId||!parents.has(c.parentId))))fail('二级回复必须关联已采集的一级评论');
  const media=[...new Map([...c.media,...b.media||[]].map(m=>[`${m.role}:${m.assetId}`,m])).values()];if(media.some(m=>!store.get<Asset>('asset',m.assetId)))fail('媒体尚未导入');const next={...c,...b,comments,media,extensionId,updatedAt:now()};store.put('research-collection',cid,next);return next;
 });
 app.post('/api/research-extension/assets',async r=>{
  const {jobId,label}=z.object({jobId:z.string(),label:z.string().max(200).default('素材')}).parse(r.query);const c=store.get<ResearchCollection>('research-collection',jobId)||fail('采集任务不存在',404);if(c.extensionId&&c.extensionId!==r.headers.origin!.slice('chrome-extension://'.length))fail('任务不属于当前插件');
  const part=await r.file({limits:{fileSize:30*1024*1024}});if(!part)fail('缺少素材文件');const bytes=await part.toBuffer();if(part.file.truncated)fail('素材超过30MB');
  const digestId=createHash('sha256').update(bytes).digest('hex'),existing=store.get<Asset>('asset','research-'+digestId);if(existing)return existing;
  let mime:string,extension:string,type:Asset['type'];const meta=await sharp(bytes,{limitInputPixels:40_000_000}).metadata().catch(()=>null);
  const aid='research-'+digestId,dir=path.join(store.dataDir,'media');
  if(meta&&['jpeg','png','webp'].includes(meta.format||'')&&(meta.pages||1)===1){extension=meta.format==='jpeg'?'jpg':meta.format!;mime='image/'+meta.format;type='image';}
  else{const temp=path.join(dir,aid+'.tmp');fs.writeFileSync(temp,bytes);try{const v=await probeVideo(temp);extension=v.extension;mime=v.mime;type='video';}finally{fs.rmSync(temp,{force:true});}}
  const filename=`${aid}.${extension!}`;fs.writeFileSync(path.join(dir,filename),bytes);const a:Asset={id:aid,url:'/media/'+filename,type:type!,mime:mime!,bytes:bytes.length,source:'collection',createdAt:now()};store.put('asset',a.id,a);return a;
 });
 app.get('/api/research-extension-package',async(_r,reply)=>{
  const dir=path.join(store.projectRoot,'extensions/douyin-research');if(!fs.existsSync(dir))fail('插件文件不存在',404);const archive=archiver('zip');reply.type('application/zip').header('Content-Disposition','attachment; filename="douyin-research.zip"');archive.directory(dir,'douyin-research');void archive.finalize();return reply.send(archive);
 });
}
