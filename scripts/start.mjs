import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('AI 创作工作台需要 Node.js 24 或更新版本。'); process.exit(1);
}
process.chdir(path.resolve(import.meta.dirname, '..'));
if (!fs.existsSync('dist-server/index.js') || !fs.existsSync('dist/index.html')) {
  console.error('请先运行 npm run build。'); process.exit(1);
}
async function available(port) {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}
let port = Number(process.env.PORT || 4310);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须为 1–65535。');
while (!(await available(port))) { if (port === 65535) throw new Error('未找到可用端口'); port++; }
const dataDir=path.resolve(process.env.STUDIO_DATA||'data');
let child,stopping=false;
function manager(command){return new Promise((resolve,reject)=>{const task=spawn(process.execPath,['scripts/update-manager.mjs',command,process.cwd(),dataDir],{stdio:'inherit'});task.on('error',reject);task.on('exit',code=>code===0?resolve():reject(Error('更新操作未完成')));});}
async function launch(updated=false){
  if(stopping)return;
  child=spawn(process.execPath,['dist-server/index.js'],{env:{...process.env,PORT:String(port),STUDIO_UPDATE_SUPERVISED:'1'},stdio:'inherit'});
  let exited=false;child.on('error',error=>{console.error(error.message);process.exitCode=1;});
  child.on('exit',async code=>{
    exited=true;if(stopping){process.exitCode=code??0;return;}
    if(code===85){try{await manager('apply');await launch(true);}catch(error){console.error(error.message);await launch(false);}return;}
    if(updated){try{await manager('rollback');await launch(false);}catch(error){console.error(error.message);process.exitCode=1;}return;}
    process.exitCode=code??1;
  });
  if(updated){
    for(let attempt=0;attempt<60&&!exited;attempt++){
      try{const response=await fetch(`http://127.0.0.1:${port}/healthz`,{signal:AbortSignal.timeout(1000)});if(response.ok){await manager('healthy');updated=false;return;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    if(!exited)child.kill('SIGTERM');
  }
}
// Handle shutdown during recovery/first health checks as well as normal operation.
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;child?.kill(signal);});
// Finish an explicitly requested update after a power interruption, with a closed database.
if(fs.existsSync(path.join(dataDir,'updates/applied.json')))await manager('rollback');
const pendingUpdate=fs.existsSync(path.join(dataDir,'updates/pending.json'));
if(pendingUpdate)await manager('apply');
await launch(pendingUpdate);
console.log(`浏览器访问：http://127.0.0.1:${port} · 关闭此窗口将停止后台任务`);
