import {beforeEach,afterEach,it,expect} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createStore,type Store} from '../apps/server/store';
import {compilePlan,submit} from '../apps/server/engine';
import {defaultDraft,restoreDraft,productKitSchema,type Asset} from '../packages/contracts';
import {getCreativeDraft,workshopSkill,workshopGeneration} from '../apps/server/catalog';
import type {ProductCreativeDraft,CatalogProduct} from '../packages/catalog';
import {savePrompt} from '../apps/server/prompts';
import {kitSlots} from '../packages/product-design';
import type {PromptVersion} from '../packages/prompts';
let store:Store,dir:string;
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'unified-design-'));store=createStore(dir,process.cwd());});
afterEach(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
function draft(id:string){return defaultDraft(store.skills().find(s=>s.id===id)!,store.models());}
function product():CatalogProduct{return {id:'p',revision:1,site:'jp0663',sourceId:'x',sourceUrl:'https://pc.jp0663.com/detail/x',supplier:'',itemNumber:'',wholesaleCost:10,title:'测试上衣',salePrice:null,sellingPoints:'用户确认的领口设计',parameters:[{name:'成分',value:'来源声明',origin:'source'}],colors:[{id:'red',name:'红色'},{id:'blue',name:'蓝色'}],sizes:['L'],skus:[{id:'red-l',colorId:'red',size:'L',cost:10}],postTitle:'',postBody:'',bindings:[{id:'main',kind:'main',assetId:'example-6-1',order:0,label:'原图'},{id:'red-photo',kind:'color',targetId:'red',assetId:'example-6-2',order:0,label:'红色原图'}],collectionStatus:'completed',archived:false,createdAt:'2026-10-30',updatedAt:'2026-10-30'};}
it('plans seven explicit distinct slots and keeps later category IDs stable when earlier counts grow',()=>{
 const d=draft('product-kit');d.inputRoles={product:['example-6-1']};
 const plan=compilePlan(store,'product-kit',d);expect(plan.total).toBe(7);expect(plan.items.map(i=>i.screenType)).toEqual(['卖点图','卖点图','卖点图','场景图','场景图','其他','其他']);
 expect(plan.items.every(i=>i.prompt.includes('简体中文'))).toBe(true);
 const before=plan.items.map(i=>i.targetId);d.productKit!.whiteBackground=2;const next=compilePlan(store,'product-kit',d);expect(next.items.slice(2).map(i=>i.targetId)).toEqual(before);
 d.productKit!.sellingPoints=2;expect(()=>compilePlan(store,'product-kit',d)).toThrow();
 d.productKit=productKitSchema.parse({whiteBackground:20,sellingPoints:20});expect(()=>compilePlan(store,'product-kit',d)).toThrow('单批上限');
 d.productKit=productKitSchema.parse({otherPurposes:['','背面']});expect(()=>compilePlan(store,'product-kit',d)).toThrow('具体用途');
});
it('freezes editable layout versions, rejects excess selections, and never sends effect examples as references',()=>{
 const d=draft('product-kit');d.inputRoles={product:['example-6-1']};d.productKit!.layouts=[{id:'selling-layout-01',version:1}];
 const old=store.get<PromptVersion>('prompt-version','selling-layout-01-v1')!;
 const updated=savePrompt(store,{...old.value,prompt:'新的可编辑版式要求'},old.templateId,1);
 const first=compilePlan(store,'product-kit',d);expect(first.items[0].prompt).toContain(old.value.prompt);expect(first.items[0].prompt).not.toContain('新的可编辑');expect(first.items[0].references).toEqual(['example-6-1']);
 d.productKit!.layouts=[{id:old.templateId,version:updated.version.number}];expect(compilePlan(store,'product-kit',d).items[0].prompt).toContain('新的可编辑版式要求');
 d.productKit!.layouts=Array.from({length:4},(_,i)=>({id:`selling-layout-0${i+1}`,version:1}));expect(()=>compilePlan(store,'product-kit',d)).toThrow('超过卖点图数量');
});
it('binds selected replica targets one to one and applies genuinely different fidelity rules',()=>{
 const d=draft('image-replica');d.inputRoles={product:['example-6-1'],targets:['example-10-1','example-10-2','example-10-3']};d.selectedTargetIds=['example-10-3','example-10-1'];d.fields.targetDescription='模特上衣';d.overrides['example-10-3']={productIds:['example-6-2'],promptOverride:'保留完整人物'};
 const high=compilePlan(store,'image-replica',d);expect(high.total).toBe(2);expect(high.items[0].references).toEqual(['example-6-2','example-10-3']);expect(high.items.every(i=>!i.references.includes('example-10-2'))).toBe(true);expect(high.items[0].prompt).toContain('模特上衣');expect(high.items[0].prompt).toContain('移除原宣传文案');
 d.fields.replicationFidelity='参考风格';const style=compilePlan(store,'image-replica',d);expect(style.hash).not.toBe(high.hash);expect(style.items[0].prompt).toContain('允许调整色彩');
 d.fields.targetDescription='';expect(()=>compilePlan(store,'image-replica',d)).toThrow('替换对象');d.selectedTargetIds=[];expect(()=>compilePlan(store,'image-replica',d)).toThrow('勾选');
});
it('defaults to six ordered detail screens and preserves old one-screen snapshots',()=>{
 const d=draft('detail-design');expect(d.imageDesign!.screens).toHaveLength(6);
 const old={...d,imageDesign:{...d.imageDesign!,screens:[d.imageDesign!.screens[0]]}};
 expect(restoreDraft(store.skills().find(s=>s.id==='detail-design')!,store.models(),old).imageDesign!.screens).toHaveLength(1);
 d.fields.productName='上衣';d.inputRoles={product:['example-6-1']};d.imageDesign!.screens[1].productIds=['example-6-2'];d.imageDesign!.screens.reverse();
 const plan=compilePlan(store,'detail-design',d);expect(plan.items[0].screenId).toBe('detail');expect(plan.items[4].references).toEqual(['example-6-2']);
});
it('requires explicit original selection for new catalog kit and detail drafts without changing stored choices',()=>{
 const p=product();store.put('catalog-product',p.id,p);
 for(const purpose of ['main','detail'] as const){
  const d=getCreativeDraft(store,p.id,purpose);expect(d.value.generation.inputRoles.product).toEqual([]);
  expect(()=>compilePlan(store,workshopSkill(purpose,d),d.value.generation)).toThrow();
  d.value.generation.inputRoles.product=['example-6-2'];store.put('catalog-draft',d.id,d);
  expect(getCreativeDraft(store,p.id,purpose).value.generation.inputRoles.product).toEqual(['example-6-2']);
 }
});
it('projects retired main drafts into kits while preserving stored history and source facts',()=>{
 const p=product();store.put('catalog-product',p.id,p);const fresh=getCreativeDraft(store,p.id,'main');expect(workshopSkill('main',fresh)).toBe('product-kit');expect(fresh.value.outputKeys).toEqual(kitSlots(fresh.value.generation.productKit).map(s=>s.id));
 fresh.value.generation.catalogScope={kind:'sku',id:'red-l'};fresh.value.generation.inputRoles.product=['example-6-2'];const g=workshopGeneration(store,p,fresh);expect(g.productContext!.facts).toContain('来源提供，未核实');expect(g.productContext!.facts).toContain('颜色 红色；尺码 L');expect(g.productContext!.facts).not.toContain('10');
 const old={...fresh,value:{...fresh.value,generation:draft('scene-recreate'),outputKeys:['main-old']}};store.put('catalog-draft',old.id,old);const migrated=getCreativeDraft(store,p.id,'main');expect(workshopSkill('main',migrated)).toBe('product-kit');expect(migrated.value.generation.productKit).toBeTruthy();expect(migrated.value.outputKeys).toHaveLength(7);expect(store.get<ProductCreativeDraft>('catalog-draft',old.id)!.value.outputKeys).toEqual(['main-old']);
});
it('rejects reference byte overflow per output and keeps captured task slots immutable',()=>{
 const d=draft('product-kit');d.inputRoles={product:['example-6-1']};const plan=compilePlan(store,'product-kit',d);const b=submit(store,{skillId:'product-kit',draft:d,action:'generate',planHash:plan.hash,idempotencyKey:'kit-immutable-key',expectedDraftRevision:0}).batch;
 d.productKit!.whiteBackground=2;expect(store.readBatch(b.id)!.draft.productKit!.whiteBackground).toBe(0);
 const asset=store.get<Asset>('asset','example-6-1')!;store.put('asset',asset.id,{...asset,bytes:25*1024*1024});expect(()=>compilePlan(store,'product-kit',d)).toThrow('30 MB');
});
