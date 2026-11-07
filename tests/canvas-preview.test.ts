import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {execFileSync} from 'node:child_process';
import {createApp} from '../apps/server/app';
import {createStore,type Store} from '../apps/server/store';
import {videoRuntime} from '../apps/server/video-runtime';
import type {Asset} from '../packages/contracts';
let dir:string,store:Store;
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-preview-'));store=createStore(dir,process.cwd());});
afterEach(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
describe('local canvas previews',()=>{
  it('extracts a video poster with the configured video runtime without changing the video',async({skip})=>{
    let ffmpeg=process.env.STUDIO_FFMPEG;
    if(!ffmpeg){try{ffmpeg=execFileSync(videoRuntime(store).python,['-c','import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'],{encoding:'utf8',timeout:10000}).trim();}catch{skip();return;}}
    const id='video-preview-test',file=path.join(dir,'media',id+'.mp4');
    execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','color=c=red:s=640x360:d=0.1','-c:v','libx264','-pix_fmt','yuv420p',file],{timeout:15000});
    const original=fs.readFileSync(file);
    const asset:Asset={id,url:`/media/${id}.mp4`,type:'video',mime:'video/mp4',bytes:original.length,source:'upload',createdAt:new Date().toISOString()};
    store.withWorkspace('canvas-qa',()=>store.put('asset',id,asset));
    const app=await createApp(store,{worker:false});
    try{
      const response=await app.inject(`/api/canvas-preview/${id}?size=384&workspace=canvas-qa`);
      expect(response.statusCode).toBe(200);
      expect(await sharp(response.rawPayload).metadata()).toMatchObject({width:384,height:216,format:'webp'});
      expect(fs.readFileSync(file).equals(original)).toBe(true);
    }finally{await app.close();}
  });
  it('downsamples without cropping, caches identical requests and retains originals',async()=>{
    const id='preview-test',file=path.join(dir,'media',id+'.png');
    await sharp({create:{width:2400,height:1200,channels:3,background:'#668866'}}).png().toFile(file);
    const asset:Asset={id,url:`/media/${id}.png`,type:'image',mime:'image/png',bytes:fs.statSync(file).size,source:'upload',createdAt:new Date().toISOString()};
    store.withWorkspace('canvas-qa',()=>store.put('asset',id,asset));
    const app=await createApp(store,{worker:false});
    try{
      const url=`/api/canvas-preview/${id}?size=384&workspace=canvas-qa`;
      const [a,b]=await Promise.all([app.inject(url),app.inject(url)]);
      expect(a.statusCode).toBe(200);expect(a.headers['content-type']).toContain('image/webp');
      expect(a.headers['cache-control']).toBe('private, max-age=86400');expect(a.rawPayload.equals(b.rawPayload)).toBe(true);
      expect(await sharp(a.rawPayload).metadata()).toMatchObject({width:384,height:192});
      expect(fs.readdirSync(path.join(dir,'.cache','canvas-previews'))).toHaveLength(1);
      expect(await sharp(file).metadata()).toMatchObject({width:2400,height:1200});
      expect((await app.inject(`/api/canvas-preview/${id}?workspace=other`)).statusCode).toBe(404);
      expect((await app.inject(`/api/canvas-preview/${id}?size=999999&workspace=canvas-qa`)).statusCode).toBe(400);
    }finally{await app.close();}
  });
});
