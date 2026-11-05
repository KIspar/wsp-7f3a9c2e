import {useParams} from 'react-router-dom';
import {ArrowRight,RotateCcw,Sparkles} from 'lucide-react';
import {toast} from 'sonner';
import {ecommerceFeatureById,type EcommerceFeature} from '@/lib/ecommerce-features';
import {useStudio} from '@/lib/studio';
import {useGenerationQuote} from '@/lib/generation-quote';
import {useSubmission} from './submission';
import {GenerationCost} from './generation-cost';
import {EcommerceImageInput,EcommerceOutput,EcommerceStepHeading,ecommerceReferences,importEcommerceExample} from './ecommerce-presentation';
import {ResultFeed} from './results';
import {Button} from './ui/button';
import {Textarea} from './ui/textarea';
import {EcommerceFields} from './ecommerce-fields';
import {EcommerceGenerationSettings} from './ecommerce-generation-settings';
import {defaultDraft,restoreDraft,type Draft,type Skill} from '../../packages/contracts';
import {EcommerceTextPage} from './ecommerce-text';
import {EcommerceLocalPage} from './ecommerce-local';
import {ecommerceOutputSpecs} from '../../packages/ecommerce';
import {ecommerceFields} from '@/lib/ecommerce-profiles';
import {ecommerceControls,ecommerceControlVisible,type EcommerceChoice,type ReferenceControl} from '../../packages/ecommerce/controls';
import './ecommerce-feature.css';
import {ecommerceCommonKeys} from '../../packages/ecommerce/settings';
import {EcommerceMoreSettings} from './ecommerce-more-settings';

export {FeatureShowcase} from './ecommerce-presentation';
export function EcommerceFeatureRoute(){
  const {featureId}=useParams();
  const feature=ecommerceFeatureById.get(featureId||'');
  const studio=useStudio();
  if(!feature)return <div className="management-page"><h1>功能不存在</h1></div>;
  if(feature.mode==='text')return <EcommerceTextPage key={feature.id} feature={feature}/>;
  if(feature.mode==='local')return <EcommerceLocalPage key={feature.id} feature={feature}/>;
  const skill=studio.boot.skills.find(s=>s.id===feature.id);
  if(!skill)return <div className="management-page"><h1>{feature.name}</h1><p>新功能正在载入，请重启本地服务后刷新。</p></div>;
  return <EcommerceMediaPage key={feature.id} feature={feature} skill={skill}/>;
}
function EcommerceMediaPage({feature,skill}:{feature:EcommerceFeature;skill:Skill}){
  const studio=useStudio(),draft=studio.draft(skill.id),submission=useSubmission(skill),cost=useGenerationQuote(skill);
  const model=studio.boot.models.find(m=>m.id===draft.modelId);
  const roles=Object.keys(skill.inputs);
  const definitions=ecommerceFields(feature),page=ecommerceControls[feature.id];
  const fieldValue=(label:string)=>{const entry=Object.entries(definitions).find(([,field])=>field.label===label);return entry?String(draft.fields[entry[0]]??entry[1].default):'';};
  const templatePage=['ec-pod-14','ec-pod-15'].includes(feature.id);
  const visibleRoles=roles.filter(role=>role!=='reference'||(!templatePage||fieldValue('模板来源')==='自行上传')&&(feature.id!=='ec-pod-10'||fieldValue('画风来源')==='自定义画风'));
  const common=ecommerceCommonKeys;
  const pageFields=Object.entries(definitions).filter(([key,field])=>!common.includes(key)&&field.control&&skill.fields[key]&&ecommerceControlVisible(field.control,draft.fields,definitions));
  type Step={title:string;english:string;order:number;keys:string[];roles:string[];requirements?:boolean;required?:boolean};
  const groups=new Map<number,Step>();
  const groupFor=(order:number,title:string,english:string)=>{const id=Math.floor(order/100),group=groups.get(id)||{title,english,order,keys:[],roles:[]};groups.set(id,group);return group;};
  for(const [key,field] of pageFields){const control=field.control!,group=groupFor(control.order,control.step,control.english);group.keys.push(key);if(control.assetRole)group.required=group.required||skill.inputs[control.assetRole]?.required;if(control.required)group.required=true;}
  const requirementTitle=page?.requirements?.title||'补充要求';
  groupFor(page?.requirements?.order??99999,requirementTitle,'BRIEF').requirements=true;
  for(const [index,role] of visibleRoles.entries()){
    const input=skill.inputs[role],entry=page?.inputs?.find(i=>i.role===role);
    const templateOrder=page?.controls.find(c=>c.assetRole===role)?.order;
    const conditionalOrder:Record<string,Record<string,number>>={'ec-product-03':{reference:100},'ec-product-12':{reference:100},'ec-model-01':{model:300},'ec-model-02':{reference:300},'ec-pod-10':{reference:100},'ec-derivative-12':{accessory:150}};
    const group=groupFor(entry?entry.order+10:templateOrder??conditionalOrder[feature.id]?.[role]??-100*(roles.length-index),input.label,role==='targets'?'ORIGINAL':role==='reference'?'REFERENCE':role==='model'?'MODEL':'PRODUCT');
    group.roles.push(role);group.required=group.required||input.required;
  }
  const contentSteps=[...groups.values()].sort((a,b)=>a.order-b.order);
  const extraKeys=Object.keys(definitions).filter(key=>!definitions[key].control&&!common.includes(key)&&skill.fields[key]);
  const outputSpecs=ecommerceOutputSpecs(skill,draft),outputTotal=(outputSpecs?.length??1)*draft.count*(skill.batch.targetRole?draft.selectedTargetIds.length:1);
  const update=(patch:Partial<Draft>)=>studio.updateDraft(skill.id,{...studio.draft(skill.id),...patch});
  async function selectAsset(key:string,control:ReferenceControl,choice:EcommerceChoice){
    try{
      const image=choice.images?.[0],role=control.assetRole;
      if(!image||!role||!skill.inputs[role])throw new Error('该选项没有可用的参考图片');
      const before=studio.draft(skill.id),selected=String(before.fields[key]||'').split('、').filter(Boolean),removing=selected.includes(choice.value);
      if(!removing&&(before.inputRoles[role]?.length||0)>=6)throw new Error('最多选择 6 张模板，请先取消一张');
      const assetId=before.ecommerceTemplateAssets?.[choice.value]||(await importEcommerceExample(image)).id,current=studio.draft(skill.id);
      const templateAssets={...current.ecommerceTemplateAssets};
      if(removing)delete templateAssets[choice.value];else templateAssets[choice.value]=assetId;
      const ids=removing?(current.inputRoles[role]||[]).filter(id=>id!==assetId):[...new Set([...(current.inputRoles[role]||[]),assetId])];
      const design=current.imageDesign,bindings=design?.bindings||[];
      studio.updateDraft(skill.id,{...current,fields:{...current.fields,[key]:(removing?selected.filter(v=>v!==choice.value):[...selected,choice.value]).join('、')},ecommerceTemplateAssets:templateAssets,inputRoles:{...current.inputRoles,[role]:ids},...(design?{imageDesign:{...design,bindings:bindings.some(b=>b.assetId===assetId)||removing?bindings:[...bindings,{assetId,number:design.nextNumber}],nextNumber:bindings.some(b=>b.assetId===assetId)||removing?design.nextNumber:design.nextNumber+1}}:{})});
      await studio.refresh();toast.success(removing?`已取消${choice.value}模板`:`已使用${choice.value}模板`);
    }catch(error){toast.error((error as Error).message);}
  }
  const example=async()=>{
    try{const role=roles[0],reference=ecommerceReferences[feature.id],image=reference?.roles?.[role]?.[0]??reference?.recommendations[0];
      if(!image){toast.info('请从左侧上传素材');return;}
      const asset=await importEcommerceExample(image),current=studio.draft(skill.id);
      if(!role)return;
      const next={...current,inputRoles:{...current.inputRoles,[role]:[asset.id]},selectedTargetIds:skill.inputs[role].cardinality==='targets'?[asset.id]:current.selectedTargetIds};
      if(skill.imageDesign==='edit')next.imageDesign={...(next.imageDesign||{groupCount:1,screens:[],bindings:[],nextNumber:1}),bindings:[{assetId:asset.id,number:1}],nextNumber:2};
      studio.updateDraft(skill.id,next);await studio.refresh();toast.success('示例已添加到草稿');
    }catch(error){toast.error((error as Error).message);}
  };
  return <div className="ecommerce-page">
    <header className="ecommerce-page-heading"><div><span className="page-eyebrow">电商设计 / {feature.group}</span><h1>{feature.name}</h1><p>{skill.description}</p></div><Button variant="ghost" size="sm" onClick={()=>{studio.updateDraft(skill.id,defaultDraft(skill,studio.boot.models));toast.success('当前草稿已重置');}}><RotateCcw/>新建任务</Button></header>
    <div className="ecommerce-page-grid"><aside className="ecommerce-controls" aria-label={`${feature.name}操作区`}>
      <div className="ecommerce-controls-scroll">{contentSteps.map((step,index)=><section key={step.order} className="ecommerce-content-step"><EcommerceStepHeading number={index+1} english={step.english} title={step.title} required={step.required}/>{step.keys.some(key=>/来源$/.test(definitions[key].label))&&<EcommerceFields feature={feature} values={draft.fields} onChange={fields=>update({fields})} only={step.keys.filter(key=>/来源$/.test(definitions[key].label))} hideLabels={step.keys.length===1} onAssetChoice={selectAsset}/>}
        {step.roles.map(role=><EcommerceImageInput key={role} number={index+1} hideHeading hideRecommendations={templatePage&&role==='reference'} feature={feature} skill={skill} role={role}/>)}
        {!!step.keys.filter(key=>!/来源$/.test(definitions[key].label)).length&&<EcommerceFields feature={feature} values={draft.fields} onChange={fields=>update({fields})} only={step.keys.filter(key=>!/来源$/.test(definitions[key].label))} hideLabels={step.keys.length===1} onAssetChoice={selectAsset}/>} {step.requirements&&<><Textarea id={`requirements-${skill.id}`} aria-label={requirementTitle} rows={4} maxLength={16000} placeholder={page?.requirements?.placeholder||`描述${feature.name}的重点、风格或需要保留的细节…`} value={draft.requirements} onChange={e=>update({requirements:e.target.value})}/><div className="ecommerce-textarea-counter">{draft.requirements.length} / 16000</div></>}</section>)}
      <section className="ecommerce-additional-section"><EcommerceMoreSettings values={draft.fields} onChange={fields=>update({fields})} multiplePlatforms={definitions.platform.multiple} disabled={submission.pending} renderExtra={extraKeys.length?(values,onChange)=><EcommerceFields feature={feature} values={values} onChange={onChange} only={extraKeys}/>:undefined}/></section>
      <section className="ecommerce-generation-section"><EcommerceStepHeading number={contentSteps.length+1} english="FORMAT" title="生成比例" description="不选 = 尺寸与参考图一致"/><EcommerceGenerationSettings draft={draft} models={studio.boot.models} maxCount={studio.boot.settings.maxBatch} countLabel={outputSpecs?'每项张数':feature.mode==='edit'?'每张数量':'生成数量'} disabled={submission.pending} onChange={update}/></section></div>
      <footer className="ecommerce-controls-footer">{outputSpecs&&<span className="ecommerce-plan-count" aria-live="polite">{outputSpecs.length} 个输出项目 × 每项 {draft.count} 张{skill.batch.targetRole?` × ${draft.selectedTargetIds.length} 张原图`:''}<strong>共 {outputTotal} 张</strong></span>}<GenerationCost state={cost}/><Button disabled={submission.pending||!cost.canSubmit||!model?.credentialConfigured} onClick={()=>void submission.prepare()}><Sparkles/>预览并查询报价<ArrowRight/></Button></footer>
    </aside><EcommerceOutput feature={feature} onExample={()=>void example()} hasResults={studio.snapshot.batches.some(batch=>batch.skillId===skill.id)}><ResultFeed skill={skill} onExample={()=>void example()} onReuse={batch=>{studio.updateDraft(skill.id,restoreDraft(skill,studio.boot.models,batch.draft));toast.success('历史设置已载入草稿');}}/></EcommerceOutput></div>
    {submission.dialog}
  </div>;
}
