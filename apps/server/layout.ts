import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Asset, LongImageLayout } from '../../packages/contracts';
import type { Store } from './store';
import { fail } from './engine';

export async function inspectLayout(store:Store,batchId:string,group:number,layout:LongImageLayout) {
  const batch=store.readBatch(batchId)||fail('批次不存在',404);
  if(!batch.attempts.some(a=>a.groupIndex===group)) fail('详情组不存在',404);
  if(new Set(layout.attemptIds).size!==layout.attemptIds.length) fail('排版包含重复图片');
  const items=[]; const screens=new Set<string>(); let height=0;
  for(const id of layout.attemptIds) {
    const attempt=batch.attempts.find(a=>a.id===id && a.groupIndex===group)||fail('所选结果不属于当前详情组');
    if(attempt.status!=='completed'||!attempt.assetId) fail('仅已保存的成品可参与排版');
    if(screens.has(attempt.screenId!)) fail('每一屏只能使用一张图片');
    screens.add(attempt.screenId!);
    const asset=store.get<Asset>('asset',attempt.assetId)||fail('图片不存在');
    if(asset.type!=='image') fail('长图只支持静态图片');
    const root=asset.source==='example'?path.join(store.projectRoot,'public/examples'):path.join(store.dataDir,'media');
    const file=path.join(root,path.basename(asset.url));
    const meta=await sharp(file,{limitInputPixels:40_000_000}).rotate().metadata().catch(()=>fail('图片文件不可读'));
    if(!meta.width||!meta.height) fail('图片尺寸无效');
    const rotated=meta.orientation && meta.orientation>=5;
    const originalWidth=rotated?meta.height:meta.width, originalHeight=rotated?meta.width:meta.height;
    const itemHeight=Math.max(1,Math.round(originalHeight*layout.width/originalWidth));
    items.push({attemptId:id,file,width:originalWidth,height:originalHeight,outputHeight:itemHeight,top:height});
    height+=itemHeight+layout.gap;
  }
  height-=layout.gap;
  if(height>60000||height*layout.width>80_000_000) fail('长图过大，请降低导出宽度或减少屏数（最多 8000 万像素、高度 60000px）');
  return {items,width:layout.width,height,upscale:items.some(i=>i.width<layout.width)};
}
export async function exportLayout(store:Store,batchId:string,group:number,layout:LongImageLayout) {
  const inspected=await inspectLayout(store,batchId,group,layout);
  const background={white:'#ffffff',gray:'#f1f5f9',black:'#0f172a'}[layout.background];
  const images=[];
  for(const item of inspected.items) images.push({input:await sharp(item.file,{limitInputPixels:40_000_000}).rotate().resize(layout.width,item.outputHeight,{fit:'fill'}).png().toBuffer(),top:item.top,left:0});
  const id=store.id('long-image');const filename=`${id}.${layout.format}`;
  const file=path.join(store.dataDir,'exports',filename);
  const pipeline=sharp({create:{width:inspected.width,height:inspected.height,channels:4,background}}).composite(images);
  try {
    await (layout.format==='jpg'?pipeline.flatten({background}).jpeg({quality:92}):pipeline.png()).toFile(file+'.tmp');
    fs.renameSync(file+'.tmp',file);
    store.transaction(()=>{
      store.put('layout',`${batchId}-${group}`,layout);
      store.put('export',id,{filename,batchId,group,layout,width:inspected.width,height:inspected.height,createdAt:new Date().toISOString()});
    });
  } catch(error) {fs.rmSync(file+'.tmp',{force:true});fs.rmSync(file,{force:true});throw error;}
  return {url:`/api/exports/${id}/download`,width:inspected.width,height:inspected.height};
}
