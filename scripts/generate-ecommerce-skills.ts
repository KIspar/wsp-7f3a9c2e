/** Refreshes the bundled media skills without replacing user-published copies in SQLite. */
import fs from 'node:fs';
import path from 'node:path';
import {ecommerceFeatures} from '../src/lib/ecommerce-features';
import {ecommerceFields,ecommerceInputs} from '../src/lib/ecommerce-profiles';

const root=path.resolve('skills');
const operationRules: [RegExp,string][] = [
  [/套图|整套物料|套拍|套系/, '形成风格统一但用途各异的一组画面，每张应是独立成品，不把多张图拼成一张。'],
  [/详情|细节|特写/, '突出真实可见的结构、纹理与使用细节，不能杜撰尺寸、成分或功效。'],
  [/主图|封面|直通车|Banner/, '主体清晰突出，构图留足安全区域；文案仅使用用户确认的信息。'],
  [/拼图|三视图|一键细节图/, '在单张成品中以清晰分区呈现所需角度或画面，不凭空改变商品外观。'],
  [/多视角|商品细节图/, '每张只输出指定的一个角度或细节特写，不将多个角度拼在同一张图中。'],
  [/换背景|配景|换景/, '保留原商品或人物的外观与姿态，仅重构背景、光线和接触阴影。'],
  [/换色|颜色替换/, '仅修改用户指定色彩，保留纹理、版型、材质表现与其他元素。'],
  [/换模特|换脸/, '仅在拥有肖像使用权的素材上操作；保持商品结构、穿着关系与自然光影。'],
  [/试衣|上身|试戴|试穿|搭配/, '将商品自然应用到人物或场景，准确保持版型、印花、Logo 和可见细节。'],
  [/抠图|白底图|印花提取|满印提取/, '分离主体和背景，边缘干净，不侵蚀商品、图案或原有结构。'],
  [/修复|精修|去皱|去 AI 感|超清/, '修复可见瑕疵并改善清晰度，不能改变商品身份、真实结构或品牌标识。'],
  [/复刻|同款换拍/, '仅借鉴参考图的构图、光线和视觉节奏，不复制其商品、标识或文案。'],
  [/印花|图案|POD|皮肤设计/, '保持图案可印刷与边缘清晰，避免第三方受保护标志和未经授权的角色。'],
  [/海报|信息图|传单|直播背景|社媒|种草/, '建立明确视觉层级、阅读顺序与安全边距，文字准确可读。'],
];
const groupRules:Record<string,string>={
  product:'以商品原图为外观依据，真实还原款式、颜色、Logo 和可见细节。',
  model:'以人物与商品素材为依据，维持真实的人体比例、穿着关系和面部一致性。',
  pod:'以用户提供的图案和商品为依据，兼顾可生产的图案完整性。',
  tools:'按指定图片处理目标执行，不擅自增加商品属性或营销承诺。',
  derivative:'以原款的真实结构为基准进行设计衍生，明确区分创意提案与真实商品。',
  crossborder:'按照目标平台、市场与语言制作电商视觉，商品事实只取自用户资料。',
  marketing:'以真实商品卖点与已确认活动信息制作可投放视觉。',
  design:'以用户内容和素材完成平面设计，注重字体层级、留白和可读性。',
};
let written=0;
for(const feature of ecommerceFeatures){
  if(feature.mode==='text'||feature.mode==='local')continue;
  const edit=feature.mode==='edit';
  const fields=Object.fromEntries(Object.entries(ecommerceFields(feature)).map(([key,{multiple,long,control,...field}])=>[key,field]));
  const inputs=ecommerceInputs(feature);
  const config={schemaVersion:1,id:feature.id,name:feature.name,category:'image',description:`${feature.group} · ${feature.name}。${groupRules[feature.groupId]}`,executor:'media',imageDesign:edit?'edit':'general',inputs,fields,batch:edit?{mode:'per-target',targetRole:'targets',defaultVariants:1,defaultCount:1}:{mode:'repeat',defaultCount:1},model:{category:'image',defaultId:'tt-image'},promptSection:'prompt.main'};
  const fieldLines=Object.keys(fields).map(key=>`${fields[key].label}：{{fields.${key}}}`).join('；');
  const rule=operationRules.find(([pattern])=>pattern.test(feature.name))?.[1]||'按本功能名称和用户要求完成准确、自然、可用的画面。';
  const prompt=`你是电商视觉设计师。当前任务是「${feature.name}」。\n${groupRules[feature.groupId]}\n${rule}\n参数：${fieldLines}。\n用户补充要求：{{user.requirements}}\n${edit?'只修改当前目标图片 {{target.label}}；其他图片仅作为参考。':'本图为第 {{item.index}} / {{batch.total}} 张独立成品。'}\n不得捏造商品材质、尺寸、销量、优惠或功能；未授权的商标、人物肖像及第三方作品不得照搬。`;
  const source=`---\n${JSON.stringify(config,null,2)}\n---\n\n# ${feature.name}\n\n## prompt.main\n\n${prompt}\n`;
  const folder=path.join(root,feature.id),file=path.join(folder,'技能提示词.md');
  fs.mkdirSync(folder,{recursive:true});
  if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==source){fs.writeFileSync(file,source);written++;}
}
console.log(`已更新 ${written} 个内置电商视觉技能（用户发布版本保留）`);
