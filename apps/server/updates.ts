import type {FastifyInstance} from 'fastify';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import type {Store} from './store';
import {fail} from './engine';
import {z} from 'zod';
import {blocksUpdate,newerUpdate,updateTaskKinds} from './update-policy';

export async function registerUpdateRoutes(app:FastifyInstance,store:Store,restart:()=>void){
  const directory=path.join(store.dataDir,'updates');await fs.mkdir(directory,{recursive:true});
  const read=async(name:string,fallback:unknown)=>fs.readFile(path.join(directory,name),'utf8').then(JSON.parse).catch(()=>fallback);
  let running=false,checking=false,closed=false,installing=false;
  const interrupted=await read('state.json',null);
  if(['downloading','preparing'].includes(interrupted?.phase))await fs.writeFile(path.join(directory,'state.json'),JSON.stringify({phase:'error',error:'上次更新准备已中断，请重新下载'}));
  const managed=process.env.STUDIO_UPDATE_SUPERVISED==='1'&&!process.env.STUDIO_PUBLIC_ORIGIN;
  const currentVersion=JSON.parse(await fs.readFile(path.join(store.projectRoot,'package.json'),'utf8')).version as string;
  const execute=(command:string)=>new Promise<any>((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(store.projectRoot,'scripts/update-manager.mjs'),command,store.projectRoot,store.dataDir],{stdio:['ignore','pipe','pipe'],windowsHide:true});
    let output='',error='';child.stdout.on('data',chunk=>{output+=chunk;if(output.length>8*1024*1024)child.kill();});child.stderr.on('data',chunk=>{error=(error+chunk).slice(-2000);});
    child.on('error',reject);child.on('close',code=>{if(code!==0){reject(Error(error.trim()||'版本更新失败'));return;}try{resolve(JSON.parse(output.trim().split('\n').at(-1)||'null'));}catch{reject(Error('更新进程响应无效'));}});
  });
  async function check(){if(checking)fail('版本检查正在进行',409);checking=true;try{return await execute('check');}finally{checking=false;}}
  function download(){if(running)fail('更新包正在准备',409);running=true;void execute('stage').catch(async error=>{await fs.writeFile(path.join(directory,'state.json'),JSON.stringify({phase:'error',error:error.message}));}).finally(()=>{running=false;});}
  app.get('/api/updates',async()=>{const check=await read('check.json',null);return {currentVersion,managed,checking,running,check:check?{...check,available:newerUpdate(check.latestVersion,currentVersion)}:null,state:await read('state.json',{phase:'idle'}),preferences:await read('preferences.json',{autoCheck:true,autoDownload:true})};});
  app.post('/api/updates/check',async()=>check());
  app.put('/api/updates/preferences',async request=>{const value=z.object({autoCheck:z.boolean(),autoDownload:z.boolean()}).parse(request.body);await fs.writeFile(path.join(directory,'preferences.json'),JSON.stringify(value));return value;});
  app.post('/api/updates/download',async()=>{download();return {started:true};});
  app.post('/api/updates/install',async()=>{
    if(installing)fail('正在准备重启',409);
    if(!managed)fail('请先停止开发服务，再使用 npm start 启动正式版后更新',409);
    const state=await read('state.json',null);if(state?.phase!=='ready'||running)fail('请先下载并校验更新包',409);
    const rows=store.db.prepare(`SELECT kind,value FROM workspace_documents WHERE kind IN (${updateTaskKinds.map(()=>'?').join(',')})`).all(...updateTaskKinds) as {kind:string;value:string}[];
    const busy=rows.some(row=>blocksUpdate(row.kind,JSON.parse(row.value)));
    if(busy)fail('请等待后台任务完成或核实后再更新',409);
    installing=true;
    try{await fs.writeFile(path.join(directory,'pending.json'),JSON.stringify({version:state.version,requestedAt:new Date().toISOString()}));}catch(error){installing=false;throw error;}
    setTimeout(restart,300).unref();return {restarting:true};
  });
  app.addHook('onRequest',async(request,reply)=>{if(installing&&!['GET','HEAD'].includes(request.method))return reply.code(503).send({message:'正在安装更新，请等待重启完成'});});
  async function automatic(){
    if(closed||checking||running)return;
    const preferences=await read('preferences.json',{autoCheck:true,autoDownload:true});if(!preferences.autoCheck)return;
    try{const result=await check();const state=await read('state.json',{});if(!closed&&result.available&&preferences.autoDownload&&!(state.phase==='ready'&&state.version===result.latestVersion))download();}catch{/* Explicit checks report errors; unattended checks stay silent. */}
  }
  const initial=setTimeout(()=>void automatic(),30000);initial.unref();
  const interval=setInterval(()=>void automatic(),6*60*60*1000);interval.unref();
  app.addHook('onClose',async()=>{closed=true;clearTimeout(initial);clearInterval(interval);});
}
