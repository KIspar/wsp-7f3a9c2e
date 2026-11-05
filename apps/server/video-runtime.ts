import fs from 'node:fs';
import path from 'node:path';
import {spawn,type ChildProcess} from 'node:child_process';
import {createRequire} from 'node:module';
import type {Store} from './store';
const require=createRequire(import.meta.url);
export function videoRuntime(store:Store){
 const win=process.platform==='win32',root=store.projectRoot;
 const python=process.env.STUDIO_PYTHON||[path.join(root,'runtime/python/python.exe'),path.join(root,'.runtime/video',win?'Scripts/python.exe':'bin/python')].find(p=>fs.existsSync(p))||(win?'python':'python3');
 const ffprobe=process.env.STUDIO_FFPROBE||(require('ffprobe-static') as {path:string}).path;
 const model=process.env.STUDIO_WHISPER_MODEL||[path.join(root,'runtime/models/whisper-base'),path.join(root,'.runtime/models/whisper-base')].find(p=>fs.existsSync(p))||path.join(root,'runtime/models/whisper-base');
 const env:NodeJS.ProcessEnv={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:process.env.TEMP,TMP:process.env.TMP,HOME:process.env.HOME,USERPROFILE:process.env.USERPROFILE,PYTHONUTF8:'1',PYTHONUNBUFFERED:'1',CRV_NO_MEMORY:'1',HF_HUB_OFFLINE:'1',STUDIO_FFPROBE:ffprobe,STUDIO_WHISPER_MODEL:model,...(process.env.STUDIO_FFMPEG?{STUDIO_FFMPEG:process.env.STUDIO_FFMPEG}:{})};
 function run(action:'doctor'|'extract'|'compose'|'frames',manifest?:string,onProgress?:(v:{step:string;error?:string})=>void,onChild?:(c:ChildProcess)=>void){
  return new Promise<void>((resolve,reject)=>{
   const child=spawn(python,[path.join(root,'apps/video-worker/worker.py'),action,...(manifest?[manifest]:[])],{env,windowsHide:true,detached:!win,stdio:['ignore','pipe','pipe']});onChild?.(child);
   let pending='',lastError='',stderr='';
   const timeout=setTimeout(()=>{stopVideoChild(child);reject(Error('本地视频处理超时，请检查任务与运行环境'));},action==='doctor'?30000:1800000);
   child.stdout?.on('data',chunk=>{pending+=chunk.toString();if(pending.length>64000)pending=pending.slice(-16000);const lines=pending.split('\n');pending=lines.pop()||'';for(const line of lines){try{const v=JSON.parse(line);if(typeof v.step==='string'){if(v.error)lastError=String(v.error).slice(0,2000);onProgress?.(v);}}catch{/* crv prints human progress too */}}});
   child.stderr?.on('data',chunk=>{stderr=(stderr+chunk).slice(-2500);});
   child.on('error',e=>{clearTimeout(timeout);reject(Error('无法启动 Python 视频处理：'+e.message));});
   child.on('close',code=>{clearTimeout(timeout);if(code===0)resolve();else reject(Error(lastError||stderr||'本地处理已停止'));});
  });
 }
 return {run,python,model,ffprobe};
}

export function stopVideoChild(child:ChildProcess){
 if(!child.pid)return;
 if(process.platform==='win32')spawn('taskkill.exe',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'}).on('error',()=>child.kill());
 else try{process.kill(-child.pid,'SIGTERM');}catch{child.kill();}
}
