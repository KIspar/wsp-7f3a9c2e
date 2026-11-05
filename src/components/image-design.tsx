import { AiAssistButton } from './analysis';
import {GenerationCost} from './generation-cost';
import {useGenerationQuote} from '@/lib/generation-quote';
import { useState } from 'react';
import {ArrowDown,ArrowUp,GripVertical,Plus,Sparkles,Trash2} from 'lucide-react';
import { toast } from 'sonner';
import { detailScreenTypes, emptyImageDesign, type Draft, type Skill } from '../../packages/contracts';
import { useStudio } from '@/lib/studio';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { NumberInput } from './ui/number-input';
import {Field,FieldGroup,FieldLabel} from './ui/field';
import { FormSelect } from './form-select';
import { Checkbox } from './ui/checkbox';
import { UploadRole } from './uploads';
import { useSubmission } from './submission';

export function ImageGenerationControls({skill}:{skill:Skill}) {
  const studio=useStudio(),draft=studio.draft(skill.id);
  const model=studio.boot.models.find(m=>m.id===draft.modelId);
  const update=(patch:Partial<Draft>)=>studio.updateDraft(skill.id,{...studio.draft(skill.id),...patch});
  const countLabel=skill.imageDesign==='edit'?'每图生成数量':'生成数量';
  return <>
    <FormSelect aria-label="成品语言" className="w-auto" value={String(draft.fields.language || '简体中文')} options={skill.fields.language.options || []} onValueChange={language=>update({fields:{...draft.fields,language}})} />
    <FormSelect aria-label="输出分辨率" className="w-auto" value={String(draft.parameters.resolution)} options={(model?.parameters.resolution?.options || []).filter(v=>['1K','2K','4K'].includes(v))} onValueChange={resolution=>update({parameters:{...draft.parameters,resolution}})} />
    {skill.imageDesign==='detail'?<label className="quantity-control"><span>组数</span><NumberInput aria-label="生成组数" min={1} max={studio.boot.settings.maxBatch} value={draft.imageDesign?.groupCount || 1} onValueChange={value=>update({imageDesign:{...(draft.imageDesign || emptyImageDesign()),groupCount:Number(value)||1}})} /></label>:<label className="quantity-control"><span>{skill.imageDesign==='edit'?'每图':'数量'}</span><NumberInput aria-label={countLabel} min={1} max={studio.boot.settings.maxBatch} value={draft.count} onValueChange={count=>update({count:Number(count)||1})} /></label>}
  </>;
}
const factsRequired=new Set(['品牌故事图','效果对比图','工艺制作图','配件/赠品图','售后保障图','尺寸/容量/尺码图','详细规格/参数表','商品成分图']);
export function DetailDesignForm({skill,submit,onParameters}:{skill:Skill;submit:ReturnType<typeof useSubmission>;onParameters:()=>void}) {
  const studio=useStudio(), draft=studio.draft(skill.id),design=draft.imageDesign || emptyImageDesign();
  const cost=useGenerationQuote(skill);
  const [open,setOpen]=useState(true),[screenType,setScreenType]=useState<string>('核心卖点图'),[dragId,setDragId]=useState<string>();
  const update=(patch:Partial<Draft>)=>studio.updateDraft(skill.id,{...studio.draft(skill.id),...patch});
  const screens=design.screens;
  const setScreens=(next:typeof screens)=>update({imageDesign:{...design,screens:next}});
  const move=(id:string,to:number)=>{const next=[...screens],from=next.findIndex(s=>s.id===id);if(from<0||to<0||to>=next.length)return;const [item]=next.splice(from,1);next.splice(to,0,item);setScreens(next);};
  const models=studio.boot.models.filter(m=>m.enabled&&m.category==='image'),model=models.find(m=>m.id===draft.modelId);
  return <section className="detail-design-form">
    <div className="section-heading"><div><h2>商品与详情规划</h2></div><Button variant="ghost" size="sm" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'收起配置':'展开配置'}</Button></div>
    {open&&<>
      <div className="detail-product-grid"><UploadRole skill={skill} role="product" /><FieldGroup>
        <Field><FieldLabel htmlFor="detail-product-name">产品名</FieldLabel><Input id="detail-product-name" value={String(draft.fields.productName||'')} placeholder="例如：男士宽松连帽外套" onChange={e=>update({fields:{...draft.fields,productName:e.target.value}})} /></Field>
        <Field><div className="selling-points-label"><FieldLabel htmlFor="detail-selling-points">商品卖点、参数与设计要求</FieldLabel><AiAssistButton skill={skill} action="selling-points" field="sellingPoints" label="AI 编写" /></div><Textarea id="detail-selling-points" placeholder="填写已确认的卖点、尺码、面料，也可补充风格、人物与场景要求…" value={String(draft.fields.sellingPoints||'')} onChange={e=>update({fields:{...draft.fields,sellingPoints:e.target.value}})} /></Field>
      </FieldGroup></div>
      <div className="screen-list-heading"><h3>详情屏 <span className="muted">{screens.length} 屏</span></h3><div><FormSelect aria-label="添加详情图类型" value={screenType} options={[...detailScreenTypes]} onValueChange={setScreenType} /><Button variant="outline" size="sm" disabled={screens.length>=40} onClick={()=>setScreens([...screens,{id:crypto.randomUUID(),type:screenType as typeof detailScreenTypes[number],requirements:'',facts:''}])}><Plus />添加一屏</Button></div></div>
      <div className="detail-screen-list">{screens.map((screen,index)=><div className="detail-screen-row" key={screen.id} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(dragId)move(dragId,index);setDragId(undefined);}}>
        <div className="detail-screen-order"><span draggable onDragStart={()=>setDragId(screen.id)} onDragEnd={()=>setDragId(undefined)} title="拖动调整顺序"><GripVertical /></span><b>{String(index+1).padStart(2,'0')}</b></div>
        <div className="detail-screen-content"><div className="detail-screen-title"><strong>{screen.type}</strong><div><Button aria-label={`上移第${index+1}屏`} variant="ghost" size="icon-sm" disabled={index===0} onClick={()=>move(screen.id,index-1)}><ArrowUp /></Button><Button aria-label={`下移第${index+1}屏`} variant="ghost" size="icon-sm" disabled={index===screens.length-1} onClick={()=>move(screen.id,index+1)}><ArrowDown /></Button><Button aria-label={`删除第${index+1}屏`} variant="ghost" size="icon-sm" onClick={()=>setScreens(screens.filter(s=>s.id!==screen.id))}><Trash2 /></Button></div></div>
          <Input aria-label={`第${index+1}屏局部要求`} placeholder="本屏要求，例如突出领口做工（选填）" value={screen.requirements} onChange={e=>setScreens(screens.map(s=>s.id===screen.id?{...s,requirements:e.target.value}:s))} />
          {factsRequired.has(screen.type)&&<Field><FieldLabel htmlFor={`facts-${screen.id}`}>已确认资料 · 必填</FieldLabel><Textarea id={`facts-${screen.id}`} placeholder="填写本屏的真实参数、政策或品牌资料，系统不会从图片推测。" value={screen.facts} onChange={e=>setScreens(screens.map(s=>s.id===screen.id?{...s,facts:e.target.value}:s))} /></Field>}
        </div>
      </div>)}</div>
      {!screens.length&&<p className="muted">添加至少一屏后即可生成，可重复添加同一类型。</p>}
      <Field><div className="selling-points-label"><FieldLabel htmlFor="detail-requirements">全组补充要求</FieldLabel><AiAssistButton skill={skill}/></div><Textarea id="detail-requirements" value={draft.requirements} onChange={e=>update({requirements:e.target.value})} placeholder="统一配色、风格、人物与场景要求…" /></Field>
    </>}
    <div className="detail-design-controls"><div className="composer-controls"><FormSelect aria-label="生成模型" className="w-auto" value={draft.modelId} options={models.map(m=>({value:m.id,label:m.name}))} onValueChange={id=>{const next=models.find(m=>m.id===id)!;update({modelId:id,aspectRatio:next.aspectRatios.includes(draft.aspectRatio)?draft.aspectRatio:next.aspectRatios[0],parameters:Object.fromEntries(Object.entries(next.parameters).map(([k,f])=>[k,f.default??'']))});}} /><FormSelect aria-label="平台" className="w-auto" value="抖音" options={['抖音']} onValueChange={()=>{}} /><FormSelect aria-label="画面比例" className="w-auto" value={draft.aspectRatio} options={model?.aspectRatios||[]} onValueChange={aspectRatio=>update({aspectRatio})} /><ImageGenerationControls skill={skill}/><Button variant="outline" size="sm" onClick={onParameters}>高级参数</Button></div><div className="detail-design-submit"><span>{screens.length} 屏 × {design.groupCount} 组 = <strong>{screens.length*design.groupCount} 张</strong></span><GenerationCost state={cost}/><Button disabled={submit.pending||!screens.length||!models.length||!cost.canSubmit} onClick={()=>void submit.prepare()}><Sparkles />预览生成</Button></div></div>
  </section>;
}
export function EditImageBindings({skill}:{skill:Skill}) {
  const studio=useStudio(),draft=studio.draft(skill.id),bindings=draft.imageDesign?.bindings||[];
  const assets=[...studio.snapshot.assets,...studio.boot.examples];
  const active=[...new Set(Object.values(draft.inputRoles).flat())];
  const invalid=[...draft.requirements.matchAll(/图\s*(\d+)/g)].map(m=>Number(m[1])).filter(n=>!bindings.some(b=>b.number===n&&active.includes(b.assetId)));
  const update=(patch:Partial<Draft>)=>studio.updateDraft(skill.id,{...studio.draft(skill.id),...patch});
  const templates=[['改人物','将图2中的人物改为图1中的同一人，保留图2的服装、姿态与背景。'],['改文案','把图1中的“原文案”改为“新文案”，保持其他内容不变。'],['去元素','去掉图1中的指定元素，并自然补全背景。'],['改风格','将图1改为都市休闲风格，保留商品款式与细节。']];
  return <section className="edit-bindings-panel"><div className="section-heading"><div><h2>编辑对象与参照</h2></div><span className="muted">{draft.selectedTargetIds.length} 图 × {draft.count} 版</span></div>
    <div className="edit-image-list">{active.map(id=>{const number=bindings.find(b=>b.assetId===id)?.number,asset=assets.find(a=>a.id===id),target=draft.inputRoles.targets?.includes(id);return <div className="edit-image-binding" key={id}>{target&&<Checkbox aria-label={`编辑图${number}`} checked={draft.selectedTargetIds.includes(id)} onCheckedChange={checked=>update({selectedTargetIds:checked?[...draft.selectedTargetIds,id]:draft.selectedTargetIds.filter(a=>a!==id)})}/>}<img src={asset?.url} alt={`图${number}`} /><div><Button size="sm" variant="ghost" onClick={()=>update({requirements:draft.requirements+`图${number}`})}>图{number}</Button><small>{target?'待编辑':'辅助参考'}</small></div></div>;})}{!active.length&&<p className="muted">上传待编辑图，也可从生成结果选择“编辑图片”。</p>}</div>
    <div className="edit-shortcuts">{templates.map(([label,text])=><Button key={label} variant="outline" size="sm" onClick={()=>{update({requirements:draft.requirements?draft.requirements+'\n'+text:text});toast.info('已插入示例句式，请按实际图片编号修改');}}>{label}</Button>)}</div>
    {!!invalid.length&&<p className="error-text">图{[...new Set(invalid)].join('、图')}引用已失效，请修改提示词或恢复素材。</p>}
  </section>;
}
