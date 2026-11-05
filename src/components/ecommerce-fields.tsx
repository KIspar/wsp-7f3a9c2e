import {useId} from 'react';
import {ecommerceFields,type EcommerceField} from '@/lib/ecommerce-profiles';
import type {EcommerceFeature} from '@/lib/ecommerce-features';
import {Button} from './ui/button';
import {Input} from './ui/input';
import {Textarea} from './ui/textarea';
import {FormSelect} from './form-select';
import {Switch} from './ui/switch';
import {ecommerceReferences} from './ecommerce-presentation';
import {EcommerceChoicePicker} from './ecommerce-choice-picker';
import {Checkbox} from './ui/checkbox';
import {ecommerceControlVisible,type EcommerceChoice,type ReferenceControl} from '../../packages/ecommerce/controls';
import {ecommerceCommonKeys} from '../../packages/ecommerce/settings';
import {EcommerceMoreSettings} from './ecommerce-more-settings';

type Values=Record<string,string|number|boolean>;
export function EcommerceFields({feature,values,onChange,exclude=[],only,hideLabels=false,onAssetChoice}:{feature:EcommerceFeature;values:Values;onChange:(values:Values)=>void;exclude?:string[];only?:string[];hideLabels?:boolean;onAssetChoice?:(key:string,control:ReferenceControl,choice:EcommerceChoice)=>Promise<void>}){
  const prefix=useId(),definitions=ecommerceFields(feature);
  const common=ecommerceCommonKeys;
  const fields=Object.entries(definitions).filter(([key,field])=>!common.includes(key)&&!exclude.includes(key)&&(!only||only.includes(key))&&(!field.control||ecommerceControlVisible(field.control,values,definitions)));
  const set=(key:string,value:string|boolean)=>onChange({...values,[key]:value});
  const render=([key,field]:[string,EcommerceField])=>{const id=`${prefix}-${key}`,value=String(values[key]??field.default??''),choices=field.multiple||field.type==='select'&&!common.includes(key)&&(field.options?.length||0)<=6;return <div className="ecommerce-feature-field" key={key}>
    {field.control?.type==='boolean'?<div className="ecommerce-boolean-choice"><Checkbox id={id} checked={!!(values[key]??field.default)} onCheckedChange={v=>set(key,v===true)}/><label htmlFor={id}>{field.label}</label></div>:field.control?.choices?.length?<>{!hideLabels&&<span id={id} className="ecommerce-field-title">{field.label}{field.multiple&&<small>多选</small>}</span>}<EcommerceChoicePicker control={field.control} value={value} multiple={field.multiple} onChange={v=>set(key,v)} onAssetChoice={onAssetChoice?choice=>onAssetChoice(key,field.control!,choice):undefined}/></>:choices?<><span id={id} className="ecommerce-field-title">{field.label}{field.multiple&&<small>多选</small>}</span><div className="ecommerce-choice-options" role="group" aria-labelledby={id}>{(field.options||[]).map(option=>{const selected=field.multiple?value.split('、').includes(option):value===option,image=ecommerceReferences[feature.id]?.choices.find(item=>item.alt===option);return <Button size="sm" variant={selected?'secondary':'outline'} className={image?'ecommerce-picture-choice':''} key={option} aria-pressed={selected} onClick={()=>set(key,field.multiple?(selected?value.split('、').filter(v=>v!==option):[...value.split('、').filter(Boolean),option]).join('、'):option)}>{image&&<img src={image.src} alt="" loading="lazy"/>}{option}</Button>;})}</div></>:<>{(!hideLabels||field.type==='boolean')&&<label htmlFor={id}>{field.label}</label>}{field.type==='boolean'?<Switch id={id} checked={!!(values[key]??field.default)} onCheckedChange={v=>set(key,v)}/>:field.type==='select'?<FormSelect id={id} aria-label={field.label} value={value} options={field.options||[]} onValueChange={next=>set(key,next)}/>:field.long?<Textarea id={id} aria-label={field.label} placeholder={field.control?.placeholder} rows={3} value={value} maxLength={4000} onChange={e=>set(key,e.target.value)}/>:<Input id={id} aria-label={field.label} placeholder={field.control?.placeholder} value={value} maxLength={1000} onChange={e=>set(key,e.target.value)}/>}</>}
    {!!field.control?.suggestions?.length&&<div className="ecommerce-choice-options" role="group" aria-label={`${field.label}常用选项`}>{field.control.suggestions.map(suggestion=><Button key={suggestion} size="xs" variant="outline" aria-pressed={value===suggestion} onClick={()=>set(key,suggestion)}>{suggestion}</Button>)}</div>}
  </div>;};
  return <div className="ecommerce-feature-fields">{fields.map(render)}{common.some(key=>!exclude.includes(key)&&(!only||only.includes(key)))&&<EcommerceMoreSettings values={values} onChange={onChange} multiplePlatforms={definitions.platform.multiple}/>}</div>;
}
