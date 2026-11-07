import {afterEach,describe,it,expect} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
const roots=[],children=[];
afterEach(async()=>{for(const child of children.splice(0)){if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}}await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
async function until(check){const end=Date.now()+8000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('supervisor did not settle');}
async function fixture(fails){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-supervisor-'));roots.push(root);
 const server=label=>`import http from 'node:http';import fs from 'node:fs';fs.writeFileSync('data/started','${label}');fs.writeFileSync('data/server.pid',String(process.pid));const server=http.createServer((r,s)=>{s.statusCode=${fails==='starting'?503:200};s.end('ok');});server.listen(Number(process.env.PORT),'127.0.0.1');process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`;
 for(const dir of ['scripts','dist','dist-server','data/updates/staged/dist-server'])await fs.mkdir(path.join(root,dir),{recursive:true});
 for(const file of ['start.mjs','update-manager.mjs'])await fs.copyFile(path.join(import.meta.dirname,'../scripts',file),path.join(root,'scripts',file));
 await fs.writeFile(path.join(root,'dist/index.html'),'old');await fs.writeFile(path.join(root,'dist-server/index.js'),server('old'));
 await fs.writeFile(path.join(root,'package.json'),' {"type":"module"}');
 await fs.writeFile(path.join(root,'data/updates/staged/dist-server/index.js'),fails===true?`import fs from 'node:fs';fs.writeFileSync('data/changed','bad');process.exit(1);`:server('new'));
 await fs.writeFile(path.join(root,'data/updates/state.json'),JSON.stringify({phase:'ready',version:'0.2.0'}));await fs.writeFile(path.join(root,'data/updates/pending.json'),'{}');
 const child=spawn(process.execPath,['scripts/start.mjs'],{cwd:root,env:{...process.env,STUDIO_DATA:path.join(root,'data'),PORT:'34900'},stdio:'ignore'});children.push(child);return root;
}
describe('local update supervisor',()=>{
 it('accepts a healthy replacement only after restart',async()=>{const root=await fixture(false);await until(async()=>{try{return JSON.parse(await fs.readFile(path.join(root,'data/updates/state.json'),'utf8')).phase==='installed';}catch{return false;}});expect(await fs.readFile(path.join(root,'data/started'),'utf8')).toBe('new');await expect(fs.access(path.join(root,'data/updates/applied.json'))).rejects.toThrow();},12000);
 it('starts the original app and restores data after a broken replacement exits',async()=>{const root=await fixture(true);await until(async()=>{try{return await fs.readFile(path.join(root,'data/started'),'utf8')==='old';}catch{return false;}});await expect(fs.access(path.join(root,'data/changed'))).rejects.toThrow();expect(JSON.parse(await fs.readFile(path.join(root,'data/updates/state.json'),'utf8')).phase).toBe('error');},12000);
 it('stops the child when closed during the first health check',async()=>{
  const root=await fixture('starting');
  await until(async()=>{try{return await fs.readFile(path.join(root,'data/started'),'utf8')==='new';}catch{return false;}});
  const pid=Number(await fs.readFile(path.join(root,'data/server.pid'),'utf8'));
  const supervisor=children.at(-1),exited=new Promise(resolve=>supervisor.once('exit',resolve));
  supervisor.kill('SIGTERM');await exited;
  await until(()=>{try{process.kill(pid,0);return false;}catch(error){return error.code==='ESRCH';}});
 },12000);
});
