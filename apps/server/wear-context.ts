import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {defaultDraft,type Asset,type Draft} from '../../packages/contracts';
import {wearValueSchema,wearOutputCount,type WearValue,type WearDraft,type WearContext,type WearLibrary} from '../../packages/wear';
import type {CatalogProduct} from '../../packages/catalog';
import type {Store} from './store';
import {fail} from './errors';
const canonical=(x:unknown):unknown=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):x;
const same=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export function importWearLibrary(store:Store):WearLibrary{
 const file=path.join(store.projectRoot,'resources/wear-models.json');if(!fs.existsSync(file))return {models:[],scenes:[]};
 const manifest=JSON.parse(fs.readFileSync(file,'utf8')) as {scenes:string[];models:{id:string;name:string;filename:string;hash:string;bytes:number}[]};
 const models=manifest.models.map(m=>{
  const source=path.join(store.projectRoot,'public/wear-models',path.basename(m.filename)),target=path.join(store.dataDir,'media',path.basename(m.filename));
  if(!fs.existsSync(source))fail(`模特素材缺失：${m.name}`);
  const bytes=fs.readFileSync(source);if(bytes.length!==m.bytes||createHash('sha256').update(bytes).digest('hex')!==m.hash)fail('模特素材校验失败');
  if(!fs.existsSync(target)||createHash('sha256').update(fs.readFileSync(target)).digest('hex')!==m.hash)fs.copyFileSync(source,target);
  const asset:Asset=store.get<Asset>('asset',m.id)||{id:m.id,url:'/media/'+path.basename(m.filename),type:'image',mime:'image/webp',bytes:m.bytes,createdAt:new Date().toISOString(),source:'collection'};
  if(!store.get('asset',m.id))store.put('asset',m.id,asset);
  return {id:m.id,name:m.name,asset};
 });return {models,scenes:manifest.scenes};
}
function product(store:Store,scope:string){if(scope==='global')return;return store.get<CatalogProduct>('catalog-product',scope)||fail('商品不存在',404);}
export function getWearDraft(store:Store,scope:string):WearDraft{
 const p=product(store,scope),old=store.get<WearDraft>('wear-draft',scope);if(old)return old;
 const legacy=scope==='global'?store.readDraft('model-outfit').value:undefined;
 const ratio=legacy&&['3:4','1:1','9:16'].includes(legacy.aspectRatio)?legacy.aspectRatio:undefined;
 return {id:scope,revision:0,value:wearValueSchema.parse({productIds:p?.bindings.filter(b=>b.kind==='main').sort((a,b)=>a.order-b.order).slice(0,6).map(b=>b.assetId)||legacy?.inputRoles.product?.slice(0,6)||[],...(legacy?{modelAssetId:legacy.selectedTargetIds[0]||legacy.inputRoles.targets?.[0]||'',requirements:legacy.requirements,modelId:legacy.modelId,...(ratio?{aspectRatio:ratio}:{}),resolution:legacy.parameters.resolution==='2K'?'2K':'1K'}:{})})};
}
export function saveWearDraft(store:Store,scope:string,revision:number,value:WearValue){const old=getWearDraft(store,scope);if(old.revision!==revision)fail('服饰穿戴草稿已更新，请保留输入后重新读取',409);const next={id:scope,revision:revision+1,value:wearValueSchema.parse(value)};store.put('wear-draft',scope,next);return next;}
export function wearGeneration(store:Store,doc:WearDraft,stage:WearContext['stage']):Draft{
 const v=wearValueSchema.parse(doc.value),p=product(store,doc.id),skill=store.skills().find(s=>s.id===(stage==='model'?'image-generate':'model-outfit'))||fail('生成技能不可用');
 const model=store.models().find(m=>m.id===v.modelId&&m.category==='image'&&m.enabled)||fail('图片模型不可用');
 if(!model.aspectRatios.includes(v.aspectRatio)||!model.parameters.resolution?.options?.includes(v.resolution))fail('图片模型不支持所选比例或分辨率');
 const d=defaultDraft(skill,store.models());d.modelId=model.id;d.parameters=Object.fromEntries(Object.entries(model.parameters).map(([k,f])=>[k,f.default??'']));d.parameters.resolution=v.resolution;d.aspectRatio=v.aspectRatio;
 if(stage==='model'){
  d.count=1;d.requirements=`生成一张电商服饰穿戴使用的基准模特照片。单人、全身、正面站立、自然放松、纯色棚拍背景、均匀柔光。外观设定：${v.profile.gender}，${v.profile.age}，${v.profile.appearance}，${v.profile.body}体型。${v.profile.details}。身着简单无图案的基础服装，避免遮挡身体轮廓，不添加文字、水印或拼图。`;
  return d;
 }
 if(!v.productIds.length)fail('请添加服装图片');
 if(v.productIds.includes(v.modelAssetId))fail('服装图片与基准模特不能使用同一张素材，请分别选择');
 const refs=[...v.productIds,v.modelAssetId];if(!v.modelAssetId)fail('请选择或生成一位基准模特');
 for(const id of refs){const a=store.get<Asset>('asset',id);if(!a||a.type!=='image'||['example','simulator'].includes(a.source))fail('服装或模特图片不可用，请重新选择');}
 const scenes=[...v.scenes,...(v.customScene.trim()?[v.customScene.trim()]:[])];if(!scenes.length)fail('请至少选择一个场景');
 if(wearOutputCount(v)>store.settings().maxBatch)fail(`本次共 ${wearOutputCount(v)} 张，超过单批 ${store.settings().maxBatch} 张上限`);
 const poses=['正面自然站姿，完整展示服饰轮廓','侧身行走，呈现穿戴的动态与侧面轮廓','三分之二侧身回望，展示背部和搭配层次','坐姿或自然互动，展示服饰细节'];
 d.count=wearOutputCount(v);d.inputRoles={product:v.productIds,targets:[v.modelAssetId]};d.selectedTargetIds=[v.modelAssetId];
 d.requirements=v.requirements;d.fields={...d.fields,targetDescription:'自有商品对应的服装、鞋包或配饰'};
 d.overrides={[v.modelAssetId]:{promptOverride:`服饰穿戴电商实拍。图1至图${v.productIds.length}是自有商品，严格保持颜色、版型、图案、鞋型或配饰结构等可见细节。图${refs.length}为基准模特，仅依据其可见面部、体型与外观生成同一人物。将自有商品自然穿戴在模特相应部位，符合人体结构与遮挡关系。场景及姿态以本项要求为准，可以改变基准图背景和姿态；不同成品为独立照片。不得拼图，不添加文案、水印，不补造商品参数。${v.requirements}`}};
 d.outputInstructions=scenes.flatMap(scene=>Array.from({length:v.poses},(_,i)=>`场景：${scene}。姿态 ${i+1}/${v.poses}：${poses[i]}。${v.recommend?'根据商品可见风格优化灯光、搭配及机位，保持同组人物一致。':'严格遵循选定场景和姿态，不额外改变商品。'}`));
 if(p)d.productContext={id:p.id,revision:p.revision,name:p.title.slice(0,200),facts:[p.sellingPoints,...p.parameters.map(x=>`${x.name}：${x.value}（来源声明）`)].filter(Boolean).join('\n').slice(0,8000)};
 return d;
}
export function wearContext(store:Store,doc:WearDraft,stage:WearContext['stage']):WearContext{const p=product(store,doc.id);return {scope:doc.id,draftRevision:doc.revision,stage,...(p?{productRevision:p.revision}:{})};}
export function validateWearContext(store:Store,c:WearContext,d:Draft,skillId:string){const doc=getWearDraft(store,c.scope),p=product(store,c.scope);if(doc.revision!==c.draftRevision||p&&p.revision!==c.productRevision)fail('商品或服饰穿戴草稿已更新，请重新报价',409);if(skillId!==(c.stage==='model'?'image-generate':'model-outfit')||!same(d,wearGeneration(store,doc,c.stage)))fail('服饰穿戴计划与草稿不一致',409);return structuredClone(doc.value);}
