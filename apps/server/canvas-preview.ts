import type {FastifyInstance} from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import sharp from 'sharp';
import {z} from 'zod';
import type {Asset} from '../../packages/contracts';
import type {Store} from './store';
import {assetFile} from './analysis-media';
import {fail} from './engine';
import {videoRuntime} from './video-runtime';

/** Originals remain the input for generation/export. Only the canvas uses these local previews. */
export function registerCanvasPreviewRoutes(app:FastifyInstance,store:Store){
  const pending=new Map<string,Promise<Buffer>>();
  let ffmpeg:Promise<string>|undefined;
  function resolveFfmpeg(){
    if(process.env.STUDIO_FFMPEG)return Promise.resolve(process.env.STUDIO_FFMPEG);
    // Reuse the project's existing portable/Python runtime, with system ffmpeg as a fallback.
    return ffmpeg??=promisify(execFile)(videoRuntime(store).python,['-c','import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'],{timeout:10000,maxBuffer:8192}).then(result=>result.stdout.trim()).catch(()=>'ffmpeg');
  }
  let active=0;
  const waiting:(()=>void)[]=[];
  async function limited<T>(work:()=>Promise<T>){
    if(active>=2)await new Promise<void>(resolve=>waiting.push(resolve));
    else active++;
    try{return await work();}finally{const next=waiting.shift();if(next)next();else active--;}
  }
  app.get('/api/canvas-preview/:id',async(request,reply)=>{
    const {id}=z.object({id:z.string().min(1).max(120)}).parse(request.params);
    const query=z.object({size:z.enum(['384','768','1536']).default('768'),workspace:z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/).optional()}).parse(request.query);
    const asset=query.workspace?store.withWorkspace(query.workspace,()=>store.get<Asset>('asset',id)):store.get<Asset>('asset',id);
    if(!asset||!['image','video'].includes(asset.type))return reply.code(404).send({message:'预览素材不存在'});
    const file=assetFile(store,asset),stat=await fs.stat(file).catch(()=>undefined);
    if(!stat)return reply.code(404).send({message:'预览素材文件不存在'});
    const size=Number(query.size),key=createHash('sha256').update(`v1:${file}:${stat.size}:${stat.mtimeMs}:${size}`).digest('hex');
    const cacheDir=path.join(store.dataDir,'.cache','canvas-previews'),cache=path.join(cacheDir,key+'.webp');
    let job=pending.get(key);
    if(!job){
      job=limited(async()=>{
        const cached=await fs.readFile(cache).catch(()=>undefined);if(cached)return cached;
        let input:Buffer|string=file;
        if(asset.type==='video'){
          const result=await promisify(execFile)(await resolveFfmpeg(),['-v','error','-i',file,'-frames:v','1','-vf',`scale=${size}:${size}:force_original_aspect_ratio=decrease`,'-f','image2pipe','-vcodec','mjpeg','pipe:1'],{encoding:'buffer',timeout:15000,maxBuffer:8*1024*1024}).catch(()=>undefined);
          if(!result?.stdout.length)fail('视频封面暂不可用，请点击播放查看',404);
          input=result!.stdout;
        }
        const bytes=await sharp(input,{limitInputPixels:80_000_000}).rotate().resize(size,size,{fit:'inside',withoutEnlargement:true}).webp({quality:84}).toBuffer();
        await fs.mkdir(cacheDir,{recursive:true});
        await fs.writeFile(cache,bytes);
        return bytes;
      });
      pending.set(key,job);
      void job.finally(()=>pending.delete(key)).catch(()=>{});
    }
    const bytes=await job;
    return reply.header('Cache-Control','private, max-age=86400').type('image/webp').send(bytes);
  });
}
