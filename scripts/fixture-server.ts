/** Isolated browser regression only. Production always uses the real provider transport. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createStore} from '../apps/server/store';
import {createApp} from '../apps/server/app';
import {credentialVault} from '../apps/server/credentials';
import fixtures from '../tests/fixtures/media-pricing.json';
const directory=path.resolve(process.env.STUDIO_DATA||'');
if(!directory.startsWith(os.tmpdir()+path.sep))throw Error('Fixture server requires an explicit temporary STUDIO_DATA directory');
const store=createStore(directory,process.cwd());
const vault=credentialVault(directory);for(const id of ['tt-image','omni'])vault.set(id,'sk-fixture-only-12345678901234567890');
const app=await createApp(store,{providerTransport:async(raw,init)=>{
  if(init.method!=='GET')throw Error('Paid requests are disabled in this test fixture');
  const url=new URL(raw);
  const data=url.pathname.endsWith('/balance')?{balance:100,unit:'算力',api_key_quota:{limit:0,used:0}}:url.pathname.endsWith('/pricing')?fixtures[url.searchParams.get('model') as keyof typeof fixtures]:undefined;
  return new Response(JSON.stringify(data||{}),{status:data?200:404});
}});
const address=await app.listen({host:'127.0.0.1',port:0});console.log('Isolated browser fixture: '+address);
async function close(){await app.close();store.close();process.exit(0);}
process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close());
