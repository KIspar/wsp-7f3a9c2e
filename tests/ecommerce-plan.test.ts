import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStore,type Store} from '../apps/server/store';
import {compilePlan} from '../apps/server/engine';
import {defaultDraft,type Draft,type Skill} from '../packages/contracts';
import sharp from 'sharp';
import {prepareEcommerceFormat} from '../apps/server/ecommerce-format';
import {ecommerceImageRatios} from '../packages/ecommerce/settings';

let store:Store,directory:string;
beforeAll(()=>{directory=fs.mkdtempSync(path.join(os.tmpdir(),'ecommerce-plan-'));store=createStore(directory,process.cwd());store.put('settings','global',{...store.settings(),maxBatch:100});});
afterAll(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
function setup(name:string){const skill=store.skills().find(s=>s.id===name||s.name===name&&s.id.startsWith('ec-'))!;const draft=defaultDraft(skill,store.models());draft.inputRoles={product:['example-6-1']};return {skill,draft};}
function setField(skill:Skill,draft:Draft,label:string,value:string|boolean){const key=Object.keys(skill.fields).find(key=>skill.fields[key].label===label)!;draft.fields[key]=value;}
describe('ecommerce executable output plans',()=>{
  it('passes custom market, language and design settings into the final prompt',()=>{
    const {skill,draft}=setup('商品套图');
    Object.assign(draft.fields,{market:'新西兰',language:'菲律宾语（Tagalog）',platform:'TikTok',themeColor:'#ee6633',fontStyle:'圆润品牌字体',settingsDescription:'保留右下角安全区'});
    const plan=compilePlan(store,skill.id,draft);
    for(const text of ['新西兰','菲律宾语（Tagalog）','TikTok','#ee6633','圆润品牌字体','保留右下角安全区'])expect(plan.items[0].prompt).toContain(text);
    for(const aspectRatio of ecommerceImageRatios){draft.aspectRatio=aspectRatio;expect(compilePlan(store,skill.id,draft).items[0].parameters.aspectRatio).toBe(aspectRatio);}
    const platform=setup('平台套图');platform.draft.fields.market='菲律宾';
    const platformPrompt=compilePlan(store,platform.skill.id,platform.draft).items[0].prompt;
    expect(platformPrompt).toContain('目标销售国家/地区：菲律宾');
    expect(platformPrompt).not.toContain('目标市场：');
  });
  it('follows each original image independently and keeps arbitrary proportions through pixel sizing',async()=>{
    const {skill,draft}=setup('AI 万能改图');
    const inputs=[{id:'format-tall',width:400,height:800},{id:'format-wide',width:800,height:400},{id:'format-custom',width:400,height:700}];
    for(const input of inputs){const file=path.join(directory,'media',`${input.id}.png`);await sharp({create:{width:input.width,height:input.height,channels:3,background:'#ffffff'}}).png().toFile(file);store.put('asset',input.id,{id:input.id,url:`/media/${input.id}.png`,type:'image',mime:'image/png',bytes:fs.statSync(file).size,source:'upload',createdAt:new Date().toISOString()});}
    draft.inputRoles={targets:inputs.map(i=>i.id)};draft.selectedTargetIds=inputs.map(i=>i.id);draft.imageDesign!.bindings=inputs.map((i,index)=>({assetId:i.id,number:index+1}));draft.aspectRatio='reference';
    await prepareEcommerceFormat(store,skill.id,draft);
    const plan=compilePlan(store,skill.id,draft),estimate=compilePlan(store,skill.id,draft,'generate',true);
    expect(plan.items.slice(0,2).map(i=>i.parameters.aspectRatio)).toEqual(['1:2','2:1']);
    const [w,h]=String(plan.items[2].parameters.size).split('x').map(Number);
    expect(w%16).toBe(0);expect(h%16).toBe(0);expect(w/h).toBeCloseTo(4/7,1);
    expect(estimate.items.map(i=>i.parameters)).toEqual(plan.items.map(i=>i.parameters));
    await prepareEcommerceFormat(store,skill.id,draft);expect(compilePlan(store,skill.id,draft).hash).toBe(plan.hash);
  });
  it('charges and generates one independent task per selected module and variant',()=>{
    const {skill,draft}=setup('商品套图');setField(skill,draft,'包含模块','首屏主视觉、商品细节、使用场景');draft.count=2;
    const plan=compilePlan(store,skill.id,draft),estimate=compilePlan(store,skill.id,draft,'generate',true);
    expect(plan.total).toBe(6);expect(estimate.total).toBe(6);expect(plan.items.map(i=>i.targetLabel)).toEqual(['首屏主视觉','首屏主视觉','商品细节','商品细节','使用场景','使用场景']);expect(plan.items[2].prompt).toContain('本张仅制作「商品细节」');
    setField(skill,draft,'包含模块','');expect(()=>compilePlan(store,skill.id,draft)).toThrow('至少一个输出项目');
  });
  it('separates SKU variants and preserves the template as a reference',()=>{
    const {skill,draft}=setup('商品 SKU 图');draft.inputRoles.reference=['example-10-1'];setField(skill,draft,'SKU 清单','蓝色\n红色、绿色');
    const plan=compilePlan(store,skill.id,draft);expect(plan.total).toBe(3);expect(plan.items[1].targetLabel).toBe('红色');expect(plan.items.every(i=>i.references.includes('example-10-1'))).toBe(true);
  });
  it('expands language and canvas combinations with the correct per-item ratio',()=>{
    const {skill,draft}=setup('多语言多尺寸');draft.inputRoles={targets:['example-6-1']};draft.selectedTargetIds=['example-6-1'];draft.imageDesign!.bindings=[{assetId:'example-6-1',number:1}];setField(skill,draft,'目标语言','英语、菲律宾语');setField(skill,draft,'目标版式','1:1、9:16');
    const plan=compilePlan(store,skill.id,draft);expect(plan.total).toBe(4);expect(plan.items.map(i=>i.parameters.aspectRatio)).toEqual(['1:1','9:16','1:1','9:16']);expect(plan.items[2].prompt).toContain('菲律宾语');
  });
  it('binds each outfit to its own pieces and expands scenes without mixing products',()=>{
    const {skill,draft}=setup('搭配矩阵图');draft.inputRoles={product:['example-6-1','example-6-2'],bottom:['example-10-1','example-10-2'],accessory:['example-10-3']};setField(skill,draft,'场景背景','纯白棚拍、居家日常');
    const plan=compilePlan(store,skill.id,draft);expect(plan.total).toBe(8);expect(plan.items[0].references).toEqual(['example-6-1','example-10-1','example-10-3']);expect(plan.items[2].references).toEqual(['example-6-1','example-10-2','example-10-3']);
    setField(skill,draft,'组合方式','按序配对');expect(compilePlan(store,skill.id,draft).total).toBe(4);
    draft.count=100;expect(()=>compilePlan(store,skill.id,draft)).toThrow('单批最多');
  });
  it('includes a saved selection only for its original target and rejects stale masks',()=>{
    const {skill,draft}=setup('消除笔');draft.inputRoles={targets:['example-6-1','example-6-2']};draft.selectedTargetIds=[...draft.inputRoles.targets];draft.imageDesign!.bindings=draft.selectedTargetIds.map((assetId,i)=>({assetId,number:i+1}));
    const asset={...store.get<any>('asset','example-10-1'),id:'selection-mask',source:'upload'};store.put('asset',asset.id,asset);draft.editMasks={'example-6-1':{assetId:asset.id,description:'框选招牌文字'}};
    const plan=compilePlan(store,skill.id,draft);expect(plan.items[0].references.at(-1)).toBe(asset.id);expect(plan.items[0].prompt).toContain('选区蒙版');expect(plan.items[1].references).not.toContain(asset.id);
    delete draft.inputRoles.targets[0];draft.inputRoles.targets=draft.inputRoles.targets.filter(Boolean);expect(()=>compilePlan(store,skill.id,draft)).toThrow('原图已移除');
  });
  it('executes a layout card geometry and ignores that saved layout in free mode',()=>{
    const {skill,draft}=setup('主图拼图');setField(skill,draft,'主图构图','两小一大');
    const layout=compilePlan(store,skill.id,draft);expect(layout.items[0].prompt).toContain('布局以画布百分比定位');expect(layout.items[0].prompt).toContain('两小一大');
    setField(skill,draft,'出图方式','AI 自由发挥');
    const free=compilePlan(store,skill.id,draft);expect(free.items[0].prompt).not.toContain('两小一大');expect(free.items[0].prompt).not.toContain('区域1');expect(free.items[0].prompt).toContain('忽略主图构图模板');
  });
  it('keeps each selected POD template in its own task, including quote quantities',()=>{
    const {skill,draft}=setup('ec-pod-14');draft.inputRoles.reference=['example-10-1','example-10-2'];draft.ecommerceTemplateAssets={'四宫格':'example-10-1','深色高级':'example-10-2'};setField(skill,draft,'模板选择','四宫格、深色高级');draft.count=2;
    const plan=compilePlan(store,skill.id,draft),estimate=compilePlan(store,skill.id,draft,'generate',true);
    expect(plan.total).toBe(4);expect(estimate.total).toBe(4);
    expect(plan.items[0].references).toEqual(['example-6-1','example-10-1']);expect(plan.items[2].references).toEqual(['example-6-1','example-10-2']);
    expect(plan.items[0].prompt).toContain('模板选择：四宫格');expect(plan.items[0].prompt).not.toContain('深色高级');
  });
  it('expands print products and colors with only the current item instructions',()=>{
    const {skill,draft}=setup('印花效果图');setField(skill,draft,'承印品类','T恤、马克杯');setField(skill,draft,'商品底色','白色、黑色');
    const plan=compilePlan(store,skill.id,draft);expect(plan.total).toBe(4);expect(plan.items.map(i=>i.targetLabel)).toEqual(['T恤 · 白色','T恤 · 黑色','马克杯 · 白色','马克杯 · 黑色']);
    expect(plan.items[0].prompt).toContain('承印品类：T恤');expect(plan.items[0].prompt).not.toContain('承印品类：T恤、马克杯');
  });
  it('allows empty optional print inspiration without silently picking the first card',()=>{
    const {skill,draft}=setup('AI 印花设计');draft.requirements='制作一张原创植物印花';expect(Object.entries(skill.fields).find(([,f])=>f.label==='灵感题材')?.[1].default).toBe('');
    expect(()=>compilePlan(store,skill.id,draft)).not.toThrow();
  });
  it('binds each detail replica to one reference and counts all variants',()=>{
    const {skill,draft}=setup('详情图复刻');draft.inputRoles.reference=['example-10-1','example-10-2'];draft.count=2;
    const plan=compilePlan(store,skill.id,draft);expect(plan.total).toBe(4);expect(plan.items[0].references).toEqual(['example-6-1','example-10-1']);expect(plan.items[2].references).toEqual(['example-6-1','example-10-2']);
  });
  it('uses custom style references without applying hidden built-in styles',()=>{
    const {skill,draft}=setup('风格转绘');draft.inputRoles={targets:['example-6-1'],reference:['example-10-1']};draft.selectedTargetIds=['example-6-1'];draft.imageDesign!.bindings=[{assetId:'example-6-1',number:1},{assetId:'example-10-1',number:2}];
    setField(skill,draft,'目标画风','水彩');setField(skill,draft,'画风来源','自定义画风');
    const plan=compilePlan(store,skill.id,draft);expect(plan.total).toBe(1);expect(plan.items[0].prompt).not.toContain('目标画风：水彩');expect(plan.items[0].references).toEqual(['example-6-1','example-10-1']);
  });
  it('adds a separately priced SKU overview and keeps individual name instructions',()=>{
    const {skill,draft}=setup('商品 SKU 图');draft.inputRoles.reference=['example-10-1'];setField(skill,draft,'SKU 清单','蓝色、红色');setField(skill,draft,'在图上标注 SKU 名称',true);setField(skill,draft,'附加全系合集图',true);
    const plan=compilePlan(store,skill.id,draft),estimate=compilePlan(store,skill.id,draft,'generate',true);expect(plan.total).toBe(3);expect(estimate.total).toBe(3);expect(plan.items[0].prompt).toContain('SKU 名称「蓝色」');expect(plan.items[2].targetLabel).toBe('全系合集图');
  });
});
