import type {Store} from './store';
import {createPricingService} from './pricing';
import type {ProviderTransport} from './provider';
import {compilePlan,replaySubmission,retryAttempt,submit} from './engine';
import type {Draft,PlanItem,Submission,Attempt,CreativeContext} from '../../packages/contracts';
import {validateWearContext} from './wear-context';
import {fail} from './errors';
import {prepareEcommerceFormat} from './ecommerce-format';

export function createGenerationPricing(store:Store,transport?:ProviderTransport){
  const pricing=createPricingService(store,transport);
  let queue:Promise<unknown>=Promise.resolve();
  // Serialize admission from all tabs, so accepted pending work reserves its quoted upper bound.
  function serial<T>(action:()=>Promise<T>):Promise<T>{const next=queue.then(action,action);queue=next.catch(()=>{});return next;}
  function requireActive(skillId:string){if(skillId==='scene-recreate')fail('此功能已移除，请使用图片爆款复刻或商品套图');}
  async function estimate(skillId:string,draft:Draft,action:Submission['action']){
    requireActive(skillId);
    await prepareEcommerceFormat(store,skillId,draft);
    const plan=compilePlan(store,skillId,draft,action,true);
    return pricing.quote(plan.items);
  }
  async function plan(skillId:string,draft:Draft,action:Submission['action'],context?:CreativeContext,wearContext?:import('../../packages/wear').WearContext){
    requireActive(skillId);
    await prepareEcommerceFormat(store,skillId,draft);
    const plan=compilePlan(store,skillId,draft,action,false,context,wearContext);
    return {...plan,quote:await pricing.quote(plan.items,undefined,true)};
  }
  function admit(request:Submission){return serial(async()=>{
    if(request.wearContext&&request.creativeContext)fail('不能同时提交两种创作上下文');
    const previous=replaySubmission(store,request);if(previous)return previous;
    requireActive(request.skillId);
    await prepareEcommerceFormat(store,request.skillId,request.draft);
    const plan=compilePlan(store,request.skillId,request.draft,request.action,false,request.creativeContext,request.wearContext);
    if(plan.hash!==request.planHash)fail('技能、模型或计划已变更，请重新预览后提交',409);
    if(request.wearContext)validateWearContext(store,request.wearContext,request.draft,request.skillId);
    if(!request.creativeContext&&!request.wearContext&&request.expectedDraftRevision!==store.readDraft(request.skillId).revision)fail('草稿版本已变更，请重新预览',409);
    const quote=await pricing.quote(plan.items,undefined,true);
    if(!quote.affordable)fail(`可用余额不足：本次最多需要 ${quote.maximum} ${quote.unit}，当前可用 ${quote.available} ${quote.unit}`,402);
    if(request.maximumCost===undefined||quote.maximum>request.maximumCost+1e-9)fail('接口报价已变化，请重新预览本次费用后确认',409);
    return submit(store,request,quote,false);
  });}
  async function retryQuote(id:string,revision:number){
    const attempt=store.get<Attempt>('attempt',id)||fail('任务不存在',404);
    if(attempt.revision!==revision)fail('任务状态已变化，请刷新',409);
    requireActive(store.readBatch(attempt.batchId)!.skillId);
    const model=store.models().find(m=>m.id===attempt.model.id&&m.enabled)||fail('所选模型不可用');
    return pricing.quote([{...attempt,model,index:1,variant:1}],undefined,true);
  }
  function retry(id:string,revision:number,prompt?:string,maximumCost?:number){return serial(async()=>{
    const attempt=store.get<Attempt>('attempt',id)||fail('任务不存在',404);
    if(attempt.revision!==revision)fail('任务状态已变化，请刷新',409);
    // Saving an already generated result does not create a new upstream generation.
    if(attempt.status==='failed'&&attempt.step==='保存失败'&&attempt.simulated)fail('历史模拟保存任务不能进入真实队列，请重新预览并生成');
    if(attempt.status==='failed'&&attempt.step==='保存失败')return retryAttempt(store,id,revision,prompt);
    requireActive(store.readBatch(attempt.batchId)!.skillId);
    const model=store.models().find(m=>m.id===attempt.model.id&&m.enabled)||fail('所选模型不可用');
    const item:PlanItem={...attempt,model,index:1,variant:1};
    const quote=await pricing.quote([item],undefined,true);
    if(!quote.affordable)fail(`可用余额不足：本次最多需要 ${quote.maximum} ${quote.unit}，当前可用 ${quote.available} ${quote.unit}`,402);
    if(maximumCost===undefined||quote.maximum>maximumCost+1e-9)fail('接口报价已变化，请重新预览本次费用后确认',409);
    return retryAttempt(store,id,revision,prompt,{model,reservedCost:quote.maximum,credentialVersion:quote.credentialVersion,simulated:false});
  });}
  return {estimate,plan,admit,retry,retryQuote};
}
