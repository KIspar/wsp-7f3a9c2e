import path from 'node:path';
import {promises as fs,createWriteStream,createReadStream} from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createGunzip} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {Readable,Transform} from 'node:stream';
import {fileURLToPath} from 'node:url';

export const managedFiles=['dist','dist-server','public','skills','resources','extensions','apps/video-worker','scripts','updates','package.json','package-lock.json','node_modules'];
const semver=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function compareVersions(a,b){if(!semver.test(a)||!semver.test(b))throw Error('版本号必须为 x.y.z');const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;}
export function validateManifest(value,release){
  if(!value||!semver.test(value.version)||value.tag!==release.tag_name||value.tag!=='v'+value.version)throw Error('GitHub 版本信息与发布标签不一致');
  const asset=value.assets?.app;
  if(!asset||asset.name!=='studio-app.tar.gz'||!/^[a-f0-9]{64}$/.test(asset.sha256)||!Number.isSafeInteger(asset.size)||asset.size<1||asset.size>512*1024*1024)throw Error('更新包校验信息无效');
  if(!Number.isInteger(value.minimumNode)||value.minimumNode<24||value.minimumNode>100)throw Error('更新环境要求无效');
  return value;
}
export function safeArchivePath(name){
  if(name.startsWith('./'))name=name.slice(2);
  if(!name||name.includes('\\')||name.startsWith('/')||name.includes(':')||name.split('/').some(part=>part==='..'||part==='.'||!part&&part!==name.split('/').at(-1)))throw Error('更新包包含不安全路径');
  if(!managedFiles.filter(p=>p!=='node_modules').some(prefix=>name===prefix||name.startsWith(prefix+'/')))throw Error('更新包试图改动程序目录以外的文件');
  return name;
}
export async function unpackArchive(archive,destination){
  // Read USTAR ourselves: only regular files/directories; reject symlinks, PAX, devices and traversal.
  const stream=createReadStream(archive).pipe(createGunzip());let buffer=Buffer.alloc(0),entry,padding=0,total=0,count=0;
  await fs.mkdir(destination,{recursive:true});
  for await(const chunk of stream){
    buffer=Buffer.concat([buffer,chunk]);
    while(true){
      if(entry){
        if(!buffer.length)break;const amount=Math.min(entry.remaining,buffer.length);
        if(amount){await entry.file.write(buffer.subarray(0,amount));buffer=buffer.subarray(amount);entry.remaining-=amount;}
        if(entry.remaining)break;
        await entry.file.close();entry=undefined;
      }
      if(padding){const amount=Math.min(padding,buffer.length);buffer=buffer.subarray(amount);padding-=amount;if(padding)break;}
      if(buffer.length<512)break;
      const header=buffer.subarray(0,512);buffer=buffer.subarray(512);
      if(header.every(byte=>byte===0))continue;
      const text=(start,length)=>header.subarray(start,start+length).toString('utf8').replace(/\0.*$/s,'');
      const declared=parseInt(text(148,8).trim(),8),sum=header.reduce((sum,byte,index)=>sum+(index>=148&&index<156?32:byte),0);
      if(declared!==sum)throw Error('更新包 TAR 头校验失败');
      const prefix=text(345,155),name=safeArchivePath((prefix?prefix+'/':'')+text(0,100));
      const size=parseInt(text(124,12).trim()||'0',8),type=text(156,1);
      if(!Number.isSafeInteger(size)||size<0||(total+=size)>1024*1024*1024||++count>50000)throw Error('更新包大小或文件数量超出限制');
      const destinationFile=path.join(destination,name);
      if(type==='5'){if(size)throw Error('目录条目无效');await fs.mkdir(destinationFile,{recursive:true});continue;}
      if(type!==''&&type!=='0')throw Error('更新包禁止链接或特殊文件');
      await fs.mkdir(path.dirname(destinationFile),{recursive:true});
      entry={file:await fs.open(destinationFile,'wx'),remaining:size};padding=(512-size%512)%512;
    }
  }
  if(entry){await entry.file.close();throw Error('更新包不完整');}if(padding||buffer.some(byte=>byte!==0))throw Error('更新包结尾无效');
}
const exists=async file=>fs.access(file).then(()=>true,()=>false);
async function json(file){return JSON.parse(await fs.readFile(file,'utf8'));}
async function writeJson(file,value){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(value,null,2));await fs.rename(file+'.tmp',file);}
function run(command,args,options={}){return new Promise((resolve,reject)=>{const child=spawn(command,args,{...options,windowsHide:true,stdio:options.capture?['ignore','pipe','pipe']:'inherit'});let output='',error='';if(options.capture){child.stdout.on('data',b=>{output+=b;if(output.length>4*1024*1024)child.kill();});child.stderr.on('data',b=>{error+=b;});}child.on('error',reject);child.on('close',code=>code===0?resolve(output):reject(Error(options.capture?error||'GitHub 操作失败':`${command} 执行失败 (${code})`)));});}
// Runs in the update child process; publish at most once per second, not per chunk.
export async function downloadToFile(source,destination,{totalBytes,onProgress}={}){
  let receivedBytes=0,lastBytes=0,lastReport=performance.now(),idle;
  const startedAt=new Date().toISOString();
  async function report(final=false){
    if(!onProgress)return;
    const now=performance.now(),elapsed=now-lastReport;
    if(!final&&lastBytes>0&&elapsed<1000)return;
    const timestamp=new Date().toISOString();
    await onProgress({receivedBytes,totalBytes,bytesPerSecond:elapsed>0?Math.round((receivedBytes-lastBytes)*1000/elapsed):0,startedAt,updatedAt:timestamp,lastByteAt:receivedBytes?timestamp:undefined});
    lastBytes=receivedBytes;lastReport=now;
  }
  function resetIdle(){clearTimeout(idle);idle=setTimeout(()=>source.destroy(Error('下载连续 60 秒未收到数据，请检查网络后重试')),60000);idle.unref();}
  const meter=new Transform({transform(chunk,encoding,callback){
    receivedBytes+=chunk.length;
    if(totalBytes&&receivedBytes>totalBytes){callback(Error('下载大小超出版本声明，已拒绝更新包'));return;}
    resetIdle();void report().then(()=>callback(null,chunk),callback);
  }});
  try{
    await report(true);resetIdle();
    await pipeline(source,meter,createWriteStream(destination,{flags:'wx'}));
    if(totalBytes&&receivedBytes!==totalBytes)throw Error('更新包下载不完整，请重新下载');
    await report(true);
  }finally{clearTimeout(idle);}
}
async function github(repository,endpoint,destination,access='public',downloadUrl,progress){
  const token=process.env.GH_TOKEN||process.env.GITHUB_TOKEN;
  if(access==='private'&&!token){
    const args=['api',`repos/${repository}/${endpoint}`];if(destination)args.push('-H','Accept: application/octet-stream');
    if(!destination){try{return JSON.parse(await run('gh',args,{capture:true}));}catch{throw Error('无法读取私有 GitHub 仓库，请在本机执行 gh auth login，或配置只读 GH_TOKEN');}}
    const child=spawn('gh',args,{stdio:['ignore','pipe','ignore'],windowsHide:true});
    const ended=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('无法从 GitHub 下载更新，请检查登录权限')));});
    try{await Promise.all([ended,downloadToFile(child.stdout,destination,progress)]);}finally{if(child.exitCode===null)child.kill();}return;
  }
  const headers={Accept:destination?'application/octet-stream':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  if(access==='private'&&token)headers.Authorization=`Bearer ${token}`;
  const connecting=new AbortController(),connectionTimer=setTimeout(()=>connecting.abort(),60000);connectionTimer.unref();
  let response;
  try{response=await fetch(access==='public'&&destination?downloadUrl:`https://api.github.com/repos/${repository}/${endpoint}`,{headers,signal:AbortSignal.any([connecting.signal,AbortSignal.timeout(progress?30*60*1000:180000)])});}
  catch(error){if(connecting.signal.aborted)throw Error('连接 GitHub 超时，请检查网络后重试');throw error;}
  finally{clearTimeout(connectionTimer);}
  if(!response.ok){
    if(response.status===403&&response.headers.get('x-ratelimit-remaining')==='0')throw Error('GitHub 版本查询次数暂时用尽，请稍后重试');
    if(response.status===404)throw Error(access==='private'?'GitHub 尚未发布版本，或当前账号没有私有仓库读取权限':'GitHub 尚未发布可用更新，或版本附件尚未就绪');
    throw Error(`GitHub 检查失败 (${response.status})`);
  }
  if(destination)await downloadToFile(Readable.fromWeb(response.body),destination,progress);else return response.json();
}
export async function checkUpdate(root,dataDir){
  const source=await json(path.join(root,'updates/source.json'));
  if(!/^[\w.-]+\/[\w.-]+$/.test(source.repository))throw Error('更新仓库配置无效');
  if(source.access!==undefined&&!['public','private'].includes(source.access))throw Error('更新仓库访问方式无效');
  const access=source.access||'public';
  const current=(await json(path.join(root,'package.json'))).version;
  const release=await github(source.repository,'releases/latest',undefined,access);
  if(release.draft||release.prerelease)throw Error('没有可用的稳定版');
  if(!/^v\d+\.\d+\.\d+$/.test(release.tag_name))throw Error('GitHub 发布标签格式无效');
  const assetUrl=name=>`https://github.com/${source.repository}/releases/download/${release.tag_name}/${name}`;
  const metadata=release.assets?.find(a=>a.name==='latest.json');if(!metadata)throw Error('此 GitHub Release 尚未包含 latest.json');
  const dir=path.join(dataDir,'updates');await fs.mkdir(dir,{recursive:true});
  const temporary=path.join(dir,`manifest-${process.pid}.json`);let manifest;
  try{await github(source.repository,`releases/assets/${metadata.id}`,temporary,access,assetUrl('latest.json'));if((await fs.stat(temporary)).size>128*1024)throw Error('版本信息过大');manifest=validateManifest(await json(temporary),release);}finally{await fs.rm(temporary,{force:true});}
  const asset=release.assets.find(a=>a.name===manifest.assets.app.name);if(!asset||asset.size!==manifest.assets.app.size)throw Error('GitHub 更新包缺失或大小不一致');
  const result={currentVersion:current,latestVersion:manifest.version,available:compareVersions(manifest.version,current)>0,notes:String(manifest.notes||release.body||'').slice(0,12000),publishedAt:release.published_at,releaseUrl:release.html_url,repository:source.repository,access,manifest,assetId:asset.id,assetUrl:assetUrl(manifest.assets.app.name),checkedAt:new Date().toISOString()};
  await writeJson(path.join(dir,'check.json'),result);return result;
}
export async function stageUpdate(root,dataDir){
  const stateFile=path.join(dataDir,'updates/state.json');
  await writeJson(stateFile,{phase:'downloading',step:'checking',startedAt:new Date().toISOString()});
  const check=await checkUpdate(root,dataDir);if(!check.available)throw Error('当前已是最新版本');
  if(Number(process.versions.node.split('.')[0])<check.manifest.minimumNode)throw Error(`请先升级本机 Node.js 至 ${check.manifest.minimumNode}`);
  const dir=path.join(dataDir,'updates'),stage=path.join(dir,'staged'),archive=path.join(dir,'studio-app.tar.gz');
  await fs.rm(archive,{force:true});await fs.rm(stage,{recursive:true,force:true});
  let state={phase:'downloading',step:'connecting',version:check.latestVersion,progress:{receivedBytes:0,totalBytes:check.manifest.assets.app.size,bytesPerSecond:0,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString()}};
  await writeJson(stateFile,state);
  await github(check.repository,`releases/assets/${check.assetId}`,archive,check.access,check.assetUrl,{totalBytes:check.manifest.assets.app.size,onProgress:async progress=>{state={...state,step:progress.receivedBytes?'downloading':'connecting',progress};await writeJson(stateFile,state);}});
  state={...state,phase:'preparing',step:'verifying'};await writeJson(stateFile,state);
  const hash=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(archive)){hash.update(chunk);bytes+=chunk.length;}
  if(bytes!==check.manifest.assets.app.size||hash.digest('hex')!==check.manifest.assets.app.sha256)throw Error('更新包 SHA-256 校验失败，已拒绝安装');
  state={...state,step:'extracting'};await writeJson(stateFile,state);
  await unpackArchive(archive,stage);
  const pkg=await json(path.join(stage,'package.json'));if(pkg.version!==check.latestVersion)throw Error('安装包与声明的版本不一致');
  for(const file of ['dist/index.html','dist-server/index.js','scripts/start.mjs','package-lock.json'])if(!await exists(path.join(stage,file)))throw Error('更新包缺少必要程序文件');
  // Install platform-specific production dependencies in isolation, never in the running application.
  const npmCli=path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js');
  const bundledNpm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
  if(await exists(npmCli)||await exists(bundledNpm)){
    state={...state,step:'dependencies'};await writeJson(stateFile,state);
    await run(process.execPath,[await exists(npmCli)?npmCli:bundledNpm,'ci','--omit=dev','--no-audit','--no-fund'],{cwd:stage});
    const fingerprint=createHash('sha256').update((await fs.readFile(path.join(stage,'package-lock.json'),'utf8')).replace(/\r\n/g,'\n')).update(`${process.platform}/${process.arch}/${process.versions.node.split('.')[0]}`).digest('hex');
    await fs.writeFile(path.join(stage,'node_modules/.studio-launch-ready'),fingerprint);
  }
  else if(await fs.readFile(path.join(root,'package-lock.json'),'utf8')!==await fs.readFile(path.join(stage,'package-lock.json'),'utf8'))throw Error('此便携版需要完整安装包才能升级依赖，请下载完整新版本并保留 data 目录');
  await writeJson(path.join(dir,'state.json'),{phase:'ready',version:check.latestVersion});return {phase:'ready',version:check.latestVersion};
}
export async function applyUpdate(root,dataDir){
  const dir=path.join(dataDir,'updates'),state=await json(path.join(dir,'state.json'));
  if(state.phase!=='ready'||!await exists(path.join(dir,'pending.json')))return false;
  const backup=path.join(dataDir,'update-backups',new Date().toISOString().replace(/[:.]/g,'-'));
  await fs.mkdir(path.join(backup,'code'),{recursive:true});
  // Service has exited and SQLite is closed before the consistent data copy.
  await fs.mkdir(path.join(backup,'data'),{recursive:true});
  for(const entry of await fs.readdir(dataDir))if(!['updates','update-backups','server.lock'].includes(entry))await fs.cp(path.join(dataDir,entry),path.join(backup,'data',entry),{recursive:true});
  const moves=[];
  await writeJson(path.join(dir,'applied.json'),{backup,moves});
  try{
    for(const name of managedFiles){
      const incoming=path.join(dir,'staged',name);if(!await exists(incoming))continue;
      const live=path.join(root,name),old=path.join(backup,'code',name),hadPrevious=await exists(live);
      moves.push({name,hadPrevious});await writeJson(path.join(dir,'applied.json'),{backup,moves});
      await fs.mkdir(path.dirname(old),{recursive:true});if(hadPrevious)await fs.rename(live,old);
      await fs.mkdir(path.dirname(live),{recursive:true});await fs.rename(incoming,live);
    }
    await fs.rm(path.join(dir,'pending.json'),{force:true});
    await writeJson(path.join(dir,'state.json'),{phase:'restarting',version:state.version,backup});return true;
  }catch(error){await rollbackUpdate(root,dataDir);throw error;}
}
export async function rollbackUpdate(root,dataDir){
  const dir=path.join(dataDir,'updates'),file=path.join(dir,'applied.json');if(!await exists(file))return;
  const {backup,moves}=await json(file);
  for(const {name,hadPrevious} of [...moves].reverse()){
    const live=path.join(root,name),old=path.join(backup,'code',name);
    if(await exists(old)){await fs.rm(live,{recursive:true,force:true});await fs.mkdir(path.dirname(live),{recursive:true});await fs.rename(old,live);}
    else if(!hadPrevious)await fs.rm(live,{recursive:true,force:true});
  }
  for(const entry of await fs.readdir(dataDir))if(!['updates','update-backups'].includes(entry))await fs.rm(path.join(dataDir,entry),{recursive:true,force:true});
  for(const entry of await fs.readdir(path.join(backup,'data')))await fs.cp(path.join(backup,'data',entry),path.join(dataDir,entry),{recursive:true,force:true});
  await fs.rm(path.join(dir,'applied.json'),{force:true});await fs.rm(path.join(dir,'pending.json'),{force:true});await writeJson(path.join(dir,'state.json'),{phase:'error',error:'新版本启动失败，已恢复之前的程序和数据',backup});
}
export async function markHealthy(dataDir){const dir=path.join(dataDir,'updates');await fs.rm(path.join(dir,'applied.json'),{force:true});await writeJson(path.join(dir,'state.json'),{phase:'installed'});}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [command,rootArg,dataArg]=process.argv.slice(2),root=path.resolve(rootArg||'.'),dataDir=path.resolve(dataArg||path.join(root,'data'));
  try{let result;if(command==='check')result=await checkUpdate(root,dataDir);else if(command==='stage')result=await stageUpdate(root,dataDir);else if(command==='apply')result=await applyUpdate(root,dataDir);else if(command==='rollback')result=await rollbackUpdate(root,dataDir);else if(command==='healthy')result=await markHealthy(dataDir);else throw Error('未知更新命令');console.log(JSON.stringify(result??{ok:true}));}
  catch(error){if(command==='stage')await writeJson(path.join(dataDir,'updates/state.json'),{phase:'error',error:error.message});console.error(error.message);process.exitCode=1;}
}
