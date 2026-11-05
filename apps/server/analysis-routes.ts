import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { analysisModelIds, analysisInputSchema } from '../../packages/analysis';
import type { Asset } from '../../packages/contracts';
import type { Store } from './store';
import { createAnalysisService, type AnalysisService } from './analysis';
import { probeVideo } from './analysis-media';
import { fail } from './engine';
export function registerAnalysisRoutes(app:FastifyInstance,store:Store,enabled:boolean,provided?:AnalysisService){
  const service=provided||createAnalysisService(store);
  app.get('/api/analysis/estimate',async()=>service.estimate());
  app.get('/api/analysis/config',async()=>({models:service.models(),settings:service.settings()}));
  app.put('/api/analysis/settings',async request=>{
    const value=z.object({defaultModelId:z.enum(analysisModelIds)}).parse(request.body);return service.setDefault(value.defaultModelId);
  });
  app.put('/api/analysis/models/:id',async request=>{
    const {id}=z.object({id:z.enum(analysisModelIds)}).parse(request.params);
    const change=z.object({key:z.string().max(250).optional(),enabled:z.boolean().optional(),revision:z.number().int().optional()}).parse(request.body);
    return service.configure(id,change);
  });
  app.get('/api/analysis/jobs',async()=>service.jobs());
  app.get('/api/analysis/jobs/:id',async request=>service.job(z.object({id:z.string()}).parse(request.params).id));
  app.get('/api/analysis/by-key/:key',async request=>{
    const {key}=z.object({key:z.string()}).parse(request.params);
    return {job:service.jobs().find(j=>j.input.idempotencyKey===key)||null};
  });
  app.post('/api/analysis/jobs',async request=>service.submit(request.body));
  app.post('/api/selling-points',async request=>service.submit(analysisInputSchema.parse({...request.body as object,action:'selling-points'})));
  app.post('/api/analysis/jobs/:id/billing',async request=>service.reconcile(z.object({id:z.string()}).parse(request.params).id));
  app.post('/api/analysis/video',async request=>{
    const part=await request.file({limits:{fileSize:30*1024*1024}});if(!part)fail('请选择单个视频');
    const buffer=await part.toBuffer();if(!buffer.length)fail('视频为空');
    const id=store.id('video'),temp=path.join(store.dataDir,'media',id+'.tmp');
    fs.writeFileSync(temp,buffer,{flag:'wx'});
    try{
      let info:Awaited<ReturnType<typeof probeVideo>>;
      try{info=await probeVideo(temp);}catch(error){if((error as {statusCode?:number}).statusCode)throw error;fail('无法探测视频格式和时长，请检查视频是否损坏及 ffprobe 安装状态');}
      const filename=id+'.'+info.extension;fs.renameSync(temp,path.join(store.dataDir,'media',filename));
      const asset:Asset & {duration:number}={id,url:'/media/'+filename,type:'video',mime:info.mime,bytes:buffer.length,source:'upload',createdAt:new Date().toISOString(),duration:info.duration};
      store.transaction(()=>store.put('asset',id,asset));return asset;
    }finally{fs.rmSync(temp,{force:true});}
  });
  if(enabled)service.start();
  app.addHook('onClose',async()=>service.stop());
  return service;
}
