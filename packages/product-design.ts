import { productKitSchema, type Draft, type ProductKitDraft } from './contracts';
export const kitCategories = [
  {key:'whiteBackground',id:'white',label:'白底图',min:0},
  {key:'sellingPoints',id:'selling',label:'卖点图',min:3},
  {key:'scenes',id:'scene',label:'场景图',min:2},
  {key:'other',id:'other',label:'其他',min:2},
] as const;
export function kitSlots(input?:ProductKitDraft) {
 const kit=productKitSchema.parse(input||{});
 return kitCategories.flatMap(c=>Array.from({length:kit[c.key]},(_,i)=>({id:`kit-${c.id}-${i+1}`,category:c.label,ordinal:i+1,
  purpose:c.key==='whiteBackground'?'干净背景展示商品整体外观':c.key==='sellingPoints'?`第 ${i+1} 个有依据的独立卖点`:c.key==='scenes'?`第 ${i+1} 个不同的使用、穿搭或消费场景`:kit.otherPurposes[i]?.trim()||'',
 })));
}
export const replicaTypes=['电商商品图','服饰电商图','营销海报','社媒图文','创意海报','其他'] as const;
export const replicaFidelities=['参考风格','高度复刻'] as const;
export const fidelityDescriptions={参考风格:'参考整体风格和结构，允许调整色彩、构图与场景。',高度复刻:'优先保留主体位置、机位、人物姿态、布局与光影，替换商品与指定文案。'};
export function replicaRules(type='电商商品图',fidelity='高度复刻') {
 if(!replicaTypes.includes(type as typeof replicaTypes[number])||!replicaFidelities.includes(fidelity as typeof replicaFidelities[number]))throw Error('复刻类型或程度无效');
 return `复刻类型：${type}；复刻程度：${fidelity}。${fidelityDescriptions[fidelity as keyof typeof fidelityDescriptions]}商品外观、颜色、标识和结构以自有商品图为准。不继承同行的价格、功效、销量、认证或品牌承诺。用户未明确提供替换文案时，移除原宣传文案；不承诺人物身份或像素完全一致。`;
}
export function kitOutputKeys(draft:Draft){return kitSlots(draft.productKit).map(s=>s.id);}
