import type {SourceMedia,SourceSnapshot} from '../../packages/catalog';
import type {RemoteReader} from './remote';
import {fail} from './errors';
export const aliPageDomains=['detail.1688.com','itemcdn.tmall.com'] as const;
export const aliMediaDomains=['cbu01.alicdn.com','cbu02.alicdn.com','cbu03.alicdn.com','cbu04.alicdn.com','img.alicdn.com','gw.alicdn.com','cloud.video.taobao.com','cloud.video.alibaba.com','caiyuanbao.alicdn.com'] as const;
type ParsedSource=Omit<SourceSnapshot,'id'|'productId'|'sourceUrl'|'createdAt'>;
type Obj=Record<string,any>;
const object=(v:unknown):Obj=>v&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{};
const array=(v:unknown):any[]=>Array.isArray(v)?v:[];
const text=(v:unknown)=>typeof v==='string'?v.trim():typeof v==='number'&&Number.isFinite(v)?String(v):'';
const price=(v:unknown)=>/^(?:\d+)(?:\.\d+)?$/.test(text(v))?Number(v):null;
export const decodeHtml=(s:string)=>s.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi,m=>{const fixed:Record<string,string>={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'};if(fixed[m.toLowerCase()])return fixed[m.toLowerCase()];const n=m[2].toLowerCase()==='x'?parseInt(m.slice(3,-1),16):parseInt(m.slice(2,-1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';});
/** Read a JSON literal only. Never execute source-page JavaScript. */
export function jsonObjectAt(input:string,start:number):unknown{
 if(input[start]!=='{')return undefined;let depth=0,quoted=false,escape=false;
 for(let i=start;i<input.length;i++){const c=input[i];if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;continue;}if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){try{return JSON.parse(input.slice(start,i+1));}catch{return undefined;}}}return undefined;
}
function contextFromHtml(html:string):Obj{
 for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)){
  const script=match[1];if(!/window\.context\s*=/.test(script))continue;
  // The modern page passes a plain JSON result as the second argument to a wrapper.
  const marker=/\{\s*"result"\s*:/.exec(script);if(marker){const value=object(jsonObjectAt(script,marker.index));if(value.result)return value;}
 }
 return {};
}
export function aliMediaUrl(value:unknown):string|undefined{
 const raw=text(value);if(!raw)return;try{const u=new URL(raw.startsWith('//')?'https:'+raw:raw);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port||!aliMediaDomains.includes(u.hostname as typeof aliMediaDomains[number]))return;return u.href;}catch{return;}
}
function attrs(tag:string){const values:Record<string,string>={};for(const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))values[m[1].toLowerCase()]=decodeHtml(m[2]??m[3]??'');return values;}
/** Only called on the product's own description HTML, never the whole page. */
export function aliDescriptionImages(raw:string):string[]{
 let html=raw;const wrapped=/\bvar\s+offer_details\s*=\s*/.exec(raw);if(wrapped){const value=object(jsonObjectAt(raw,wrapped.index+wrapped[0].length));html=text(value.content)||text(value.description)||'';}
 return [...new Set([...html.matchAll(/<img\b[^>]*>/gi)].map(m=>{const a=attrs(m[0]);return aliMediaUrl(a['data-src']||a['data-lazy-src']||a.src);}).filter((u):u is string=>!!u))];
}
export const aliAccessMessage='1688 需要在浏览器中登录或完成访问验证。请打开来源商品，正常访问后另存为 HTML，再用“补充页面文件”继续采集；不会自动绕过验证。';
export function parseAliProduct(html:string,sourceId:string):{snapshot:ParsedSource;detailUrl?:string}{
 if(Buffer.byteLength(html)>8*1024*1024)fail('1688 页面超过 8MB，请保存单个商品页面');
 const ctx=contextFromHtml(html),result=object(ctx.result),data=object(result.data),global=object(object(object(result.global).globalData).model),root=object(object(object(data.Root).fields).dataJson),offer=object(global.offerDetail);
 const gallery=object(object(data.gallery).fields),title=object(object(data.productTitle).fields),description=object(object(data.description).fields),seller=object(global.sellerModel),trade=object(global.tradeModel),sku=object(root.skuModel);
 const ids=[offer.offerId,gallery.offerId,object(root.offerBaseInfo).offerId,object(root.tempModel).offerId].filter(v=>text(v));
 if(!ids.length){if(/_____tmd_____|验证码|访问验证|滑动验证|x5sec|登录后查看/.test(html)||!Object.keys(ctx).length)fail(aliAccessMessage);fail('1688 商品结构已变化，未找到可核实的商品编号，请补充页面文件');}
 if(ids.some(id=>text(id)!==sourceId))fail('页面商品编号与链接不一致，采集已停止');
 if(object(offer.offerSign).detailForbidden===true||offer.status&&offer.status!=='PUBLISHED'||object(offer.offerSystemAttributes).selling===false)fail('1688 商品已下架或限制公开访问');
 const name=text(title.title)||text(offer.subject)||text(gallery.subject);if(!name||name.length>500)fail('1688 商品标题缺失或过长，请人工核实');
 const warnings:string[]=[],media:SourceMedia[]=[];
 function add(raw:unknown,kind:SourceMedia['kind'],label:string,order:number,targetId?:string){if(!text(raw))return;const url=aliMediaUrl(raw);if(!url){warnings.push(`${label} 的资源地址未适配，请人工补充`);return;}if(media.some(m=>m.kind===kind&&m.url===url&&m.targetId===targetId))return;media.push({key:`${kind}-${targetId||order}`,url,kind,label,order,targetId});}
 const images=array(gallery.mainImage).length?array(gallery.mainImage):array(offer.mainImageList||offer.imageList||root.images).map(i=>object(i).fullPathImageURI);
 images.forEach((u,i)=>add(u,'main',`主图 ${i+1}`,i));if(!images.length)warnings.push('来源未公开商品主图，请人工补充');
 const parameters=array(offer.featureAttributes).filter(p=>text(object(p).name)&&text(object(p).value)).map(p=>({name:text(p.name),value:text(p.value),origin:'source' as const}));
 if(parameters.length>100||parameters.some(p=>p.name.length>100||p.value.length>2000))fail('商品参数超出支持范围，请人工筛选');
 const props=array(sku.skuProps||offer.skuProps).map(p=>object(p));
 const colorProp=props.find(p=>/颜色|色号|花色/.test(text(p.prop))),sizeProp=props.find(p=>/尺码|尺寸|大小/.test(text(p.prop)));
 const colorValues=array(colorProp?.value).filter(v=>text(object(v).name));
 const colors=colorValues.map((v,i)=>({id:`ali-color-${i+1}`,name:text(v.name)}));
 const sizes=array(sizeProp?.value).map(v=>text(object(v).name)).filter(Boolean);
 if(colors.length>100||sizes.length>100||colors.some(c=>c.name.length>120)||sizes.some(s=>s.length>120))fail('商品规格超出支持范围，请人工筛选');
 colorValues.forEach((v,i)=>{if(colors[i])add(object(v).imageUrl||object(v).image,'color',colors[i].name,i,colors[i].id);});
 const rows=Object.entries(object(sku.skuInfoMap));if(rows.length>1000)fail('商品 SKU 超过 1000 项，请人工筛选');
 const skus:ParsedSource['skus']=[];
 for(const [key,value] of rows){const row=object(value),id=text(row.skuId)||text(row.specId);if(!id){warnings.push('部分 SKU 缺少来源编号，未自动建立组合');continue;}const values=text(row.specAttrs||key).split('&gt;').join('>').split('>');
  // Do not invent a Cartesian product or guess when labels cannot be mapped exactly.
  const colorIndex=colorProp?props.indexOf(colorProp):-1,sizeIndex=sizeProp?props.indexOf(sizeProp):-1;
  const color=colors.find(c=>c.name===values[colorIndex]);
  if(!color&&props.length>0){warnings.push(`SKU ${id} 的规格未能明确映射，需人工处理`);continue;}
  let size=sizeIndex>=0?values[sizeIndex]||'':'';
  const rest=props.map((p,i)=>i!==colorIndex&&i!==sizeIndex?`${text(p.prop)}：${values[i]||''}`:'').filter(Boolean);
  // Non-clothing offers may have a single model/specification axis. Preserve it explicitly.
  let colorId=color?.id||'';
  if(!colorId&&props.length===0){colorId='ali-default';if(!colors.length)colors.push({id:colorId,name:'默认规格'});}
  if(rest.length)size=[size,...rest].filter(Boolean).join(' · ');
  if(!colorId||size.length>120||id.length>120){warnings.push(`SKU ${id} 需要手动确认规格`);continue;}
  skus.push({id,colorId,size,cost:price(row.price)});add(row.imageUrl||row.image,'sku',`${color?.name||'默认规格'} ${size}`.trim(),skus.length-1,id);
 }
 if(!colorProp&&props.length){warnings.push('来源规格不含颜色维度，已保留原始规格参数，SKU 待人工绑定');}
 for(const p of props){if(p!==colorProp&&p!==sizeProp&&text(p.prop)&&!parameters.some(a=>a.name===text(p.prop)))parameters.push({name:text(p.prop),value:array(p.value).map(v=>text(object(v).name)).filter(Boolean).join('、'),origin:'source'});}
 if(root.needSkuHide===true)warnings.push('来源需要登录查看全部规格，当前仅保存公开的规格信息');
 if(!rows.length)warnings.push('来源未公开完整 SKU 组合，未自动生成组合');
 const video=object(gallery.video),wireless=object(offer.wirelessVideo);add(video.videoUrl||object(wireless.videoUrls).android||object(wireless.videoUrls).ios,'video','来源视频',0);
 const detailRaw=text(description.detailUrl)||text(offer.detailUrl);let detailUrl:string|undefined;
 if(detailRaw){try{const u=new URL(detailRaw.startsWith('//')?'https:'+detailRaw:detailRaw);if(u.protocol==='https:'&&u.hostname==='itemcdn.tmall.com'&&/^\/1688offer\/[\w-]+$/.test(u.pathname)&&!u.port&&!u.username&&!u.password)detailUrl=u.href;else warnings.push('详情资源地址未适配，请人工补充');}catch{warnings.push('详情资源地址无效，请人工补充');}}else warnings.push('来源未公开详情图片地址，请人工补充');
 const rawDetail=text(description.detailHtml)||text(offer.description);aliDescriptionImages(rawDetail).forEach((u,i)=>add(u,'detail',`详情 ${i+1}`,i));
 const costs=skus.map(s=>s.cost).filter((v):v is number=>v!==null),wholesaleCost=price(trade.minPrice)??(costs.length?Math.min(...costs):null);
 if(wholesaleCost===null)warnings.push('来源价格未公开，货源成本留空');
 if(parameters.length>100||parameters.some(p=>p.name.length>100||p.value.length>2000))fail('商品参数超出支持范围，请人工筛选');
 const snapshot:ParsedSource={title:name,supplier:text(title.shopInfo?.companyName)||text(seller.companyName)||text(root.tempModel?.companyName),itemNumber:parameters.find(p=>p.name==='货号')?.value||'',wholesaleCost,parameters,colors,sizes,skus,media,warnings:[...new Set(warnings)],adapterVersion:'1688-public-v1'};
 if(media.length>200)fail('当前商品素材超过 200 个，请人工筛选');return {snapshot,detailUrl};
}
export async function readAliProduct(sourceId:string,html:string,remote:RemoteReader){
 const {snapshot,detailUrl}=parseAliProduct(html,sourceId);
 if(detailUrl&&!snapshot.media.some(m=>m.kind==='detail')){try{const r=await remote(detailUrl,{domains:['itemcdn.tmall.com'],maxBytes:5*1024*1024,headers:{Referer:`https://detail.1688.com/offer/${sourceId}.html`}});const images=aliDescriptionImages(r.bytes.toString('utf8'));if(!images.length)snapshot.warnings.push('详情页未返回可下载的图片，请人工补充');images.forEach((url,i)=>snapshot.media.push({key:`detail-${i}`,url,kind:'detail',label:`详情 ${i+1}`,order:i}));}catch{snapshot.warnings.push('详情图片暂时无法读取，可重新采集或人工补充');}}
 if(snapshot.media.length>200)fail('当前商品素材超过 200 个，请人工筛选');return snapshot;
}
