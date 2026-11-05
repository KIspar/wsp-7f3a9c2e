import type { Attempt, Draft, ProductProfile, Skill } from '../../packages/contracts';

export function productRole(skill: Skill) {
  if (skill.inputs.product) return 'product';
  // Editing targets and a model/person reference are never inferred as product images.
  return undefined;
}
export function loadProduct(draft: Draft, skill: Skill, product: ProductProfile): Draft {
  const role=productRole(skill);
  if(!role)throw new Error('此技能没有商品图入口，请在相应素材入口选择图片');
  return {...draft,productContext:{id:product.id,revision:product.revision,name:product.name,facts:product.facts},
    inputRoles:{...draft.inputRoles,[role]:[...product.assetIds]},
    fields:{...draft.fields,...(skill.fields.productName?{productName:product.name}:{}),...(skill.fields.sellingPoints?{sellingPoints:product.facts}:{})},
    // A white preparation belongs to an exact product-reference set.
    whiteTaskId:undefined,
    ...(skill.fields.whiteMode?{fields:{...draft.fields,whiteMode:skill.fields.whiteMode.default||'直接使用商品原图'}}:{}),
  };
}
export function itemVersions(attempts: Attempt[]) {
  const groups=new Map<string,Attempt[]>();
  for(const attempt of attempts)groups.set(attempt.itemId,[...(groups.get(attempt.itemId)||[]),attempt]);
  return [...groups.values()].map(versions=>versions.sort((a,b)=>a.attemptNumber-b.attemptNumber));
}
