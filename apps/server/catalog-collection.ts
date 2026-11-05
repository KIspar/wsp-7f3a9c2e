import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {z} from 'zod';
import type {Asset} from '../../packages/contracts';
import type {CatalogProduct,CollectionJob,CollectionItem,SourceSnapshot,SourceMedia,ProductMediaBinding} from '../../packages/catalog';
import type {Store} from './store';
import {readRemote,type RemoteReader} from './remote';
import {fail} from './errors';
import {probeVideo} from './analysis-media';
import {aliMediaDomains,readAliProduct,parseAliProduct} from './catalog-1688';
import {renderAliPage} from './catalog-browser';
export const jpDomains=['pc.jp0663.com','wh-api.jp0663.com','img.jp0663.com','pan.jp0663.com'] as const;
const now=()=>new Date().toISOString(),hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
export function normalizeProductUrl(raw:string){
  let url:URL;try{url=new URL(raw.trim());}catch{fail('请输入完整的军埔网或 1688 商品链接');}
  if(!['http:','https:'].includes(url.protocol)||url.port||url.username||url.password)fail('仅支持军埔网或 1688 的公开商品详情链接');
  if(url.hostname==='detail.1688.com'||url.hostname==='m.1688.com'){
    const match=/^\/offer\/(\d{6,20})\.html$/.exec(url.pathname);if(!match)fail('链接不是 1688 商品详情页');
    if(url.searchParams.get('offerId')&&url.searchParams.get('offerId')!==match[1])fail('1688 链接中的商品编号不一致');
    return {site:'1688' as const,sourceId:match[1],url:`https://detail.1688.com/offer/${match[1]}.html`};
  }
  if(!['pc.jp0663.com','www.jp0663.com'].includes(url.hostname))fail('仅支持军埔网和 1688 商品详情链接，暂不支持短链接');
  const match=/^\/detail\/([a-f0-9]{32})\/?$/i.exec(url.pathname);if(!match)fail('链接不是军埔网商品详情页');
  if(url.searchParams.get('site')&&url.searchParams.get('site')!=='www')fail('首版仅支持军埔站商品，请使用 site=www 的链接');
  return {site:'jp0663' as const,sourceId:match[1].toLowerCase(),url:`https://pc.jp0663.com/detail/${match[1].toLowerCase()}?site=www`};
}
const sourceSchema=z.object({code:z.number(),data:z.object({shangpinbiaoti:z.string().min(1),huohao:z.string().optional(),pifaname:z.string().optional(),pifajia:z.number().nonnegative().optional(),zhutu:z.array(z.string()),xiangqingtu:z.array(z.string()),allimg:z.array(z.string()).optional(),yanse:z.array(z.object({name:z.string(),src:z.string().nullable().optional()})),chima:z.array(z.string()),shuxing:z.array(z.object({name_text:z.string(),ziname_text:z.string()})),skulist:z.array(z.object({skuid:z.string(),yanse:z.string(),chima:z.string(),jiage:z.number().optional(),src:z.string().nullable().optional()})),xiangcexinxi:z.object({xiangceid:z.string(),pingbi:z.string().optional(),shanchu:z.union([z.number(),z.string()]).optional()}).passthrough(),xiangceliebiaoAdded:z.object({src:z.string().nullable().optional()}).passthrough().nullable().optional()}).passthrough()});
/** Only fields under this product endpoint are used; recommendation data is never enumerated. */
export function parseJpProduct(raw:unknown,sourceId:string):Omit<SourceSnapshot,'id'|'productId'|'sourceUrl'|'createdAt'>{
  const parsed=sourceSchema.safeParse(raw);if(!parsed.success)fail('军埔网商品结构已变化或需要登录，请人工补充，未猜测采集内容');
  if(parsed.data.code!==200)fail('商品不可公开读取，请人工补充');const d=parsed.data.data;
  if(d.xiangcexinxi.xiangceid!==sourceId)fail('来源商品标识不一致，采集已停止');
  if(d.xiangcexinxi.pingbi==='1'||String(d.xiangcexinxi.shanchu)==='1')fail('来源商品已下架或不可公开访问');
  const colors=d.yanse.map((c,i)=>({id:`color-${i+1}`,name:c.name}));const warnings:string[]=[];const media:SourceMedia[]=[];
  function add(url:string,kind:SourceMedia['kind'],label:string,order:number,targetId?:string){
    const u=new URL(url.startsWith('//')?`https:${url}`:url);if(!jpDomains.includes(u.hostname as typeof jpDomains[number])||!['http:','https:'].includes(u.protocol)) {warnings.push(`${label} 的资源域名未适配，需人工补充`);return;}
    media.push({key:`${kind}-${targetId||order}`,url:u.href,kind,label,order,targetId});
  }
  d.zhutu.forEach((u,i)=>add(u,'main',`主图 ${i+1}`,i));d.xiangqingtu.forEach((u,i)=>add(u,'detail',`详情 ${i+1}`,i));
  d.yanse.forEach((c,i)=>{if(c.src)add(c.src,'color',c.name,i,colors[i].id);});
  const skus=d.skulist.map(s=>{const c=colors.find(c=>c.name===s.yanse);if(!c)warnings.push(`SKU ${s.skuid} 的颜色待确认`);return {id:s.skuid,colorId:c?.id||'',size:s.chima,cost:s.jiage??null};});
  d.skulist.forEach((s,i)=>{if(s.src&&!d.yanse.some(c=>c.name===s.yanse&&c.src===s.src))add(s.src,'sku',`${s.yanse} ${s.chima}`,i,s.skuid);});
  const known=new Set(media.map(m=>m.url));(d.allimg||[]).forEach((u,i)=>{const normalized=new URL(u.startsWith('//')?`https:${u}`:u).href;if(!known.has(normalized)){add(u,'unclassified',`待分类素材 ${i+1}`,i);known.add(normalized);}});
  const video=d.xiangceliebiaoAdded?.src;if(video)add(video,'video','来源视频',0);
  if(media.length>200)fail('当前商品素材超过 200 个，请人工筛选');
  return {title:d.shangpinbiaoti,itemNumber:d.huohao||'',supplier:d.pifaname||'',wholesaleCost:d.pifajia??null,colors,sizes:d.chima,skus,parameters:d.shuxing.map(p=>({name:p.name_text,value:p.ziname_text,origin:'source'})),media,warnings,adapterVersion:'jp0663-public-v1'};
}
export const sourceBindings=(snapshot:SourceSnapshot):ProductMediaBinding[]=>snapshot.media.filter(m=>m.assetId&&m.kind!=='unclassified').map(m=>({id:`source-${snapshot.id}-${m.key}`,assetId:m.assetId!,kind:m.kind,label:m.label,order:m.order,targetId:m.targetId}));
export function createCollectionService(store:Store,remote:RemoteReader=readRemote,render:(url:string)=>Promise<string>=renderAliPage){
  let timer:ReturnType<typeof setInterval>|undefined,stopping=false;const active=new Set<string>();const operations=new Set<Promise<unknown>>();
  function enqueue(urls:string[],key:string,recollection=false){
    const normalized=urls.map(normalizeProductUrl),fingerprint=hash(JSON.stringify({urls:normalized.map(u=>u.url),recollection}));
    const previous=store.list<CollectionJob>('collection-job').find(j=>j.key===key);if(previous){if(previous.fingerprint!==fingerprint)fail('采集凭据已用于其他链接',409);return previous;}
    return store.transaction(()=>{
      const items=normalized.map(n=>{
        let p=store.list<CatalogProduct>('catalog-product').find(p=>p.site===n.site&&p.sourceId===n.sourceId);const duplicate=!!p&&!recollection;
        if(!p){p={id:store.id('product'),revision:1,site:n.site,sourceId:n.sourceId,sourceUrl:n.url,title:n.site==='1688'?`1688 商品 ${n.sourceId}`:'正在采集商品…',supplier:'',itemNumber:'',wholesaleCost:null,salePrice:null,sellingPoints:'',parameters:[],colors:[],sizes:[],skus:[],bindings:[],postTitle:'',postBody:'',archived:false,collectionStatus:'queued',createdAt:now(),updatedAt:now()};store.put('catalog-product',p.id,p);}
        return {id:store.id('collection-item'),url:n.url,productId:p.id,status:duplicate?p.collectionStatus:'queued',completed:0,total:0,recollection,...(duplicate?{error:'链接已存在，直接打开已有商品；可选择重新采集',snapshotId:p.latestSnapshotId,duplicate:true}:{})} as CollectionItem;
      });
      const job:CollectionJob={id:store.id('collection'),workspaceId:store.currentWorkspace(),key,fingerprint,createdAt:now(),updatedAt:now(),items};store.put('collection-job',job.id,job);return job;
    });
  }
  async function supplement(productId:string,html:string,key:string){
    const p=store.get<CatalogProduct>('catalog-product',productId)||fail('商品不存在',404);
    if(p.site!=='1688')fail('页面文件补充仅用于 1688 商品');
    const previous=store.list<CollectionJob>('collection-job').find(j=>j.key===key);
    const fingerprint=hash(JSON.stringify({productId,htmlHash:hash(html)}));
    if(previous){if(previous.fingerprint!==fingerprint)fail('采集凭据已用于其他页面文件',409);return previous;}
    if(store.list<CollectionJob>('collection-job').some(j=>j.items.some(i=>i.productId===p.id&&['queued','parsing','downloading'].includes(i.status)&&!(i as {duplicate?:boolean}).duplicate)))fail('此商品正在采集，请等待完成后补充页面文件',409);
    const parsed=await readAliProduct(p.sourceId,html,remote);
    return store.transaction(()=>{const existing=store.list<CollectionJob>('collection-job').find(j=>j.key===key);if(existing){if(existing.fingerprint!==fingerprint)fail('采集凭据已用于其他页面文件',409);return existing;}if(store.list<CollectionJob>('collection-job').some(j=>j.items.some(i=>i.productId===p.id&&['queued','parsing','downloading'].includes(i.status)&&!(i as {duplicate?:boolean}).duplicate)))fail('此商品正在采集，请等待完成后补充页面文件',409);const current=store.get<CatalogProduct>('catalog-product',p.id)||fail('商品不存在',404);const snapshot:SourceSnapshot={...parsed,adapterVersion:'1688-saved-page-v1',id:store.id('source'),productId:p.id,sourceUrl:p.sourceUrl,createdAt:now()},item:CollectionItem={id:store.id('collection-item'),url:p.sourceUrl,productId:p.id,status:'queued',completed:0,total:snapshot.media.length,recollection:!!current.sourceSnapshotId};
      const job:CollectionJob={id:store.id('collection'),workspaceId:store.currentWorkspace(),key,fingerprint,createdAt:now(),updatedAt:now(),items:[item]};store.put('collection-checkpoint',item.id,snapshot);store.put('collection-job',job.id,job);store.put('catalog-product',p.id,{...current,collectionStatus:'queued'});return job;});
  }
  function change(jobId:string,itemId:string,patch:Partial<CollectionItem>){store.transaction(()=>{const j=store.get<CollectionJob>('collection-job',jobId)!;const item=j.items.find(i=>i.id===itemId)!;Object.assign(item,patch);j.updatedAt=now();store.put('collection-job',j.id,j);const p=store.get<CatalogProduct>('catalog-product',item.productId)!;store.put('catalog-product',p.id,{...p,collectionStatus:item.status});});}
  async function download(m:SourceMedia,site:CatalogProduct['site']){
    let data:Awaited<ReturnType<RemoteReader>>|undefined;let error:unknown;
    for(let retry=0;retry<=2;retry++){try{data=await remote(m.url,{domains:site==='1688'?aliMediaDomains:jpDomains,maxBytes:30*1024*1024,...(site==='1688'?{headers:{Referer:'https://detail.1688.com/'}}:{})});break;}catch(e){error=e;}}
    if(!data)throw error;const contentHash=hash(data.bytes);const existing=store.get<Asset>('asset',`collected-${contentHash}`);if(existing){if(existing.type!==(m.kind==='video'?'video':'image'))throw new Error('资源真实格式与素材类别不一致');m.assetId=existing.id;m.hash=contentHash;return;}
    let mime:string,ext:string,width:number|undefined,height:number|undefined;
    if(m.kind==='video'){
      const temp=path.join(store.dataDir,'media',`${contentHash}.probe.tmp`);fs.writeFileSync(temp,data.bytes);try{const probe=await probeVideo(temp);mime=probe.mime;ext=probe.extension;}finally{fs.rmSync(temp,{force:true});}
    }else{const meta=await sharp(data.bytes,{limitInputPixels:40_000_000}).metadata();if(!['jpeg','png','webp'].includes(meta.format||'')||(meta.pages||1)>1||!meta.width||!meta.height||meta.width<100||meta.height<100)throw new Error('资源不是有效商品图片（尺寸至少 100×100）');mime=`image/${meta.format}`;ext=meta.format==='jpeg'?'jpg':meta.format!;width=meta.width;height=meta.height;}
    const id=`collected-${contentHash}`,filename=`${id}.${ext!}`,file=path.join(store.dataDir,'media',filename);fs.writeFileSync(file+'.tmp',data.bytes);fs.renameSync(file+'.tmp',file);
    const asset:Asset={id,url:`/media/${filename}`,type:m.kind==='video'?'video':'image',mime:mime!,bytes:data.bytes.length,source:'collection',createdAt:now()};store.transaction(()=>store.put('asset',id,asset));Object.assign(m,{assetId:id,hash:contentHash,width,height});
  }
  async function run(jobId:string,item:CollectionItem){
    try{
      change(jobId,item.id,{status:'parsing',error:undefined});const source=normalizeProductUrl(item.url),sourceId=source.sourceId;
      const checkpoint=store.get<SourceSnapshot>('collection-checkpoint',item.id);
      let snapshot:SourceSnapshot;
      if(checkpoint)snapshot=checkpoint;
      else{
        let parsed:Omit<SourceSnapshot,'id'|'productId'|'sourceUrl'|'createdAt'>;
        if(source.site==='1688'){
          let html='';
          try{const r=await remote(source.url,{maxBytes:8*1024*1024,domains:['detail.1688.com'],headers:{'Accept-Language':'zh-CN,zh;q=0.9'}});html=r.bytes.toString('utf8');}catch{/* An isolated ordinary browser can render public dynamic pages. */}
          if(!/window\.context\s*=/.test(html))html=await render(source.url);
          parsed=await readAliProduct(sourceId,html,remote);
        }else{
          const response=await remote('https://wh-api.jp0663.com/api?method=xiangceid.get.shangchuanshangpinxinxi.nocanshu',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',site:'www',Referer:'https://pc.jp0663.com/'},body:new URLSearchParams({xiangceid:sourceId}).toString(),maxBytes:2*1024*1024,domains:jpDomains});
          parsed=parseJpProduct(JSON.parse(response.bytes.toString()),sourceId);
        }
        snapshot={...parsed,id:store.id('source'),productId:item.productId,sourceUrl:item.url,createdAt:now()};
      }
      change(jobId,item.id,{status:'downloading',total:snapshot.media.length});
      // Durable checkpoint makes partial media resumable after a process restart.
      store.transaction(()=>store.put('collection-checkpoint',item.id,snapshot));
      for(let i=0;i<snapshot.media.length;i++){if(stopping)return;const m=snapshot.media[i];try{if(!m.assetId){delete m.error;await download(m,source.site);}}catch(e){m.error=(e as Error).message;}store.transaction(()=>store.put('collection-checkpoint',item.id,snapshot));change(jobId,item.id,{completed:i+1});}
      const good=snapshot.media.filter(m=>m.assetId).length,partial=good<snapshot.media.length||snapshot.warnings.length>0;
      store.transaction(()=>{store.put('source-snapshot',snapshot.id,snapshot);const p=store.get<CatalogProduct>('catalog-product',item.productId)!;const first=!p.sourceSnapshotId;store.put('catalog-product',p.id,{...p,latestSnapshotId:snapshot.id,...(first?{sourceSnapshotId:snapshot.id,title:p.title==='正在采集商品…'||p.site==='1688'&&p.title===`1688 商品 ${p.sourceId}`?snapshot.title:p.title,supplier:snapshot.supplier,itemNumber:snapshot.itemNumber,wholesaleCost:snapshot.wholesaleCost,parameters:p.parameters.length?p.parameters:snapshot.parameters,colors:p.colors.length?p.colors:snapshot.colors,sizes:p.sizes.length?p.sizes:snapshot.sizes,skus:p.skus.length?p.skus:snapshot.skus,bindings:sourceBindings(snapshot),revision:p.revision+1,updatedAt:now()}: {})});});
      change(jobId,item.id,{status:good?(partial?'partial':'completed'):'manual',snapshotId:snapshot.id,error:partial?`${snapshot.media.length-good} 个资源未下载；${snapshot.warnings.join('；')}`:undefined});
    }catch(e){change(jobId,item.id,{status:(e as {statusCode?:number}).statusCode===400?'manual':'failed',error:(e as Error).message});}
  }
  async function tick(){if(stopping)return;const tasks:Promise<unknown>[]=[];for(const j of store.list<CollectionJob>('collection-job'))for(const item of j.items){if(active.size>=2)break;if(!['queued','parsing','downloading'].includes(item.status)||(item as CollectionItem&{duplicate?:boolean}).duplicate||active.has(item.id))continue;
    // Duplicate URL submissions share one product and never race a second collection.
    const busy=store.list<CollectionJob>('collection-job').flatMap(j=>j.items).some(i=>i.productId===item.productId&&i.id!==item.id&&active.has(i.id));if(busy)continue;
    active.add(item.id);const task=store.withWorkspace(j.workspaceId||store.workspaceOf('collection-job',j.id)||store.currentWorkspace(),()=>run(j.id,item)).finally(()=>{active.delete(item.id);operations.delete(task);});operations.add(task);tasks.push(task);
  }await Promise.allSettled(tasks);}
  return {enqueue,supplement,tick,start(){stopping=false;if(!timer)timer=setInterval(()=>void tick(),600);},async stop(){stopping=true;clearInterval(timer);await Promise.allSettled([...operations]);}};
}
