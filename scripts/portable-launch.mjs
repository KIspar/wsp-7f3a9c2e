import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');process.chdir(root);
const python=path.join(root,'runtime/python/python.exe'),node=path.join(root,'runtime/node/node.exe');
const env={...process.env,STUDIO_ROOT:root,STUDIO_DATA:path.join(root,'data'),STUDIO_PYTHON:python,STUDIO_WHISPER_MODEL:path.join(root,'runtime/models/whisper-base'),STUDIO_FFMPEG:path.join(root,'runtime/bin/ffmpeg.exe'),STUDIO_FFPROBE:path.join(root,'runtime/bin/ffprobe.exe'),STUDIO_PORTABLE:'1'};
function sameInstance(health){return health.database===true&&typeof health.dataDir==='string'&&path.resolve(health.dataDir).toLowerCase()===path.resolve(env.STUDIO_DATA).toLowerCase();}
function openBrowser(port){const opener=spawn('cmd.exe',['/d','/c','start','','http://127.0.0.1:'+port],{windowsHide:true,stdio:'ignore'});opener.on('error',()=>console.log('请在浏览器打开 http://127.0.0.1:'+port));}
if(process.argv.includes('--stop')){
 if(!fs.existsSync(path.join(root,'data/endpoint.json'))){console.log('此文件夹没有正在运行的工作台。');process.exit(0);}
 const endpoint=JSON.parse(fs.readFileSync(path.join(root,'data/endpoint.json'),'utf8'));
 if(!Number.isInteger(endpoint.port)||endpoint.port<1||endpoint.port>65535)throw Error('后台端口记录无效');
 const base='http://127.0.0.1:'+endpoint.port;
 let health;try{health=await fetch(base+'/api/health',{signal:AbortSignal.timeout(3000)}).then(r=>r.json());}catch{console.log('此文件夹的后台已经停止。');process.exit(0);}
 if(!sameInstance(health))throw Error('端口已由其他工作台使用，未停止其他服务。');
 const boot=await fetch(base+'/api/bootstrap',{signal:AbortSignal.timeout(3000)}).then(r=>r.json());
 const response=await fetch(base+'/api/local/shutdown',{method:'POST',headers:{'X-Studio-Token':boot.token}});if(!response.ok)throw Error('后台停止失败，请检查日志');console.log('后台正在安全停止。');
}else{
 if(Number(process.versions.node.split('.')[0])<24)throw Error('此版本需要 Node.js 24 或更新版本。请使用发布包内的启动 BAT。');
 const endpointFile=path.join(root,'data/endpoint.json');
 if(!process.argv.includes('--check')&&fs.existsSync(endpointFile)){try{const {port}=JSON.parse(fs.readFileSync(endpointFile,'utf8'));if(Number.isInteger(port)&&port>0&&port<65536){const r=await fetch('http://127.0.0.1:'+port+'/api/health',{signal:AbortSignal.timeout(1500)});if(r.ok&&sameInstance(await r.json())){openBrowser(port);console.log('已打开正在运行的工作台。');process.exit(0);}}}catch{/* stale endpoint is recoverable */}}
 for(const file of [python,node,env.STUDIO_FFMPEG,env.STUDIO_FFPROBE,path.join(root,'runtime/models/whisper-base/model.bin'),path.join(root,'dist-server/index.js')])if(!fs.existsSync(file))throw Error('安装包缺少文件：'+file);
 fs.mkdirSync('data/logs',{recursive:true});
 await import('sharp');await import('node:sqlite');
 const doctor=spawn(python,['apps/video-worker/worker.py','doctor'],{env:{...env,PYTHONUTF8:'1',HF_HUB_OFFLINE:'1'},stdio:'inherit',windowsHide:true});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{doctor.kill();reject(Error('本地环境检查超时'));},120000);doctor.on('error',e=>{clearTimeout(timer);reject(e);});doctor.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('本地环境检查未通过，请保留上方错误信息。'));});});
 if(process.argv.includes('--check')){console.log('Node、SQLite、图像库、本地视频工具及离线模型检查通过。');process.exit(0);}
 let port=4310;for(;port<4400;port++){const free=await new Promise(resolve=>{const s=net.createServer();s.on('error',()=>resolve(false));s.listen(port,'127.0.0.1',()=>s.close(()=>resolve(true)));});if(free)break;}
 if(port>=4400)throw Error('没有可用本地端口');env.PORT=String(port);
 const log=fs.openSync('data/logs/server.log','a');const child=spawn(node,['dist-server/index.js'],{env,stdio:['inherit',log,log],windowsHide:true});
 child.on('error',e=>{console.error(e.message);process.exitCode=1;});
 child.on('exit',code=>{process.exitCode=code||0;});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{try{const b=await fetch('http://127.0.0.1:'+port+'/api/bootstrap').then(r=>r.json());await fetch('http://127.0.0.1:'+port+'/api/local/shutdown',{method:'POST',headers:{'X-Studio-Token':b.token}});}catch{child.kill();}});
 let ready=false;for(let i=0;i<60;i++){try{const r=await fetch('http://127.0.0.1:'+port+'/api/health');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
 if(!ready){child.kill();console.error(fs.readFileSync('data/logs/server.log','utf8').slice(-5000));throw Error('后台未能启动，请查看 data/logs/server.log');}
 fs.writeFileSync('data/endpoint.json',JSON.stringify({port}));
 openBrowser(port);
 console.log('工作台已启动；使用“停止工作台.bat”安全停止。日志：data/logs/server.log');
}
