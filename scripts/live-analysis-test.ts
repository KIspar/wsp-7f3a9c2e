/** Explicit bounded acceptance only. Re-running resumes existing jobs; no paid retries. */
import fs from 'node:fs';
import path from 'node:path';
import type { AnalysisInput,AnalysisJob } from '../packages/analysis';
const base=process.env.STUDIO_WEB||'http://127.0.0.1:4310',dir=path.resolve('docs/reports/analysis-live-20261028');
fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,'manifest.json'),manifest:any=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{startedAt:new Date().toISOString(),mode:'real-api-analysis',jobs:[],assets:{},videoTruth:'0–3s: red square on white moving horizontally; 3–6s: blue square on white moving in the opposite direction. No audio. Native whole-video inline_data, not extracted stills.'};
const persist=()=>fs.writeFileSync(file,JSON.stringify(manifest,null,2));
const boot=await (await fetch(base+'/api/bootstrap')).json() as any;
async function api(url:string,body?:unknown){const response=await fetch(base+'/api'+url,{method:body===undefined?'GET':'POST',headers:{...(body instanceof FormData?{}:{'Content-Type':'application/json'}),'X-Studio-Token':boot.token},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});const data=await response.json() as any;if(!response.ok)throw new Error(data.message||`HTTP ${response.status}`);return data;}
async function upload(name:string,filename:string,video=false){if(manifest.assets[name])return manifest.assets[name];const form=new FormData();form.append('file',new Blob([fs.readFileSync(filename)],{type:video?'video/mp4':'image/jpeg'}),path.basename(filename));const a=await api(video?'/analysis/video':'/upload',form);manifest.assets[name]=a.id;persist();return a.id;}
const product=await upload('product','docs/reports/henley-live-20261028/inputs/product-1.jpg');
const video=await upload('video',path.join(dir,'motion-sequence.mp4'),true);
async function run(name:string,input:Partial<AnalysisInput>){
 let entry=manifest.jobs.find((j:any)=>j.name===name);
 if(!entry){entry={name,input:{text:'',productName:'',assetIds:[],...input,idempotencyKey:crypto.randomUUID()}};manifest.jobs.push(entry);persist();}
 if(!entry.id){const lookup=await api('/analysis/by-key/'+entry.input.idempotencyKey);if(lookup.job)entry.id=lookup.job.id;else if(!entry.submissionStarted){entry.submissionStarted=new Date().toISOString();persist();const result=await api('/analysis/jobs',entry.input);entry.id=result.id;}else throw new Error('Previous submission unknown; do not resubmit '+name);persist();}
 for(let i=0;i<280;i++){
  const job:AnalysisJob=await api('/analysis/jobs/'+entry.id);entry.job=job;persist();
  if(!['queued','preparing','submitting'].includes(job.status)){
   for(let c=0;c<3&&entry.job.billing.status!=='final';c++){entry.job=await api('/analysis/jobs/'+entry.id+'/billing',{});persist();if(entry.job.billing.status!=='final')await new Promise(resolve=>setTimeout(resolve,3000));}
   fs.writeFileSync(path.join(dir,name+'.md'),entry.job.result||entry.job.error||'无结果');
   console.log(JSON.stringify({name,status:entry.job.status,taskId:entry.job.upstreamTaskId,usage:entry.job.usage,billing:entry.job.billing,preview:entry.job.preview,error:entry.job.error}));return;
  }
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 throw new Error('Polling limit reached; resume existing job '+name);
}
await run('tt-vision-probe',{action:'verify-image',verificationModel:'tt-6.1-sol',assetIds:[product],expectedTerms:['棕','扣','纹']});
await run('gem-vision-probe',{action:'verify-image',verificationModel:'gem-3.8-flash',assetIds:[product],expectedTerms:['棕','扣','纹']});
await run('gem-native-video',{action:'reverse-video',assetIds:[video],text:'描述时间顺序、颜色变化、物体动作及运动方向。没有音轨，不要编造声音。'});
await run('tt-text-polish',{action:'polish',text:'男士上身主图，保留三扣和纹理，背景米灰，成年男模自然站姿，无文字。'});
const moreProducts=await Promise.all([2,3].map(i=>upload('product'+i,`docs/reports/henley-live-20261028/inputs/product-${i}.jpg`)));
await run('tt-selling-points',{action:'selling-points',assetIds:[product,...moreProducts],productName:'麦穗纹亨利领卫衣男款2026春季新款大码潮牌痞帅美式立领长袖T恤',text:'只提供产品名和原图，没有提供面料成分或实际尺码数据。'});
const competitor=await upload('competitor','docs/reports/henley-live-20261028/inputs/competitor-4.jpg');
// Explicit switch tests the same global setting used by the UI. Restore TT after this bounded test.
const switchResponse=await fetch(base+'/api/analysis/settings',{method:'PUT',headers:{'Content-Type':'application/json','X-Studio-Token':boot.token},body:JSON.stringify({defaultModelId:'gem-3.8-flash'})});
if(!switchResponse.ok)throw new Error('Could not switch test model');
try{await run('gem-reference-reverse',{action:'reverse-image',assetIds:[competitor]});}
finally{await fetch(base+'/api/analysis/settings',{method:'PUT',headers:{'Content-Type':'application/json','X-Studio-Token':boot.token},body:JSON.stringify({defaultModelId:'tt-6.1-sol'})});}
const linear=await upload('linear-video',path.join(dir,'motion-linear-zh.mp4'),true);
await run('gem-native-video-zh',{action:'reverse-video',assetIds:[linear],text:'所有内容和整片、分镜提示词请使用简体中文。描述实际看见的时间顺序、颜色、动作、运动方向；无音轨。'});
const switchZh=await fetch(base+'/api/analysis/settings',{method:'PUT',headers:{'Content-Type':'application/json','X-Studio-Token':boot.token},body:JSON.stringify({defaultModelId:'gem-3.8-flash'})});
if(!switchZh.ok)throw new Error('Could not switch test model');
try{await run('gem-reference-reverse-zh',{action:'reverse-image',assetIds:[competitor],text:'分析和可复用提示词全部使用简体中文。'});}
finally{await fetch(base+'/api/analysis/settings',{method:'PUT',headers:{'Content-Type':'application/json','X-Studio-Token':boot.token},body:JSON.stringify({defaultModelId:'tt-6.1-sol'})});}
const config=await api('/analysis/config');manifest.config=config;manifest.finishedAt=new Date().toISOString();persist();console.log('Real analysis acceptance saved.');
