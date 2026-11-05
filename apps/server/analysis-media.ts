import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import sharp, { type Sharp, type OverlayOptions } from 'sharp';
import { createRequire } from 'node:module';
import type { Asset } from '../../packages/contracts';
import type { Store } from './store';
import { fail } from './engine';
const require=createRequire(import.meta.url);
export const sha256=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
export function assetFile(store:Store,asset:Asset){
  return path.join(asset.source==='example'?path.join(store.projectRoot,'public/examples'):path.join(store.dataDir,'media'),path.basename(asset.url));
}
export async function probeVideo(file:string,options:{input?:boolean}={}) {
  const binary=process.env.STUDIO_FFPROBE || (require('ffprobe-static') as {path:string}).path;
  const {stdout}=await promisify(execFile)(binary,['-v','error','-show_format','-show_streams','-of','json',file],{timeout:20000,maxBuffer:1024*1024});
  const data=JSON.parse(stdout),format=String(data.format?.format_name||''),duration=Number(data.format?.duration);
  const stream=data.streams?.find((s:{codec_type:string})=>s.codec_type==='video');
  if(!stream || !Number.isFinite(duration)||duration<=0) fail('无法读取视频画面或真实时长');
  const prefix=fs.readFileSync(file).subarray(0,4096);
  const mp4=prefix.subarray(4,8).toString()==='ftyp' && format.includes('mp4');
  const webm=prefix.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])) && prefix.includes(Buffer.from('webm')) && format.includes('webm');
  if(!mp4&&!webm) fail('仅接受真实 MP4 / WebM 文件，不支持通过改扩展名上传');
  if(options.input!==false&&duration>120) fail('视频真实时长超过 120 秒，请自行剪辑后上传；系统不会截断');
  if(options.input!==false&&fs.statSync(file).size>30*1024*1024) fail('视频不能超过 30MB');
  return {duration,mime:mp4?'video/mp4':'video/webm',extension:mp4?'mp4':'webm'};
}
export async function analysisPreview(store:Store,assets:Asset[],verify:boolean,numbers?:number[]){
  if(!assets.length)return;
  const edge=verify?512:1024,limit=verify?48*1024:128*1024;
  let image:Sharp;
  if(verify){image=sharp(assetFile(store,assets[0]),{limitInputPixels:40_000_000}).rotate().resize(edge,edge,{fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'});}
  else {
    const cols=assets.length===1?1:2,rows=Math.ceil(assets.length/cols),cell=Math.floor(edge/Math.max(cols,rows)),label=40;
    const composite:OverlayOptions[]=[];
    for(let index=0;index<assets.length;index++){
      const img=await sharp(assetFile(store,assets[index]),{limitInputPixels:40_000_000}).rotate().resize(cell,cell-label,{fit:'contain',background:'#ffffff'}).flatten({background:'#ffffff'}).jpeg().toBuffer();
      const x=(index%cols)*cell,y=Math.floor(index/cols)*cell;
      composite.push({input:img,left:x,top:y+label});
      composite.push({input:Buffer.from(`<svg width="${cell}" height="${label}"><rect width="100%" height="100%" fill="white"/><text x="16" y="28" font-size="24" fill="black">IMAGE ${numbers?.[index]??index+1}</text></svg>`),left:x,top:y});
    }
    image=sharp({create:{width:cell*cols,height:cell*rows,channels:3,background:'#ffffff'}}).composite(composite);
  }
  const raw=await image.png().toBuffer();
  let buffer=Buffer.alloc(0),size=edge;
  for(;size>=256;size=Math.floor(size*.8)){
    for(const quality of [80,65,50,35]){buffer=await sharp(raw).resize(size,size,{fit:'inside',withoutEnlargement:true}).jpeg({quality,mozjpeg:true}).toBuffer();if(buffer.length<=limit)break;}
    if(buffer.length<=limit)break;
  }
  if(buffer.length>limit) fail('分析预览压缩失败，未发送任何素材');
  const meta=await sharp(buffer).metadata(),filename=`analysis-preview-${sha256(buffer).slice(0,24)}.jpg`,file=path.join(store.dataDir,'media',filename);
  if(!fs.existsSync(file))fs.writeFileSync(file,buffer,{flag:'wx'});
  return {buffer,url:`/media/${filename}`,bytes:buffer.length,width:meta.width!,height:meta.height!,sha256:sha256(buffer)};
}
