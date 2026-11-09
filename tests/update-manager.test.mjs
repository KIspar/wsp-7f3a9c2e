import {afterEach,describe,it,expect,vi} from 'vitest';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {gzipSync} from 'node:zlib';
import {Readable} from 'node:stream';
import {compareVersions,validateManifest,safeArchivePath,unpackArchive,applyUpdate,rollbackUpdate,checkUpdate,downloadToFile} from '../scripts/update-manager.mjs';
const dirs=[];afterEach(async()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();await Promise.all(dirs.splice(0).map(dir=>fs.rm(dir,{recursive:true,force:true})));});
async function temporary(){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'studio-update-'));dirs.push(dir);return dir;}
function tarEntry(name,content,type='0'){
 const header=Buffer.alloc(512);header.write(name,0,100);header.write('0000644\0',100);header.write('0000000\0',108);header.write('0000000\0',116);header.write(content.length.toString(8).padStart(11,'0')+'\0',124);header.write('00000000000\0',136);header.fill(32,148,156);header.write(type,156);header.write('ustar\0',257);const sum=header.reduce((a,b)=>a+b,0);header.write(sum.toString(8).padStart(6,'0')+'\0 ',148);return Buffer.concat([header,Buffer.from(content),Buffer.alloc((512-content.length%512)%512)]);
}
describe('GitHub update contract',()=>{
 it('streams actual byte progress, throttles reports and records completion',async()=>{
   const dir=await temporary(),reports=[];
   const chunks=Array.from({length:100},()=>Buffer.alloc(1024));
   await downloadToFile(Readable.from(chunks),path.join(dir,'download'),{totalBytes:102400,onProgress:async value=>{reports.push(value);}});
   expect(reports[0]).toMatchObject({receivedBytes:0,totalBytes:102400,bytesPerSecond:0});
   expect(reports.at(-1)).toMatchObject({receivedBytes:102400,totalBytes:102400});
   expect(reports.at(-1).lastByteAt).toBeTruthy();expect(reports.length).toBeLessThan(10);
   expect((await fs.stat(path.join(dir,'download'))).size).toBe(102400);
 });
 it('rejects short and oversized downloads instead of reporting success',async()=>{
   const dir=await temporary();
   await expect(downloadToFile(Readable.from([Buffer.alloc(2)]),path.join(dir,'short'),{totalBytes:3})).rejects.toThrow('不完整');
   await expect(downloadToFile(Readable.from([Buffer.alloc(4)]),path.join(dir,'large'),{totalBytes:3})).rejects.toThrow('超出');
 });
 it('ends a stalled transfer after 60 seconds without incoming data',async()=>{
   const dir=await temporary();vi.useFakeTimers();
   try{
    const source=new Readable({read(){}});
    const transfer=downloadToFile(source,path.join(dir,'stalled'),{totalBytes:100});
    const assertion=expect(transfer).rejects.toThrow('60 秒未收到数据');
    await vi.advanceTimersByTimeAsync(60001);await assertion;
   }finally{vi.useRealTimers();}
 });
 it('reads public releases and version JSON without CLI or credentials, even when a stale token exists',async()=>{
   const root=await temporary();await fs.mkdir(path.join(root,'updates'));await fs.writeFile(path.join(root,'updates/source.json'),JSON.stringify({repository:'example/workspace',access:'public'}));await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version:'0.1.0'}));
   const manifest={version:'0.2.0',tag:'v0.2.0',minimumNode:24,assets:{app:{name:'studio-app.tar.gz',sha256:'a'.repeat(64),size:100}}};
   const release={tag_name:'v0.2.0',html_url:'https://github.com/example/workspace/releases/tag/v0.2.0',assets:[{id:1,name:'latest.json'},{id:2,name:'studio-app.tar.gz',size:100}]};
   vi.stubEnv('GH_TOKEN','stale-test-token');vi.stubEnv('GITHUB_TOKEN','stale-other-token');
   const transport=vi.fn(async url=>Response.json(String(url).endsWith('/releases/latest')?release:manifest));vi.stubGlobal('fetch',transport);
   const result=await checkUpdate(root,path.join(root,'data'));
   expect(result.available).toBe(true);expect(result.assetUrl).toBe('https://github.com/example/workspace/releases/download/v0.2.0/studio-app.tar.gz');
   expect(transport.mock.calls.map(([url])=>url)).toEqual(['https://api.github.com/repos/example/workspace/releases/latest','https://github.com/example/workspace/releases/download/v0.2.0/latest.json']);
   for(const [,init]of transport.mock.calls)expect(new Headers(init.headers).has('authorization')).toBe(false);
 });
 it.each([[404,{},'尚未发布可用更新'],[403,{'x-ratelimit-remaining':'0'},'次数暂时用尽']])('reports public GitHub failure %s without requesting login',async(status,headers,message)=>{
   const root=await temporary();await fs.mkdir(path.join(root,'updates'));await fs.writeFile(path.join(root,'updates/source.json'),JSON.stringify({repository:'example/workspace',access:'public'}));await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version:'0.1.0'}));
   vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status,headers})));
   await expect(checkUpdate(root,path.join(root,'data'))).rejects.toThrow(message);
 });
 it('compares full numeric versions and rejects ambiguous or injected versions',()=>{
   expect(compareVersions('0.10.0','0.9.9')).toBe(1);expect(compareVersions('1.0.0','1.0.0')).toBe(0);expect(compareVersions('0.1.1','1.0.0')).toBe(-1);
   for(const invalid of ['v1.0.0','1.0','01.1.0','1.0.0;rm','1.0.0-beta'])expect(()=>compareVersions(invalid,'1.0.0')).toThrow();
 });
 it('requires matching release tag, checksum, asset name and size',()=>{
   const manifest={version:'0.2.0',tag:'v0.2.0',minimumNode:24,assets:{app:{name:'studio-app.tar.gz',sha256:'a'.repeat(64),size:100}}};
   expect(validateManifest(manifest,{tag_name:'v0.2.0'})).toBe(manifest);
   expect(()=>validateManifest(manifest,{tag_name:'v0.3.0'})).toThrow();
   expect(()=>validateManifest({...manifest,assets:{app:{...manifest.assets.app,sha256:'bad'}}},{tag_name:'v0.2.0'})).toThrow();
 });
 it('allows only application files and rejects data, secrets, traversal and links',async()=>{
   expect(safeArchivePath('apps/video-worker/worker.py')).toBe('apps/video-worker/worker.py');
   for(const name of ['../data/a','dist/../../data','data/studio.sqlite','.env','/dist/a','C:/dist/a','scripts\\evil','node_modules/a','dist//a'])expect(()=>safeArchivePath(name)).toThrow();
   const dir=await temporary(),archive=path.join(dir,'bad.tar.gz');await fs.writeFile(archive,gzipSync(tarEntry('dist/link','', '2')));
   await expect(unpackArchive(archive,path.join(dir,'stage'))).rejects.toThrow('链接');
 });
 it('extracts regular USTAR files and rejects truncated archives',async()=>{
   const dir=await temporary(),archive=path.join(dir,'good.tar.gz');await fs.writeFile(archive,gzipSync(Buffer.concat([tarEntry('dist/index.html','hello'),Buffer.alloc(1024)])));
   await unpackArchive(archive,path.join(dir,'stage'));expect(await fs.readFile(path.join(dir,'stage/dist/index.html'),'utf8')).toBe('hello');
   const truncated=tarEntry('dist/index.html','hello').subarray(0,514);await fs.writeFile(archive,gzipSync(truncated));await expect(unpackArchive(archive,path.join(dir,'other'))).rejects.toThrow('不完整');
 });
 it('backs up closed local data, applies code only, and rolls back program plus data on failed startup',async()=>{
   const root=await temporary(),data=path.join(root,'data'),updates=path.join(data,'updates');await fs.mkdir(path.join(root,'dist'),{recursive:true});await fs.writeFile(path.join(root,'dist/index.html'),'old');
   await fs.mkdir(path.join(data,'media'),{recursive:true});await fs.writeFile(path.join(data,'studio.sqlite'),'database-before');await fs.writeFile(path.join(data,'media/keep.png'),'asset');
   await fs.mkdir(path.join(updates,'staged/dist'),{recursive:true});await fs.writeFile(path.join(updates,'staged/dist/index.html'),'new');await fs.writeFile(path.join(updates,'state.json'),JSON.stringify({phase:'ready',version:'0.2.0'}));await fs.writeFile(path.join(updates,'pending.json'),'{}');
   expect(await applyUpdate(root,data)).toBe(true);expect(await fs.readFile(path.join(root,'dist/index.html'),'utf8')).toBe('new');expect(await fs.readFile(path.join(data,'media/keep.png'),'utf8')).toBe('asset');
   await fs.writeFile(path.join(data,'studio.sqlite'),'migration-failed');await fs.writeFile(path.join(data,'studio.sqlite-wal'),'bad-wal');
   await rollbackUpdate(root,data);expect(await fs.readFile(path.join(root,'dist/index.html'),'utf8')).toBe('old');expect(await fs.readFile(path.join(data,'studio.sqlite'),'utf8')).toBe('database-before');await expect(fs.access(path.join(data,'studio.sqlite-wal'))).rejects.toThrow();
 });
});
