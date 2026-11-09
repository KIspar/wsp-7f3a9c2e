import {createHash} from 'node:crypto';
import type {Store} from './store';
import type {Model} from '../../packages/contracts';
import type {AnalysisModel,AnalysisSettings} from '../../packages/analysis';
import type {ModelSetup,ModelSetupChoice,ModelSetupPreview,SetupRole} from '../../packages/model-setup';
import type {SavedToken01Key} from './token01-keys';
import type {Token01GroupProfile} from '../../packages/token01';
import {credentialVault} from './credentials';
import {relayModelAvailable} from './relays';
import {fail} from './errors';

const roles:SetupRole[]=['image','video','chat'];
const priority:Record<SetupRole,string[]>={image:['tt-image'],video:['minimax-h3-fast','omni','gk-video-3.5','minimax-h3'],chat:['gem-3.8-flash','gem-4-argon','tt-6.1-sol']};
type Candidate=ModelSetupChoice&{active:boolean;slot:string;version:string;revision:number;keyId?:string;boundGroup?:string};
export function createModelSetup(store:Store){
 const vault=credentialVault(store.dataDir);
 const settings=():ModelSetup=>store.get<ModelSetup>('model-setup','global')||{mode:'manual',defaults:{},revision:0};
 function candidates():Candidate[]{
  const named=store.list<SavedToken01Key>('token01-key').filter(key=>key.status==='ready'&&vault.current('token01-key:'+key.id)===key.version);
  const groups=store.list<Token01GroupProfile&{version:string}>('token01-group').filter(group=>group.status==='ready'&&vault.current('token01-group:'+group.group)===group.version);
  const result:Candidate[]=[];
  for(const model of store.models().filter(model=>model.provider!=='simulator')){
   let slot=model.id,version=vault.current(slot),keyId:string|undefined,boundGroup=model.token01Group;
   if(relayModelAvailable(store,model.id)!==true||!version){
    // Never override an explicit per-model credential or group binding.
    if(model.provider!=='token01'||model.token01KeyId||model.token01Group)continue;
    const catalog=store.get<{models:{id:string;groups:{group:string}[]}[]}>('token01-routing','catalog');
    const key=named.find(key=>key.modelIds.includes(model.id)&&(!key.group||catalog?.models.some(entry=>entry.id===model.id&&entry.groups.some(group=>group.group===key.group))));
    const group=!key?groups.find(group=>group.modelIds.includes(model.id)):undefined;
    if(key){keyId=key.id;boundGroup=key.group;slot='token01-key:'+key.id;version=key.version;}
    else if(group){boundGroup=group.group;slot='token01-group:'+group.group;version=group.version;}
    else continue;
   }
   result.push({role:model.category,modelId:model.id,name:model.name,provider:model.provider as 'chuhe'|'token01',group:model.provider==='chuhe'?'沿用密钥渠道策略':boundGroup||'跟随密钥绑定分组',reason:'已适配'+(model.category==='image'?'图片':'视频')+'流程；沿用密钥权限与分组',slot,version:version!,revision:model.revision,active:model.enabled,keyId,boundGroup});
  }
  for(const model of store.list<AnalysisModel>('analysis-model')){
   const version=vault.current(model.id);
   if(!version||relayModelAvailable(store,model.id)!==true)continue;
   result.push({role:'chat',modelId:model.id,name:model.name,provider:'chuhe',group:'沿用密钥渠道策略',reason:model.id==='tt-6.1-sol'&&model.vision.status!=='passed'?'可用于文字辅助；图片分析需先通过识图验证':'支持文字与图片辅助，沿用现有能力校验',slot:model.id,version,revision:model.revision,active:model.enabled});
  }
  return result;
 }
 function plan(){
  const current=settings(),all=candidates();
  const selected=roles.flatMap(role=>{
   const available=all.filter(model=>model.role===role);
   const keep=current.mode==='recommended'?available.find(model=>model.modelId===current.defaults[role]):undefined;
   const choice=keep||[...available].sort((a,b)=>(priority[role].indexOf(a.modelId)<0?999:priority[role].indexOf(a.modelId))-(priority[role].indexOf(b.modelId)<0?999:priority[role].indexOf(b.modelId))||a.modelId.localeCompare(b.modelId))[0];
   return choice?[choice]:[];
  });
  const signature=createHash('sha256').update(JSON.stringify({current,all,analysis:store.get<AnalysisSettings>('analysis-settings','global')})).digest('hex');
  return {current,all,selected,signature};
 }
 function preview():ModelSetupPreview{
  const {current,all,selected,signature}=plan();
  const applied=current.mode==='recommended'&&selected.length>0&&roles.every(role=>selected.find(model=>model.role===role)?.modelId===current.defaults[role])&&selected.every(model=>model.active)&&(selected.find(model=>model.role==='chat')?.modelId||undefined)===(current.defaults.chat?store.get<AnalysisSettings>('analysis-settings','global')?.defaultModelId:undefined);
  return {settings:current,applied,choices:selected.map(({active,slot,version,revision,keyId,boundGroup,...choice})=>choice),availableCounts:{image:all.filter(model=>model.role==='image').length,video:all.filter(model=>model.role==='video').length,chat:all.filter(model=>model.role==='chat').length},missing:roles.filter(role=>!selected.some(model=>model.role===role)),signature};
 }
 function apply(signature:string){
  const planNow=plan();
  if(signature!==planNow.signature)fail('密钥或模型配置已变化，请刷新推荐方案',409);
  if(!planNow.selected.length)fail('请先连接中转站并同步可用模型');
  // Reuse only verified local credentials. No model invocation or remote mutation.
  for(const choice of planNow.selected){
   if(choice.slot===choice.modelId)continue;
   const key=vault.get(choice.slot,choice.version),existing=vault.current(choice.modelId);
   if(!existing||vault.get(choice.modelId,existing)!==key)vault.set(choice.modelId,key);
  }
  store.transaction(()=>{
   for(const choice of planNow.selected){
    if(choice.role==='chat'){
     const model=store.get<AnalysisModel>('analysis-model',choice.modelId)!;
     if(!model.enabled)store.put('analysis-model',model.id,{...model,enabled:true,revision:model.revision+1});
     const previous=store.get<AnalysisSettings>('analysis-settings','global')!;
     store.put('analysis-settings','global',{...previous,defaultModelId:model.id});
    }else{
     const model=store.get<Model>('model',choice.modelId)!;
     const next={...model,enabled:true,...(choice.slot!==choice.modelId?{token01KeyId:choice.keyId,token01Group:choice.boundGroup}:{}),revision:model.revision+1};
     store.put('model',model.id,next);
    }
   }
   store.put('model-setup','global',{mode:'recommended',defaults:Object.fromEntries(planNow.selected.map(choice=>[choice.role,choice.modelId])),revision:planNow.current.revision+1,updatedAt:new Date().toISOString()} satisfies ModelSetup);
  });
  return preview();
 }
 function manual(revision:number){
  const current=settings();if(current.revision!==revision)fail('配置已变化，请刷新后重试',409);
  store.transaction(()=>store.put('model-setup','global',{...current,mode:'manual',revision:current.revision+1,updatedAt:new Date().toISOString()} satisfies ModelSetup));return preview();
 }
 return {preview,apply,manual};
}
