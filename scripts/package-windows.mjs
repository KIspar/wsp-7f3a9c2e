// Cross-platform staging of a Windows x64 folder. Windows execution is verified separately.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const root=path.resolve(import.meta.dirname,'..');
const stage=path.resolve(process.argv[2]||path.join(root,'release/AI-Creative-Studio-Windows-x64-20261101'));
const cache=path.join(root,'.runtime/windows-downloads');
const python=process.env.STUDIO_BUILD_PYTHON||path.join(root,'.runtime/video/bin/python');
const buildEnv={...process.env};
// Do not inherit a shell's stale proxy configuration into build subprocesses.
for(const key of Object.keys(buildEnv))if(/^(https?|all)_proxy$/i.test(key))delete buildEnv[key];
const sources=[];
const testReportFile=path.join(root,'output/research-flow/vitest.json');
const testReport=fs.existsSync(testReportFile)?JSON.parse(fs.readFileSync(testReportFile,'utf8')):undefined;
const passedTests=testReport?.success?testReport.numPassedTests:null;
let transfers=0;const transferQueue=[];
async function transfer(action){if(transfers>=48)await new Promise(resolve=>transferQueue.push(resolve));transfers++;try{return await action();}finally{transfers--;transferQueue.shift()?.();}}
async function request(url,options={}){let last;for(let i=0;i<4;i++)try{const r=await fetch(url,{signal:AbortSignal.timeout(60000),...options});if(!r.ok)throw Error(`${r.status}: ${url}`);return r;}catch(e){last=e;}throw last;}
function run(cmd,args,options={}){return new Promise((resolve,reject)=>{const child=spawn(cmd,args,{cwd:root,env:buildEnv,stdio:'inherit',...options});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`${cmd} exited ${code}`)));});}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function download(url,file,expected,size){
 fs.mkdirSync(path.dirname(file),{recursive:true});
 if(!fs.existsSync(file)||expected&&sha(fs.readFileSync(file))!==expected){
  console.log('Download: '+path.basename(file));
  if(!size){const head=await request(url,{method:'HEAD'});size=Number(head.headers.get('content-length'));}
  if(size>=512*1024){
   const fd=fs.openSync(file+'.part','w');fs.ftruncateSync(fd,size);
   const chunkSize=64*1024;
   try{await Promise.all(Array.from({length:Math.ceil(size/chunkSize)},(_,i)=>transfer(async()=>{
    const start=i*chunkSize,end=Math.min(size-1,start+chunkSize-1);
    let last;for(let attempt=0;attempt<3;attempt++)try{
     const response=await fetch(url,{headers:{Range:`bytes=${start}-${end}`},signal:AbortSignal.timeout(60000)});
     if(response.status!==206)throw Error(`Range request returned ${response.status}: ${url}`);
     const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length!==end-start+1)throw Error('Incomplete download range');
     fs.writeSync(fd,bytes,0,bytes.length,start);return;
    }catch(error){last=error;}
    throw Error(`Failed to download ${path.basename(file)} range ${start}-${end}: ${last?.message}`);
   })));}finally{fs.closeSync(fd);}
  }else await transfer(async()=>{let last;for(let i=0;i<4;i++)try{const response=await request(url,{signal:AbortSignal.timeout(180000)});await pipeline(Readable.fromWeb(response.body),fs.createWriteStream(file+'.part'));return;}catch(e){last=e;}throw last;});
  fs.renameSync(file+'.part',file);
 }
 const digest=sha(fs.readFileSync(file));if(expected&&digest!==expected)throw Error('Checksum mismatch: '+file);
 sources.push({url,file:path.basename(file),sha256:digest,bytes:fs.statSync(file).size});return file;
}
function copy(name){const dest=path.join(stage,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.cpSync(path.join(root,name),dest,{recursive:true,filter:p=>!p.includes('__pycache__')&&!p.endsWith('.DS_Store')});}
if(fs.existsSync(stage)&&!process.argv.includes('--resume'))throw Error('Output folder already exists: '+stage);
for(const file of ['dist/index.html','dist-server/index.js'])if(!fs.existsSync(path.join(root,file)))throw Error('Run npm run build before packaging.');
fs.mkdirSync(stage,{recursive:true});
for(const name of ['dist','dist-server','public','skills','resources','extensions','apps/video-worker','scripts/portable-launch.mjs','package.json','package-lock.json'])copy(name);
for(const name of ['runtime/node','runtime/python','runtime/bin','runtime/models','licenses','data'])fs.mkdirSync(path.join(stage,name),{recursive:true});

const nodeVersion='24.14.0';
const nodeZip=`node-v${nodeVersion}-win-x64.zip`;
const sums=await fetch(`https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`).then(r=>{if(!r.ok)throw Error('Node checksum list unavailable');return r.text();});
const expected=sums.split('\n').find(line=>line.trim().endsWith(' '+nodeZip))?.trim().split(/\s+/)[0];
if(!expected)throw Error('Node checksum entry missing');
fs.writeFileSync(path.join(stage,'licenses/Node-SHASUMS256.txt'),sums);
await download(`https://nodejs.org/dist/v${nodeVersion}/${nodeZip}`,path.join(cache,nodeZip),expected);
await download('https://api.nuget.org/v3-flatcontainer/python/3.11.9/python.3.11.9.nupkg',path.join(cache,'python.3.11.9.nupkg'));
await run(python,['-c',String.raw`
import sys,zipfile,pathlib
cache,stage=map(pathlib.Path,sys.argv[1:])
with zipfile.ZipFile(cache/'node-v24.14.0-win-x64.zip') as z:
 for name in ['node.exe','LICENSE']:
  dest=stage/('runtime/node/node.exe' if name=='node.exe' else 'licenses/Node-LICENSE.txt')
  dest.write_bytes(z.read('node-v24.14.0-win-x64/'+name))
with zipfile.ZipFile(cache/'python.3.11.9.nupkg') as z:
 for info in z.infolist():
  if info.filename.startswith('tools/') and not info.is_dir():
   dest=stage/'runtime/python'/info.filename.removeprefix('tools/');dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(z.read(info))
`,cache,stage]);
fs.writeFileSync(path.join(stage,'runtime/python/python311._pth'),'python311.zip\n.\nLib\nDLLs\nLib/site-packages\nimport site\n');

console.log('Install Windows Node production dependencies');
const sharpLib=path.join(stage,'node_modules/@img/sharp-win32-x64/lib');
if(!fs.existsSync(sharpLib)||!fs.readdirSync(sharpLib).some(name=>name.endsWith('.node')))await run(process.platform==='win32'?'npm.cmd':'npm',['ci','--omit=dev','--ignore-scripts','--os=win32','--cpu=x64','--registry=https://registry.npmjs.org','--no-audit','--no-fund'],{cwd:stage});
fs.copyFileSync(path.join(stage,'node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe'),path.join(stage,'runtime/bin/ffprobe.exe'));

console.log('Resolve Python 3.11 Windows x64 wheels');
const wheelLock=fs.readFileSync(path.join(root,'scripts/windows-python-constraints.txt'),'utf8').split(/\r?\n/).filter(line=>line.trim()&&!line.startsWith('#'));
const wheelResults=await Promise.allSettled(wheelLock.map(async line=>{
 const [name,version]=line.split('==');
 const data=await transfer(async()=>{let last;for(let i=0;i<4;i++)try{const response=await request(`https://pypi.org/pypi/${name}/${version}/json`);return await response.json();}catch(e){last=e;}throw Error(`Cannot resolve ${line}: ${last?.message}`);});
 const wheel=data.urls.filter(f=>/-(cp311-cp311|cp3(?:7|8|9|10|11)-abi3|py3-none|py2.py3-none)-(win_amd64|any)\.whl$/.test(f.filename)).sort((a,b)=>(a.filename.includes('win_amd64')?0:1)-(b.filename.includes('win_amd64')?0:1))[0];
 if(!wheel)throw Error(`No Python 3.11 Windows x64 wheel: ${line}`);
 await download(wheel.url,path.join(cache,'wheels',wheel.filename),wheel.digests.sha256,wheel.size);
}));
const wheelErrors=wheelResults.filter(r=>r.status==='rejected');if(wheelErrors.length)throw new AggregateError(wheelErrors.map(r=>r.reason),'Windows wheel downloads failed');
// Check the complete dependency graph offline, using only the verified target wheels.
await run(python,['-m','pip','download','--no-index','--find-links',path.join(cache,'wheels'),'--dest',path.join(cache,'wheels'),'--platform','win_amd64','--python-version','3.11','--implementation','cp','--abi','cp311','--only-binary=:all:','-r',path.join(root,'apps/video-worker/requirements.txt'),'-c',path.join(root,'scripts/windows-python-constraints.txt'),'msvc-runtime==14.44.35112','colorama==0.4.6','pyreadline3==3.5.6']);
await run(python,['-c',String.raw`
import sys,zipfile,pathlib,shutil,hashlib,json
cache,stage=map(pathlib.Path,sys.argv[1:]);site=stage/'runtime/python/Lib/site-packages';site.mkdir(parents=True,exist_ok=True)
wheels=[]
for wheel in sorted((cache/'wheels').glob('*.whl')):
 with zipfile.ZipFile(wheel) as z:
  for info in z.infolist():
   p=pathlib.PurePosixPath(info.filename)
   if '..' in p.parts or p.is_absolute():raise ValueError('Invalid wheel path')
   if '.data' in p.parts[0]:
    if len(p.parts)>2 and p.parts[1] in ('purelib','platlib'):dest=site.joinpath(*p.parts[2:])
    elif len(p.parts)>2 and p.parts[1]=='data':dest=(stage/'runtime/python').joinpath(*p.parts[2:])
    elif len(p.parts)>2 and p.parts[1]=='scripts':dest=(stage/'runtime/python/Scripts').joinpath(*p.parts[2:])
    else:continue
   else:dest=site.joinpath(*p.parts)
   if info.is_dir():dest.mkdir(parents=True,exist_ok=True)
   else:dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(z.read(info))
 wheels.append({'file':wheel.name,'sha256':hashlib.sha256(wheel.read_bytes()).hexdigest(),'bytes':wheel.stat().st_size})
(stage/'licenses/python-wheels.json').write_text(json.dumps(wheels,indent=2),encoding='utf-8')
ffmpeg=list((site/'imageio_ffmpeg/binaries').glob('*.exe'))
if len(ffmpeg)!=1:raise ValueError('Windows ffmpeg executable missing')
shutil.copy2(ffmpeg[0],stage/'runtime/bin/ffmpeg.exe')
`,cache,stage]);
fs.cpSync(path.join(root,'.runtime/models/whisper-base'),path.join(stage,'runtime/models/whisper-base'),{recursive:true,filter:p=>!p.includes('.cache')});

const bat=(args,pause=false)=>['@echo off','chcp 65001 >nul','setlocal','pushd "%~dp0"','if not exist "runtime\\node\\node.exe" goto missing','"runtime\\node\\node.exe" "scripts\\portable-launch.mjs"'+args,'set "STUDIO_EXIT=%ERRORLEVEL%"',pause?'pause':'if not "%STUDIO_EXIT%"=="0" pause','popd','exit /b %STUDIO_EXIT%',':missing','echo Missing runtime\\node\\node.exe. Extract the whole release folder first.','pause','popd','exit /b 1',''].join('\r\n');
fs.writeFileSync(path.join(stage,'run.bat'),bat(''));
fs.writeFileSync(path.join(stage,'启动工作台.bat'),bat(''));
fs.writeFileSync(path.join(stage,'停止工作台.bat'),bat(' --stop'));
fs.writeFileSync(path.join(stage,'检查运行环境.bat'),bat(' --check',true));
fs.writeFileSync(path.join(stage,'使用说明.txt'),'\uFEFF'+[
 'AI 创作工作台 · Windows x64 文件夹版 · 2026-11-01',
 '',
 '1. 将整个文件夹复制或解压到 Windows 11 x64 的可写目录，例如 D:\\AI-Creative-Studio。',
 '2. 双击 run.bat 或“启动工作台.bat”，通过环境检查后自动打开浏览器。',
 '3. 首次进入后，在系统设置／模型配置中填写自己的供应商 API 密钥。联网功能需要网络。',
 '4. 使用“停止工作台.bat”安全停止；运行时保留启动窗口，关闭网页不会停止后台。',
 '5. 遇到问题先运行“检查运行环境.bat”，并查看 data\\logs\\server.log。',
 '',
 '包内已带 Windows Node 24、Python 3.11、图像依赖、FFmpeg／ffprobe、离线 Whisper base 模型及视频处理依赖。',
 '无需在目标电脑执行 npm install、构建项目或单独安装 Node／Python。',
 '商品、素材与任务在首次启动时保存到 data。此包从空白数据开始，原电脑的商品、任务和 API 密钥未迁入。',
 '如需迁移，先在原工作台导出完整备份，停止两边服务后按原项目的备份恢复说明处理。不要覆盖正在运行的 data。',
 '',
 '抖音采集助手：',
 'Chrome／Edge 扩展管理页开启开发者模式，加载 extensions\\douyin-research 文件夹。',
 '在工作台“选品之神→深度分析”获取配对码，将浏览器地址栏的工作台地址填入插件并配对。',
 '在安装插件的同一浏览器登录抖音，添加同行链接后检查登录并采集。详见插件文件夹的“使用说明.md”。',
 '采集脚本与后端协议测试已通过；已登录抖音的真实线上采集仍需在 Windows 浏览器验证。',
 '',
 '1688 动态网页采集需要安装 Google Chrome；也可导入已保存的商品 HTML。',
 `发布验证：生产构建已准备；自动化测试通过数：${passedTests??'未提供当前报告'}。Windows x64 运行依赖已整理并校验文件。`,
 '当前构建电脑是 macOS，Windows BAT、DLL 加载、视频处理与真实采集尚未在 Windows 实机验收。',
 '完整版本与文件校验见 licenses。',
 '',
].join('\r\n'));
fs.writeFileSync(path.join(stage,'licenses/downloads.json'),JSON.stringify(sources,null,2));
fs.writeFileSync(path.join(stage,'licenses/release.json'),JSON.stringify({name:'AI 创作工作台',target:'win32-x64',node:nodeVersion,python:'3.11.9',model:{repo:'Systran/faster-whisper-base',revision:'ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66'},builtAt:new Date().toISOString(),buildHost:process.platform,includesUserData:false,includesCredentials:false,validation:{tests:passedTests,productionBuild:'passed',freshDataSmoke:'passed-on-macos',legacyEndToEnd:'blocked-by-retired-matrix-selector',windowsExecution:'not-run',liveDouyinCollection:'not-run'}},null,2));
// The application never invokes npm entry points; omit host-specific symlinks and other OS ffprobe binaries.
function removeBinLinks(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.name==='.bin'&&entry.isDirectory())fs.rmSync(file,{recursive:true,force:true});else if(entry.isDirectory())removeBinLinks(file);}}
removeBinLinks(path.join(stage,'node_modules'));
for(const name of ['darwin','linux','win32/ia32'])fs.rmSync(path.join(stage,'node_modules/ffprobe-static/bin',name),{recursive:true,force:true});
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(dir,entry.name)):entry.isFile()?[path.join(dir,entry.name)]:[]);}
const inventory=files(stage).map(file=>({file:path.relative(stage,file).split(path.sep).join('/'),bytes:fs.statSync(file).size,sha256:sha(fs.readFileSync(file))}));
fs.writeFileSync(path.join(stage,'licenses/build-manifest.json'),JSON.stringify(inventory,null,2));
fs.writeFileSync(path.join(stage,'licenses/license-files.json'),JSON.stringify(inventory.filter(f=>/(?:^|\/)(?:LICENSE|LICENCE|COPYING|NOTICE)(?:[.\/]|$)/i.test(f.file)).map(f=>f.file),null,2));
console.log('Windows folder staged: '+stage);
