import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStore,type Store} from '../apps/server/store';
import {createRelayCatalog} from '../apps/server/relay-catalog';
import {createRelayService} from '../apps/server/relays';
import provider from './fixtures/provider.json';
let s:Store,dir:string;
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-catalog-'));s=createStore(dir,process.cwd());createRelayService(s).save('chuhe','sk-catalog-test-123456789012345');});
afterEach(()=>{s.close();fs.rmSync(dir,{recursive:true,force:true});});
describe('complete custom relay catalog',()=>{
 it('keeps nine configured models and eleven groups, distinguishing congestion and saved forced calling without adding public channels',async()=>{
  const names=['tt-image-2','gk-video-3.5','omni_flash-10s-fl','omni-1.1','minimax-h3','tt-image-2.5','tt-6.1-sol','banana-2.1','gem-4-argon'];
  const custom=names.map((model,index)=>({model,group_ids:index===4||index===5?[index*10,index*10+1]:[index*10],force_group_ids:index===8?[80]:[],groups:(index===4||index===5?[index*10,index*10+1]:[index*10]).map(id=>({group_id:id,group_name:'configured-'+id,status:index===0||index===8?'offline':'active'}))}));
  const client=createRelayCatalog(s,async url=>{
   if(url.endsWith('/key'))return Response.json({...provider.key,custom_groups_in_effect:true,custom_groups:custom});
   if(url.endsWith('/models'))return Response.json({total:10,models:[...names,'public-only'].map(name=>({name,type:name.includes('image')||name==='banana-2.1'?'image':name==='tt-6.1-sol'||name==='gem-4-argon'?'chat':'video',available_for_this_key:true}))});
   const name=new URL(url).searchParams.get('model'),row=custom.find(row=>row.model===name)!;
   if(name==='tt-image-2')return new Response('',{status:404});
   return Response.json({available_for_this_key:name!=='gem-4-argon',channel_groups:[...row.groups.map(group=>({...group,is_active:group.status==='active',in_key_whitelist:true,excluded_for_this_key:false})),{group_id:99999,group_name:'public-unconfigured',is_active:true,in_key_whitelist:false,excluded_for_this_key:false}]});
  });
  const result=await client.catalog();expect(result.models).toHaveLength(9);expect(result.groupCount).toBe(11);
  expect(result.models.find(row=>row.id==='tt-image-2')).toMatchObject({available:false,groups:[{name:'configured-0',status:'congested',forced:false}]});
  expect(result.models.find(row=>row.id==='gem-4-argon')).toMatchObject({available:true,groups:[{name:'configured-80',status:'congested',forced:true}]});
  expect(result.models.find(row=>row.id==='tt-6.1-sol')?.category).toBe('chat');expect(result.models.find(row=>row.id==='minimax-h3')?.localId).toBeUndefined();expect(JSON.stringify(result)).not.toContain('public-unconfigured');expect(JSON.stringify(result)).not.toContain('public-only');
 });
 it('keeps permanently removed and unknown channels distinct when pricing fails, without forcing a removed channel',async()=>{
  const client=createRelayCatalog(s,async url=>{
   if(url.endsWith('/key'))return Response.json({...provider.key,custom_groups_in_effect:true,custom_groups:[{model:'tt-image-2.5',group_ids:[1,2],force_group_ids:[1],groups:[{group_id:1,group_name:'removed',status:'removed'},{group_id:2,group_name:'unknown'}]}]});
   if(url.endsWith('/models'))return Response.json({total:1,models:[{name:'tt-image-2.5',type:'image'}]});
   return new Response('',{status:404});
  });
  expect((await client.catalog()).models[0]).toMatchObject({available:false,groups:[{id:'1',status:'removed',forced:false},{id:'2',status:'unknown',forced:false}]});
 });
});
