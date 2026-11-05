/** Deterministic fixtures in a temporary database. Never connects to a real provider. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createStore} from '../../apps/server/store';
import {createAnalysisService} from '../../apps/server/analysis';
import {createWorkbenchService} from '../../apps/server/prompt-workbench';
import {createApp} from '../../apps/server/app';
import {credentialVault} from '../../apps/server/credentials';
import {workbenchAIInstructions,type WorkbenchTaskStage} from '../../packages/prompt-workbench';
import type {Asset} from '../../packages/contracts';
import type {CatalogProduct} from '../../packages/catalog';
export async function workbenchHarness(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-workbench-')),store=createStore(dir,process.cwd());
  const control={failStage:'' as string,unknown:false,invalid:false,changedSpeech:false,structuredPromptFields:false,trailingReview:false,structuredClaims:false,structuredDescriptions:false,billingUnavailable:false,finalCost:.001},calls:{stage:string;text:string}[]=[],replies=new Map<string,string>();
  const image=await sharp({create:{width:320,height:400,channels:3,background:'#568bb8'}}).png().toBuffer();
  for(let i=0;i<9;i++){const id=`wb-image-${i}`;fs.writeFileSync(path.join(dir,'media',id+'.png'),image);store.put('asset',id,{id,url:`/media/${id}.png`,type:'image',mime:'image/png',bytes:image.length,source:'upload',createdAt:new Date().toISOString()} satisfies Asset);}
  const product:CatalogProduct={id:'wb-product',revision:1,title:'验收商品 · 蓝色连帽外套',site:'jp0663',sourceId:'fixture',sourceUrl:'https://example.invalid/fixture',supplier:'',itemNumber:'',wholesaleCost:null,salePrice:null,sellingPoints:'蓝色，连帽，前拉链。',parameters:[],colors:[],sizes:[],skus:[],postTitle:'',postBody:'',archived:false,bindings:[{id:'wb-product-image',assetId:'wb-image-0',kind:'main',label:'商品主图',order:0}],collectionStatus:'completed',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};store.put('catalog-product',product.id,product);
  const intent={audience:'日常通勤人群',pain:'出门前搭配选择',purpose:'展示外观',rationale:'以已有蓝色及连帽事实安排日常场景',claimIds:['blue'],tone:'自然简洁'};
  async function transport(url:string,init:RequestInit){
    if(new URL(url).origin!=='https://api.lk888.ai')throw Error('Fixture blocked external destination');
    if(url.endsWith('/balance'))return Response.json({balance:100,unit:'算力',api_key_quota:{limit:0,used:0}});
    if(url.includes('/pricing'))return Response.json({available_for_this_key:true,channel_groups:[{group_id:'fixture',group_name:'隔离验收分组',is_active:true,in_key_whitelist:true,excluded_for_this_key:false,input_token_price:1,output_token_price:1}]});
    if(url.includes('task-status')){if(control.billingUnavailable)return new Response('{}',{status:503});const task=new URL(url).searchParams.get('task_id')||'';return Response.json({state:'success',is_final:true,cost:control.finalCost,input_tokens:200,output_tokens:100,ai_reply:replies.get(task)});}
    if(init.method!=='POST')return Response.json({message:'隔离环境不提供此查询'},{status:404});
    const body=JSON.parse(String(init.body)),text=body.messages?(typeof body.messages[0].content==='string'?body.messages[0].content:body.messages[0].content[0].text):body.contents[0].parts[0].text;
    const stage=(Object.keys(workbenchAIInstructions) as WorkbenchTaskStage[]).find(s=>text.includes(workbenchAIInstructions[s]));if(!stage)throw Error('Unexpected fixture request');
    const start=text.indexOf('用户要求 / 已知参数：')+'用户要求 / 已知参数：'.length,end=text.indexOf('\n素材数量：',start),input=JSON.parse(text.slice(start,end));calls.push({stage,text});
    if(control.failStage===stage)return Response.json({error:'fixture failure'},{status:400});
    let result:unknown;
    if(stage==='images')result={readings:input.materials.map((m:{assetId:string})=>({assetId:m.assetId,text:'',clear:false,visible:['蓝色外观']}))};
    else if(stage==='analysis'){const source=input.sources.find((s:{text:string})=>s.text.includes('蓝色'));result={summary:'以蓝色及连帽外观为基础的日常外套',identityQuestion:'',claims:source?[{id:'blue',text:'蓝色外观',dimension:'功能',status:'supported',qualifiers:'仅说明可见颜色',refs:[{sourceId:source.id,quote:'蓝色'}],selected:true}]:[],missing:['材质与保暖性能未提供']};}
    else if(stage==='directions')result={directions:Array.from({length:input.brief.count},(_,i)=>({id:input.target.directionId||`direction-${i}`,title:['出门前的通勤选择','周末散步的穿搭安排','外观细节观察','人物选择的小转折'][i%4],audience:['通勤者','周末散步人群','偏好蓝色的人群','想减少搭配选择的人群'][i%4],scenario:['早晨门口','周末公园','衣架前','出门准备'][i%4],buyReason:'用已知蓝色外观组织日常搭配选择',hook:`开头 ${i+1}：${['出门前还在选外套？','今天想走一段路','近看这处连帽轮廓','临出门换个选择'][i%4]}`,expression:'日常情境',outline:'先展示商品，再完成一轮自然动作，结尾邀请选择',difference:`独立角度 ${i+1}：不同人群、场景与开头`,claimIds:['blue'],selected:true,primary:i===0}))};
    else if(stage==='scripts'){const old=input.existing,segment={id:input.target.segmentId||`${input.target.directionId}-segment-1`,duration:4,objective:'以商品外观开始日常选择',productPresentation:'展示蓝色及连帽轮廓',shots:[{id:`${input.target.directionId}-shot-1`,start:0,end:4,visual:'商品外套置于衣架，背景简洁',action:'镜头前缓缓展示一次商品外观',camera:'固定机位中景',speech:'今天出门，选这件蓝色。',claimIds:['blue'],referenceKeys:[]}],intent};result={directionId:input.target.directionId,totalSeconds:input.target.segmentId?old?.duration||4:4,segments:[segment]};}
    else if(stage==='prompts'||stage==='repair'){const source=stage==='repair'?input.segment:input.scriptSegment,material=input.materials.find((m:{role:string})=>m.role==='product');result={directionId:input.target.directionId,segment:{...source,shots:source.shots.map((s:unknown)=>({...s as object,referenceKeys:['product'],...(control.changedSpeech?{speech:'故意改变的台词'}:{})})),modules:control.structuredPromptFields?{character:{presentation:'无具名人物',voice:'画外音呈现'},product:{appearance:['蓝色','连帽','拉链外观'],reference:'{{ref:product}}'},scene:{background:'简洁衣架背景',light:'自然光',focus:'商品保持清晰'},motion:{camera:'固定中景',action:'商品进行一轮完整缓慢展示'},dialogue:{voice:'沿用已确认口播',sync:'与动作同步'},boundaries:{avoid:['材质承诺','保暖承诺','促销信息']}}:{character:'无具名人物，以画外音呈现',product:'以 {{ref:product}} 的蓝色、连帽和拉链外观为准',scene:'简洁衣架背景，自然光，商品保持清晰',motion:'固定中景，商品进行一轮完整缓慢展示',dialogue:'沿用已确认口播，与动作同步',boundaries:'不增加材质、保暖承诺和促销信息'},refs:[{key:'product',role:'product',assetId:material?.assetId||null,label:'同款商品外观',scope:'只参考商品外观与蓝色轮廓'}],continuity:control.structuredPromptFields?{identity:'保持同款颜色和结构',avoid:'不引入其他商品'}:'保持同款颜色和结构，不引入其他商品'}};}
    else result={issues:[]};
    if(stage==='scripts'&&input.generationPolicy){const p=result as {totalSeconds:number;segments:any[]},source=p.segments[0],policy=input.generationPolicy;p.totalSeconds=policy.totalSeconds;p.segments=Array.from({length:policy.segmentCount},(_,i)=>({...structuredClone(source),id:`${input.target.directionId}-segment-${i+1}`,duration:policy.totalSeconds/policy.segmentCount,shots:[{...source.shots[0],id:`${input.target.directionId}-shot-${i+1}`,end:policy.totalSeconds/policy.segmentCount}]}));}
    if(stage==='directions'&&control.structuredDescriptions)for(const d of (result as {directions:{outline:unknown}[]}).directions)d.outline=['展示商品','一轮动作','自然邀请选择'];
    if(stage==='analysis'&&control.structuredClaims)for(const claim of (result as {claims:{qualifiers:unknown}[]}).claims)claim.qualifiers=['仅说明可见颜色'];
    const reply=control.invalid?'not json':JSON.stringify(result).replace(/}$/,control.trailingReview?',"z_end_turn_review":"':'}'),taskId=`wb-task-${calls.length}`;replies.set(taskId,reply);if(control.unknown)throw Error('fixture network interruption');return Response.json({choices:[{message:{content:reply}}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}},{headers:{'X-Task-Id':taskId}});
  }
  const analysis=createAnalysisService(store,transport);analysis.configure('tt-6.1-sol',{key:'sk-isolated-workbench-test-no-real-key'});
  const configured=analysis.models().find(m=>m.id==='tt-6.1-sol')!;store.put('analysis-model',configured.id,{...configured,vision:{status:'passed',credentialVersion:credentialVault(dir).current(configured.id)}});
  for(const model of store.models().filter(m=>m.category==='video'))credentialVault(dir).set(model.id,'sk-isolated-workbench-video-no-real-key');
  const service=createWorkbenchService(store,analysis);
  async function drive(id:string,limit=100){for(let i=0;i<limit;i++){service.tick();await service.idle();analysis.tick();await analysis.idle();const j=service.run(id);if(!['queued','running'].includes(j.status))return j;}throw Error('Fixture did not settle');}
  async function app(){return createApp(store,{worker:false,analysisService:analysis,providerTransport:transport});}
  return {dir,store,analysis,service,calls,control,drive,app,async close(){await service.stop();await analysis.stop();store.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
