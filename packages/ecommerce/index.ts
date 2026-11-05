import type {Draft,Skill} from '../contracts';

export type EcommerceOutputSpec={label:string;instruction:string;inputRoles?:Record<string,string[]>;aspectRatio?:string;fieldValues?:Record<string,string>};
/** The same deterministic expansion drives the quantity preview, estimate and submitted plan. */
export function ecommerceOutputSpecs(skill:Pick<Skill,'id'|'name'|'fields'>,draft:Draft):EcommerceOutputSpec[]|undefined{
  if(!skill.id.startsWith('ec-'))return undefined;
  const field=(label:string)=>{const entry=Object.entries(skill.fields).find(([,def])=>def.label===label);return entry?String(draft.fields[entry[0]]??entry[1].default??''):'';};
  const selected=(label:string)=>[...new Set(field(label).split(/[、,，;；\n]+/).map(v=>v.trim()).filter(Boolean))];
  const from=(label:string)=>selected(label).map(value=>({label:value,instruction:`本张仅制作「${value}」，其余所选项目由其他独立任务制作。`,fieldValues:{[label]:value}}));
  const cross=(a:EcommerceOutputSpec[],b:EcommerceOutputSpec[])=>a.flatMap(x=>b.map(y=>({label:`${x.label} · ${y.label}`,instruction:`${x.instruction}\n${y.instruction}`,inputRoles:{...x.inputRoles,...y.inputRoles},fieldValues:{...x.fieldValues,...y.fieldValues},aspectRatio:y.aspectRatio||x.aspectRatio})));
  const n=skill.name;
  let specs:EcommerceOutputSpec[]|undefined;
  if(['商品套图','电商详情页','服饰商拍套图','设计长图'].includes(n))specs=from('包含模块');
  if(n==='商品多视角图')specs=from('拍摄角度');
  if(n==='商品细节图')specs=cross(from('细节区域'),from('拍摄角度'));
  if(n==='百变服饰图')specs=from('生成样式');
  if(n==='商品 SKU 图'){
    specs=from('SKU 清单');
    const labelKey=Object.keys(skill.fields).find(k=>skill.fields[k].label==='在图上标注 SKU 名称');
    if(labelKey&&draft.fields[labelKey]===true)specs=specs.map(s=>({...s,instruction:`${s.instruction} 在统一位置标注准确的 SKU 名称「${s.label}」。`}));
    const overviewKey=Object.keys(skill.fields).find(k=>skill.fields[k].label==='附加全系合集图');
    if(specs.length&&overviewKey&&draft.fields[overviewKey]===true)specs.push({label:'全系合集图',instruction:`将以下全部 SKU 放入一张清晰分区的全系总览图：${selected('SKU 清单').join('、')}。`,fieldValues:{'SKU 清单':selected('SKU 清单').join('、')}});
  }
  if(n==='平台套图')specs=from('套装内容');
  if(n==='套系衍生')specs=from('衍生单品');
  if(n==='季节转款')specs=from('目标季节');
  if(n==='工艺线稿')specs=from('线稿输出');
  if(n==='大促整套物料')specs=from('物料清单').map(s=>({...s,aspectRatio:s.label==='Banner'?'16:9':undefined}));
  if(n==='风格转绘')specs=field('画风来源')==='自定义画风'?(draft.inputRoles.reference||[]).map((id,i)=>({label:`参考画风 ${i+1}`,instruction:'仅参考本任务绑定的画风图片，保留原图主体和内容。',inputRoles:{reference:[id]},fieldValues:{'目标画风':''}})):from('目标画风');
  if(n==='印花效果图')specs=cross(from('承印品类'),from('商品底色'));
  if(skill.id==='ec-pod-14'||skill.id==='ec-pod-15'){
    const templates=draft.inputRoles.reference||[];
    specs=templates.map((id,i)=>{const label=Object.entries(draft.ecommerceTemplateAssets||{}).find(([,assetId])=>assetId===id)?.[0]||`模板 ${i+1}`;return {label,instruction:'只使用本任务绑定的这一张模板作为版式参考，不融合其他模板。保留当前商品的真实结构与外观。',inputRoles:{reference:[id]},fieldValues:{'模板选择':label}};});
  }
  if(n==='详情图复刻')specs=(draft.inputRoles.reference||[]).map((id,i)=>({label:`详情参考图 ${i+1}`,instruction:'只参考本任务绑定的这一张详情图的版式、背景和风格，使用当前商品制作新的详情分镜，不混入其他参考详情图。',inputRoles:{reference:[id]}}));
  if(['图片翻译','智能版式适配','AI 扩图'].includes(n))specs=from(n==='图片翻译'?'目标语言':'目标版式').map(s=>({...s,...(n==='图片翻译'?{}:{aspectRatio:s.label})}));
  if(n==='多语言多尺寸'){
    const languages=from('目标语言'),ratios=from('目标版式').map(s=>({...s,aspectRatio:s.label})),platforms=from('目标平台');
    specs=cross(cross(languages,ratios),platforms);
  }
  if(n==='专属模特套拍'){
    const products=draft.inputRoles.product||[],poses=from('机位与手势');
    specs=products.flatMap((id,i)=>poses.map(s=>({...s,label:`服装 ${i+1} · ${s.label}`,inputRoles:{product:[id]}})));
  }
  if(n==='搭配矩阵图'){
    const tops=draft.inputRoles.product||[],bottoms=draft.inputRoles.bottom?.length?draft.inputRoles.bottom:[undefined],accessories=draft.inputRoles.accessory?.length?draft.inputRoles.accessory:[undefined];
    const combinations=tops.flatMap((top,i)=>bottoms.flatMap((bottom,j)=>accessories.map((accessory,k)=>({top,bottom,accessory,i,j,k}))));
    const mode=field('组合方式');
    const pairs=mode==='按序配对'?tops.map((top,i)=>({top,bottom:bottoms[i%bottoms.length],accessory:accessories[i%accessories.length],i,j:i%bottoms.length,k:i%accessories.length})):mode==='随机抽取'?combinations.filter((_,i)=>i%Math.max(1,Math.floor(combinations.length/Math.max(1,tops.length)))===0).slice(0,Math.max(1,tops.length)):combinations;
    specs=pairs.map(({top,bottom,accessory,i,j,k})=>({label:`主单品 ${i+1}${bottom?` + 下装 ${j+1}`:''}${accessory?` + 配饰 ${k+1}`:''}`,instruction:'仅搭配本任务绑定的单品，保留每件商品的颜色、结构和标识。',inputRoles:{product:[top],bottom:bottom?[bottom]:[],accessory:accessory?[accessory]:[]}}));
    const scenes:EcommerceOutputSpec[]=[...from('场景背景').map(s=>({...s,inputRoles:{scene:[]}})),...(draft.inputRoles.scene||[]).map((id,i)=>({label:`自定义场景 ${i+1}`,instruction:'背景仅参考本任务绑定的场景图片。',inputRoles:{scene:[id]}}))];
    specs=cross(specs,scenes);
  }
  return specs;
}
