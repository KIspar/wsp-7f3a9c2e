import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type {Asset,Draft,Model} from '../../packages/contracts';
import {ecommerceReferenceRatio} from '../../packages/ecommerce/settings';
import {fail} from './errors';
import type {Store} from './store';

const sizes=new Map<string,{width:number;height:number;stamp:string}>();
const assetFile=(store:Store,asset:Asset)=>path.join(asset.source==='example'?path.join(store.projectRoot,'public/examples'):path.join(store.dataDir,'media'),path.basename(asset.url));
/** Read actual files before planning; quote and admission use the same immutable dimensions. */
export async function prepareEcommerceFormat(store:Store,skillId:string,draft:Draft){
  if(!skillId.startsWith('ec-')||draft.aspectRatio!==ecommerceReferenceRatio)return;
  for(const id of new Set(Object.values(draft.inputRoles).flat())){
    const asset=store.get<Asset>('asset',id);if(!asset||asset.type!=='image')continue;
    const file=assetFile(store,asset);
    try{
      const stat=fs.statSync(file),stamp=`${stat.size}:${stat.mtimeMs}`;
      if(sizes.get(file)?.stamp===stamp)continue;
      const meta=await sharp(file).metadata();
      if(!meta.width||!meta.height)fail('无法读取参考图尺寸，请重新上传');
      const rotated=[5,6,7,8].includes(meta.orientation||0);
      sizes.set(file,{width:rotated?meta.height:meta.width,height:rotated?meta.width:meta.height,stamp});
    }catch{fail('无法读取参考图尺寸，请重新上传或选择固定比例');}
  }
}
export function ecommerceReferenceFormat(store:Store,model:Model,assetId:string|undefined,resolution:unknown){
  if(!assetId)return {aspectRatio:model.aspectRatios.includes('1:1')?'1:1':model.aspectRatios[0]};
  const asset=store.get<Asset>('asset',assetId),size=asset&&sizes.get(assetFile(store,asset));
  if(!size)fail('参考图尺寸尚未读取，请重新预览');
  const ratio=size.width/size.height;
  const exact=model.aspectRatios.find(value=>{const [w,h]=value.split(':').map(Number);return Math.abs(w/h-ratio)<.001;});
  if(exact)return {aspectRatio:exact};
  if(model.provider!=='chuhe'||model.upstreamId!=='tt-image-2.5'||ratio<1/3||ratio>3)fail('当前模型无法保持此参考图的比例，请选择固定比例');
  const pixels=resolution==='4K'?8_294_400:resolution==='2K'?4_194_304:1_048_576;
  const width=Math.floor(Math.sqrt(pixels*ratio)/16)*16,height=Math.floor(Math.sqrt(pixels/ratio)/16)*16;
  // The provider's explicit pixel size takes precedence over its fixed aspect-ratio choices.
  const closest=[...model.aspectRatios].filter(v=>/^\d+:\d+$/.test(v)).sort((a,b)=>{const r=(v:string)=>{const [w,h]=v.split(':').map(Number);return Math.abs(Math.log(w/h/ratio));};return r(a)-r(b);})[0];
  return {aspectRatio:closest,size:`${width}x${height}`};
}
