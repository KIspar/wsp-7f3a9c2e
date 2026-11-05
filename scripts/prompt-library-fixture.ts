/** Isolated UI fixture. No credentials are loaded and provider requests are rejected. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createStore} from '../apps/server/store';
import {createApp} from '../apps/server/app';
import {emptyPrompt} from '../packages/prompts';
import {savePrompt} from '../apps/server/prompts';
import type {Asset} from '../packages/contracts';
import type {CatalogProduct} from '../packages/catalog';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'prompt-library-browser-'));
const store=createStore(folder,process.cwd());
const db=new DatabaseSync(path.join(process.cwd(),'data/studio.sqlite'),{readOnly:true});
const candidates=db.prepare("SELECT value FROM documents WHERE kind='asset'").all().map(r=>JSON.parse(String(r.value)) as Asset).filter(a=>a.type==='image'&&a.source==='provider'&&a.url.startsWith('/media/')&&fs.existsSync(path.join(process.cwd(),'data/media',path.basename(a.url))));
db.close();
const photos=candidates.slice(-6).map(a=>{fs.copyFileSync(path.join(process.cwd(),'data/media',path.basename(a.url)),path.join(folder,'media',path.basename(a.url)));store.put('asset',a.id,a);return a;});
if(!photos.length)throw Error('No actual generated images available for UI fixture');
const own=photos[0].id;
const p:CatalogProduct={id:'prompt-qa-product',revision:1,site:'jp0663',sourceId:'qa',sourceUrl:'https://pc.jp0663.com/detail/qa',supplier:'界面验收数据',itemNumber:'QA',wholesaleCost:null,title:'亨利领卫衣 · 界面验收商品',salePrice:null,sellingPoints:'以商品图片为准',parameters:[],colors:[],sizes:[],skus:[],postTitle:'',postBody:'',archived:false,bindings:[{id:'main-1',assetId:own,kind:'main',label:'商品图',order:0}],collectionStatus:'completed',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};store.put('catalog-product',p.id,p);
const entries=[
 {name:'街头穿搭 · 硬闪光',kind:'image' as const,description:'验收示例：保留商品外观，以夜间街景和闪光灯营造穿搭画面。',tags:['男装','穿搭展示'],prompt:'让模特穿着 {{商品名称}}，在 {{场景}} 展示正面与领口细节。使用硬闪光，保留商品真实颜色。',pages:[{title:'封面',prompt:'低机位半身穿搭，主体居中。'},{title:'细节',prompt:'领口与纹理近景。'}],exampleIds:[own,photos[1]?.id||own,photos[2]?.id||own]},
 {name:'通勤街景 · 逐图换装',category:'post' as const,kind:'image-replica' as const,description:'验收示例：参考场景与构图，每张原图对应一页。',tags:['通勤场景','逐图复刻'],prompt:'保留参考画面的姿态和构图，以当前商品替换同行服装。',replacementObject:'模特身上的上衣',referenceIds:[photos[1]?.id||own],exampleIds:[photos[2]?.id||own]},
 {name:'开场到细节 · 首帧视频',kind:'video-first-frame' as const,description:'验收示例：从完整穿搭推进到商品细节。',tags:['运镜','开场'],prompt:'基于当前商品首帧，让人物轻微转身，镜头缓慢推进领口。',exampleIds:[photos[3]?.id||own]},
 {name:'四镜头 · 商品节奏',kind:'video-storyboard' as const,description:'验收示例：按开场、穿搭、细节和收尾编排镜头。',tags:['分镜','穿搭展示'],prompt:'以 {{商品名称}} 为主角，保持服装外观一致。',shots:[{title:'开场',duration:3,scene:'街道',action:'模特走近镜头',camera:'固定机位',dialogue:'',framePrompt:'正面穿搭全景',prompt:'自然走近并整理衣领'},{title:'细节',duration:3,scene:'同一场景',action:'展示领口',camera:'缓慢推进',dialogue:'',framePrompt:'商品领口近景',prompt:'推进到领口并停留'}],exampleIds:[photos[4]?.id||own]},
 {name:'爆款结构 · 商品替换',kind:'video-remake' as const,description:'验收示例：保存镜头方法，原片时间轴由本地拆解确定。',tags:['爆款复刻','分镜'],prompt:'保留原片镜头节奏，商品以当前商品图片为准。',replacementObject:'模特身上的 {{替换对象}}',shots:[{title:'穿搭展示',duration:4,scene:'街道',action:'人物自然转身',camera:'中景跟随',dialogue:'',framePrompt:'保留背景和人物姿态，替换上衣',prompt:'人物缓慢转身，镜头跟随'}],exampleIds:[photos[5]?.id||own]},
];
for(const x of entries)savePrompt(store,{...emptyPrompt(x.kind),...x,name:'验收示例 · '+x.name});
const app=await createApp(store,{worker:false,providerTransport:async()=>{throw Error('界面验收不调用供应商');}});
await app.listen({host:'127.0.0.1',port:4326});
console.log('Prompt library isolated fixture: http://127.0.0.1:4326 · '+folder);
process.on('SIGTERM',()=>void app.close().then(()=>{store.close();process.exit(0);}));
