import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const python=process.env.RESEARCH_PYTHON||(fs.existsSync('.runtime/video/bin/python')?path.resolve('.runtime/video/bin/python'):process.platform==='win32'?'python':'python3');
const fixture=spawn(process.execPath,['--import','tsx','scripts/research-flow-fixture.ts'],{stdio:['ignore','pipe','inherit']});
const timeout=setTimeout(()=>{fixture.kill();console.error('Fixture startup timed out');process.exitCode=1;},30000);
try{
 await new Promise((resolve,reject)=>{let buffer='';fixture.stdout.on('data',data=>{buffer+=data;for(const line of buffer.split('\n')){try{if(JSON.parse(line).ready)resolve();}catch{}}});fixture.once('exit',code=>reject(Error('Fixture exited '+code)));fixture.once('error',reject);});
 clearTimeout(timeout);
 for(const script of ['scripts/research-flow-browser.py','scripts/research-extension-browser.py']){
  const code=await new Promise((resolve,reject)=>{const child=spawn(python,[script],{stdio:'inherit'});child.once('error',reject);child.once('exit',resolve);});
  if(code!==0)throw Error(script+' failed with exit '+code);
 }
 console.log('Research browser suite passed. Evidence: output/research-flow/');
}catch(error){console.error(error.message);process.exitCode=1;}
finally{clearTimeout(timeout);fixture.kill('SIGTERM');await new Promise(resolve=>{const deadline=setTimeout(()=>{fixture.kill('SIGKILL');resolve();},5000);fixture.once('exit',()=>{clearTimeout(deadline);resolve();});});}
