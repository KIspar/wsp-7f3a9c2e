import catalog from './controls.json';
import type {Draft,Skill} from '../contracts';

export type ControlImage={src:string;alt:string};
export type DiagramRegion={x:number;y:number;width:number;height:number;hero?:boolean;round?:boolean};
export type EcommerceChoice={value:string;description?:string;images?:ControlImage[];diagram?:DiagramRegion[];category?:string};
export type ReferenceControl={
  id:string;label:string;step:string;english:string;order:number;
  type:'choice'|'text'|'boolean';multiple?:boolean;optional?:boolean;required?:boolean;long?:boolean;
  choices?:EcommerceChoice[];default?:string|boolean;placeholder?:string;
  suggestions?:string[];
  categories?:string[];assetRole?:string;aliases?:Record<string,string>;
};
export type PageControls={controls:ReferenceControl[];requirements?:{title:string;placeholder:string;order:number};inputs?:{role:string;label:string;order:number;required:boolean;cardinality:'single'|'group'|'targets'}[]};
export const ecommerceControls=catalog as Record<string,PageControls>;

export function ecommerceControlVisible(control:ReferenceControl,fields:Record<string,string|number|boolean>,definitions:Skill['fields']){
  const value=(label:string)=>{const entry=Object.entries(definitions).find(([,field])=>field.label===label);return entry?String(fields[entry[0]]??entry[1].default):'';};
  if(control.label==='主图构图')return value('出图方式')!=='AI 自由发挥';
  if(control.label==='模板选择')return value('模板来源')!=='自行上传';
  if(control.label==='目标画风')return value('画风来源')!=='自定义画风';
  return true;
}

/** Selected card descriptions and geometry are part of the submitted prompt, not just the UI. */
export function ecommerceControlInstructions(skill:Pick<Skill,'id'|'fields'>,draft:Draft):string{
  const page=ecommerceControls[skill.id];
  if(!page)return '';
  const instructions:string[]=[];
  for(const control of page.controls){
    if(!ecommerceControlVisible(control,draft.fields,skill.fields))continue;
    const entry=Object.entries(skill.fields).find(([,field])=>field.label===control.label);
    if(!entry)continue;
    const value=draft.fields[entry[0]]??entry[1].default;
    if(control.type==='boolean'){
      if(control.label==='人物 / 商品结构保真'){if(value===true)instructions.push(`${control.label}：开启，保持原人物身份与商品结构、Logo、印花和比例。`);}
      else instructions.push(`${control.label}：${value===true?'开启，按此要求处理画面':'关闭，不启用此附加效果'}。`);
      continue;
    }
    const selected=control.multiple?String(value??'').split('、'):[String(value??'')];
    for(const choice of control.choices||[]){
      if(!selected.includes(choice.value))continue;
      const geometry=choice.diagram?.map((r,i)=>`区域${i+1}${r.hero?'（主视觉）':''}：左${r.x}%，上${r.y}%，宽${r.width}%，高${r.height}%${r.round?'，圆形裁切':''}`).join('；');
      if(choice.description||geometry)instructions.push(`${control.label}「${choice.value}」：${choice.description||''}${geometry?`。布局以画布百分比定位：${geometry}。`:''}`);
    }
  }
  if(skill.id==='ec-product-04'){
    const mode=Object.entries(skill.fields).find(([,f])=>f.label==='出图方式');
    if(mode&&draft.fields[mode[0]]==='AI 自由发挥')instructions.push('出图方式为 AI 自由发挥：忽略主图构图模板，以用户补充描述安排单张拼图，不套用先前保存的模板。');
  }
  return instructions.length?`\n已选控件的执行规则：\n${instructions.join('\n')}`:'';
}
