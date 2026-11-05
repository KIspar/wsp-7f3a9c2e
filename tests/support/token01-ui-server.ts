// Isolated, simulated upstream for manual BrowserOS neo UI checks. Never uses real credentials.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStore} from '../../apps/server/store';
import {createApp} from '../../apps/server/app';
import {token01Models} from '../../packages/token01';
import catalog from '../fixtures/token01-pricing.json';
import legacyFixtures from '../fixtures/provider.json';
import mediaPrices from '../fixtures/media-pricing.json';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'token01-ui-'));
const store=createStore(dir,process.cwd());
const tasks=new Map<string,{model:string;queries:number}>();
const legacyNames=['tt-image-2','gk-video-3.5','omni_flash-10s-fl','omni-1.1','minimax-h3','tt-image-2.5','tt-6.1-sol','banana-2.1','gem-4-argon'];
const legacyTypes=['image','video','video','video','video','image','chat','image','chat'];
const customGroups=legacyNames.map((model,index)=>({model,force_group_ids:index===8?[80]:[],group_ids:index===4||index===5?[index*10,index*10+1]:[index*10],groups:(index===4||index===5?[index*10,index*10+1]:[index*10]).map(id=>({group_id:id,group_name:`已配置渠道-${id}`,status:index===0||index===8?'offline':'active'}))}));
const app=await createApp(store,{providerTransport:async(raw,init)=>{
 const url=new URL(raw);
 if(url.origin==='https://api.lk888.ai'&&init.method==='GET'){
  if(url.pathname==='/v1/skills/models')return Response.json({total:9,models:legacyNames.map((name,index)=>({name,type:legacyTypes[index],available_for_this_key:index!==0&&index!==8}))});
  if(url.pathname.endsWith('/balance'))return Response.json(legacyFixtures.balance);
  if(url.pathname==='/v1/skills/key')return Response.json({...legacyFixtures.key,custom_groups_in_effect:true,custom_groups:customGroups});
  if(url.pathname.endsWith('/pricing')){const model=mediaPrices['tt-image-2.5'],group=model.channel_groups[0],configured=customGroups.find(row=>row.model===url.searchParams.get('model'));return Response.json({...model,available_for_this_key:configured?.groups.some(row=>row.status==='active')||false,channel_groups:[...(configured?.groups||[]).map(row=>({...group,...row,is_active:row.status==='active',in_key_whitelist:true,excluded_for_this_key:false})),{...group,group_id:9992,group_name:'测试已排除渠道',excluded_for_this_key:true},{...group,group_id:9993,group_name:'测试未授权渠道',in_key_whitelist:false}]});}
  throw Error('UI harness only allows read-only relay discovery');
 }
 if(url.origin!=='https://www.token01.net')throw Error('UI harness blocks all other suppliers');
 if(url.pathname==='/api/status')return Response.json({success:true,data:{phone_login_enabled:true,sms_captcha_enabled:false}});
 if(url.pathname==='/api/sms/code')return Response.json({success:true});
 if(url.pathname==='/api/user/login/phone'){
  const body=JSON.parse(String(init.body));return body.code==='123456'?Response.json({success:true,data:{access_token:'fixture-user-access-token-only',session_id:'ui-session'}}):Response.json({success:false,message:'验证码错误'});
 }
 if(url.pathname==='/api/user/auth/logout')return Response.json({success:true});
 if(url.pathname==='/api/user/self/quota/overview')return String(new Headers(init.headers).get('Authorization')).includes('fixture-user-access-token-only')?Response.json({success:true,data:{remaining:{amount:'12.345600',quota:6172800},currency:{display_type:'CNY',symbol:'¥',exchange_rate:1,quota_per_unit:500000}}}):Response.json({success:false,code:'AUTH_UNAUTHORIZED'},{status:401});
 if(url.pathname==='/api/pricing')return Response.json(catalog);
 if(url.pathname==='/v1/models'){
  const authorization=String(new Headers(init.headers).get('Authorization'));
  if(authorization.includes('denied'))return Response.json({error:{message:'测试密钥未授权'}},{status:401});
  return Response.json({data:token01Models.filter(m=>!authorization.includes('only-h3')||m.id==='minimax-h3').map(m=>({id:m.upstreamId}))});
 }
 if(url.pathname==='/v1/uploads/images')return Response.json({url:'https://cdn.example.test/reference.png?signature=preserved'});
 if(url.pathname==='/v1/video/generations'&&init.method==='POST'){
  const body=JSON.parse(String(init.body));if(body.duration!==4)throw Error('UI fixture is exactly 4 seconds');
  const id='task_ui_'+(tasks.size+1);tasks.set(id,{model:body.model,queries:0});
  console.log('SIMULATED generation',id,body.model,body.duration,body.resolution||body.size,body.reference_images?.length||0,body.first_frame_url?'first-frame':'');return Response.json({id,status:'queued'});
 }
 const id=url.pathname.split('/')[url.pathname.endsWith('/content')?3:4],task=tasks.get(id);if(!task)return Response.json({message:'Unknown test task'},{status:404});
 if(url.pathname.endsWith('/content'))return new Response(fs.readFileSync('public/examples/demo-portrait-4.mp4'),{headers:{'Content-Type':'video/mp4'}});
 task.queries++;return Response.json({code:'success',data:{task_id:id,status:'SUCCESS',progress:'100%'}});
}});
await app.listen({host:'127.0.0.1',port:Number(process.env.TOKEN01_UI_PORT||4319)});
console.log('Isolated Token01 UI fixture http://127.0.0.1:4319; data: '+dir);
async function close(){await app.close();store.close();fs.rmSync(dir,{recursive:true,force:true});process.exit(0);}
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
