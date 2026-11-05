import fs from 'node:fs';
import {ecommerceFeatures} from '../src/lib/ecommerce-features';

const audit=JSON.parse(fs.readFileSync('docs/ecommerce-reference-audit.json','utf8'));
const controlsAudit=JSON.parse(fs.readFileSync('docs/ecommerce-controls-audit.json','utf8'));
const sources=JSON.parse(fs.readFileSync('public/ecommerce-reference/sources.json','utf8')) as Record<string,{path:string}>;
const normalize=(value:string)=>value.replace(/\s/g,'').toLowerCase();
const manifest:Record<string,unknown>={};
for(const feature of ecommerceFeatures){
  const record=audit.records.find((r:{name:string;group:string})=>r.group===feature.groupId&&normalize(r.name)===normalize(feature.name));
  if(!record)throw new Error(`缺少页面采集记录：${feature.id}`);
  const images=[...new Map<string,{alt:string;src:string}>((record.media||[]).map((m:{alt:string;src:string})=>[m.src,m])).values()].map(m=>({alt:m.alt,src:'/ecommerce-reference/'+new URL(m.src).pathname.split('/').pop()+'.webp'}));
  const last=images.at(-1);
  let cases=images.filter(m=>/原图[:：]|成品[:：]|before|after/i.test(m.alt));
  let recommendations=images.filter(m=>/^(ws-|pod-|tb-|dv-|design-|marketing-|m\d|示例)/.test(m.alt)&&m!==last);
  if(!recommendations.length)recommendations=images.filter(m=>m!==last&&!cases.includes(m)).slice(0,6);
  const choices=images.filter(m=>m!==last&&!cases.includes(m)&&!recommendations.includes(m));
  const roles:Record<string,typeof images>={};
  const matching=(pattern:RegExp)=>images.filter(m=>m!==last&&pattern.test(m.alt+' '+m.src));
  if(feature.name==='搭配矩阵图'){roles.product=matching(/dv-piece-|\d+-piece-/);roles.bottom=matching(/搭配单品|bottom-/);roles.accessory=matching(/配件|acc-/);roles.scene=matching(/场景背景|bg-\d/);roles.reference=[];}
  if(feature.name==='专属模特套拍'){roles.model=matching(/示例大码模特/);roles.product=[];roles.reference=matching(/shot-/);}
  if(feature.name==='商品 SKU 图'){roles.product=images.slice(0,1);roles.reference=images.slice(0,1);}
  if(feature.name==='平铺转 3D'){roles.product=matching(/f3d-flat/);roles.reference=matching(/f3d-ref/);}
  if(feature.id==='ec-product-07'){
    const demo=controlsAudit.records.find((r:{id:string})=>r.id===feature.id)?.sections.flatMap((s:{groups:{id:string;options:{choice:string;images:{src:string}[]}[]}[]})=>s.groups).find((g:{id:string})=>g.id==='choice-1');
    const demos=(key:string,label:string)=>(demo?.options||[]).filter((o:{choice:string})=>o.choice===key).flatMap((o:{images:{src:string}[]})=>o.images.filter(i=>sources[i.src]).map((i,index)=>({src:sources[i.src].path,alt:label+(key.endsWith('demoResult')?` ${index+1}`:'')})));
    roles.product=demos('wbs.detailReplica.demoProduct','示例商品原图');
    roles.reference=demos('wbs.detailReplica.demoRef','示例详情参考图');
    cases=[...roles.product,...roles.reference,...demos('wbs.detailReplica.demoResult','复刻效果')].map((image,index)=>({...image,alt:index>1?`复刻效果 ${index-1}`:image.alt}));
    recommendations=roles.product;
  }
  manifest[feature.id]={recommendations,choices,roles,cases:cases.length?cases:last?[last]:[],cover:last||null};
}
fs.writeFileSync('src/lib/ecommerce-reference-assets.json',JSON.stringify(manifest,null,2)+'\n');
console.log(`已映射 ${Object.keys(manifest).length} 页素材`);
