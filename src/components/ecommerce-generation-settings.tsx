import {useId} from 'react';
import {ChevronDown,Settings2} from 'lucide-react';
import type {Draft,Model} from '../../packages/contracts';
import {parameterLabel,parameterValueLabel} from '@/lib/parameter-labels';
import {Properties,PropertyField} from './common';
import {FormSelect} from './form-select';
import {Field,FieldLabel} from './ui/field';
import {NumberInput} from './ui/number-input';
import {ToggleGroup,ToggleGroupItem} from './ui/toggle-group';
import {ecommerceImageRatios,ecommerceReferenceRatio} from '../../packages/ecommerce/settings';

export function EcommerceGenerationSettings({draft,models,maxCount,countLabel,onChange,disabled=false}:{
  draft:Draft;models:Model[];maxCount:number;countLabel:string;
  onChange:(patch:Partial<Draft>)=>void;disabled?:boolean;
}){
  const id=useId(),model=models.find(item=>item.id===draft.modelId);
  const resolution=model?.parameters.resolution;
  const advanced=Object.entries(model?.parameters||{}).filter(([name])=>name!=='resolution');
  const summary=advanced.map(([name,field])=>parameterValueLabel(name,draft.parameters[name]??field.default??''));
  const summaryDescription=advanced.map(([name,field],i)=>`${parameterLabel(name,field.label)}：${summary[i]}`).join('；');
  const ratioOptions=[...ecommerceImageRatios,...(model?.aspectRatios||[]).filter(value=>!ecommerceImageRatios.includes(value as typeof ecommerceImageRatios[number])&&!['auto','custom'].includes(value))];
  return <fieldset className="ecommerce-generation-settings" disabled={disabled} aria-label="生成设置参数">
    <ToggleGroup type="single" aria-label="生成比例" value={draft.aspectRatio} spacing={1} className="ecommerce-ratio-grid" onValueChange={aspectRatio=>onChange({aspectRatio:aspectRatio||ecommerceReferenceRatio})}>
      <ToggleGroupItem value={ecommerceReferenceRatio} aria-label="跟随参考图"><span className="ecommerce-ratio-shape is-reference" aria-hidden="true"/><span>跟随参考图</span></ToggleGroupItem>
      {ratioOptions.map(ratio=>{const [w,h]=ratio.split(':').map(Number),available=model?.aspectRatios.includes(ratio);return <ToggleGroupItem key={ratio} value={ratio} disabled={!available} title={available?ratio:'当前模型不支持此比例'}><span className="ecommerce-ratio-shape" aria-hidden="true" style={{width:Math.round(16*Math.min(1,w/h)),height:Math.round(16*Math.min(1,h/w))}}/><span>{ratio}</span></ToggleGroupItem>;})}
    </ToggleGroup>
    <Field className="ecommerce-model-field" orientation="horizontal">
      <FieldLabel htmlFor={`${id}-model`}>生成模型</FieldLabel>
      <FormSelect id={`${id}-model`} aria-label="生成模型" value={draft.modelId} options={models.filter(item=>item.category==='image').map(item=>({value:item.id,label:item.name,disabled:!item.enabled||!item.credentialConfigured}))} onValueChange={modelId=>{
        const next=models.find(item=>item.id===modelId);
        if(next)onChange({modelId,aspectRatio:draft.aspectRatio===ecommerceReferenceRatio||next.aspectRatios.includes(draft.aspectRatio)?draft.aspectRatio:next.aspectRatios[0],parameters:Object.fromEntries(Object.entries(next.parameters).map(([name,field])=>[name,field.default??'']))});
      }}/>
    </Field>
    <div className={`ecommerce-primary-settings ${resolution?'has-resolution':''}`}>
      {resolution&&<PropertyField name="resolution" field={resolution} value={draft.parameters.resolution??resolution.default??''} onChange={value=>onChange({parameters:{...draft.parameters,resolution:value}})}/>}
      <Field><FieldLabel htmlFor={`${id}-count`}>{countLabel}</FieldLabel><NumberInput id={`${id}-count`} aria-label={countLabel} min={1} max={maxCount} value={draft.count} onValueChange={value=>onChange({count:Number(value)||1})}/></Field>
    </div>
    {!!advanced.length&&<details key={model?.id} className="ecommerce-advanced-settings">
      <summary><span className="ecommerce-advanced-label"><Settings2 aria-hidden="true"/>高级设置</span><span className="ecommerce-advanced-values" title={summaryDescription}>{summary.join(' · ')}</span><ChevronDown className="ecommerce-advanced-chevron" aria-hidden="true"/></summary>
      <Properties definitions={Object.fromEntries(advanced)} values={draft.parameters} onChange={parameters=>onChange({parameters})}/>
    </details>}
  </fieldset>;
}
