/** Convert the reviewed DOM inventory into small, local, executable page controls. No network IO. */
import fs from 'node:fs';
import {ecommerceFeatures} from '../src/lib/ecommerce-features';
import {baseEcommerceFields} from '../src/lib/ecommerce-profiles';
import type {EcommerceChoice,PageControls,ReferenceControl} from '../packages/ecommerce/controls';

type SourceOption={tag:string;type:string|null;name:string;text:string;choice:string|null;desc:string;value:string;placeholder:string|null;selected:boolean;cls:string;images:{src:string;alt:string}[];rects:{hero:boolean;style:string}[]};
type SourceGroup={id:string;label:string;multiple:boolean;context:string;options:SourceOption[]};
type SourceSection={title:string;english:string;groups:SourceGroup[];uploads:{label:string;multiple:boolean}[]};
const audit=JSON.parse(fs.readFileSync('docs/ecommerce-controls-audit.json','utf8')) as {records:{id:string;name:string;sections:SourceSection[]}[]};
const sources=JSON.parse(fs.readFileSync('public/ecommerce-reference/sources.json','utf8')) as Record<string,{path:string}>;
const clean=(s:string)=>s.replace(/^\d+(?=[A-Z])[A-Z]+/,'').replace(/^\s*\*\s*/,'').replace(/（[^）]*(?:必填|选填|多选|示例|填写)[^）]*）|\([^)]*(?:多选|选填|必填)[^)]*\)/g,'').replace(/已选\s*\d+.*$|\s*放大编辑.*$|\s*AI 帮写.*$|\s*选填.*$|\s*手机上传.*$|\s*建议选择.*$|\s*0\s*\/\s*\d+.*$/g,'').trim();
const norm=(s:string)=>clean(s).replace(/[\s/·（）()：:&]/g,'');
const aliases:Record<string,string>={
  '创作模式':'套图模式','套图策略':'套图类型','服饰类型':'服装类型','要提取的单品':'提取单品','遮挡补全强度':'遮挡补全','必须保留':'锁定内容',
  '整体身材':'体型目标','主题风格库':'主题风格','Logo 风格':'视觉风格','ogo 风格':'视觉风格','裂变变量':'裂变方向','机位':'机位角度',
  '拍摄角度CAMERA ANGLE':'机位角度','相机景别CAMERA SHOT':'景别','拍摄镜头SHOOTING LENS':'镜头','布光方式LIGHTING STYLE':'布光','滤镜FILTER':'滤镜',
  '布光方案':'布光','电商布光':'布光','适配平台':'目标平台','输出底色':'底色','承印品类（非必填）':'承印品类',
  '保持模板的':'保持模板的内容',
};
const map:Record<string,Record<string,string>>={
  'ec-product-01':{'choice-4':'套图模式','choice-5':'套图类型','field-1':'套图补充要求'},
  'ec-product-03':{'choice-3':'模板组合方式','choice-4':'模板来源'},
  'ec-product-04':{'choice-3':'@filter','choice-4':'主图构图'},
  'ec-product-07':{'choice-1':'@upload','choice-2':'@count'},
  'ec-product-08':{'choice-2':'分类维度','field-0':'SKU 清单'},
  'ec-product-19':{'choice-2':'创作模式','choice-3':'画面类型'},
  'ec-product-21':{'choice-5':'背景组合方式','choice-6':'背景来源'},
  'ec-product-24':{'choice-1':'@preset','choice-2':'拍摄角度'},
  'ec-model-02':{'choice-8':'@action','choice-9':'码数','choice-10':'拍摄方向','choice-11':'手势','choice-12':'姿势组合方式','choice-13':'景别','choice-14':'发型来源','choice-15':'眼镜来源','choice-16':'妆容来源','choice-17':'包袋来源','choice-18':'鞋子来源','choice-19':'配饰来源','choice-20':'背景来源','choice-21':'背景颜色','field-0':'身高（cm）','field-1':'体重（kg）','field-2':'胸围（cm）','field-3':'腰围（cm）','field-4':'臀围（cm）','field-5':'体型补充','field-6':'姿势补充'},
  'ec-model-16':{'choice-2':'@face'},
  'ec-model-17':{'choice-7':'光照方向','choice-8':'拍摄时段'},
  'ec-model-21':{'choice-4':'秀场姿势','choice-5':'站姿','choice-6':'街拍姿势','choice-7':'互动姿势'},
  'ec-pod-07':{'choice-4':'@stepper','choice-5':'@count'},
  'ec-pod-10':{'choice-1':'画风来源','choice-2':'目标画风'},
  'ec-pod-14':{'choice-3':'模板来源','choice-4':'@filter','choice-5':'模板选择'},
  'ec-pod-15':{'choice-3':'模板来源','choice-4':'@filter','choice-5':'模板选择'},
  'ec-pod-18':{'choice-4':'目标平台'},
  'ec-tools-01':{'choice-1':'@action','choice-2':'修改方向'},
  'ec-tools-03':{'choice-4':'视觉风格'},
  'ec-derivative-04':{'choice-5':'花型比例','choice-6':'贴合方式'},
  'ec-derivative-05':{'choice-5':'换色范围','choice-6':'保持不变'},
  'ec-derivative-06':{'choice-4':'系列统一方式','choice-5':'陈列方式'},
  'ec-derivative-09':{'choice-2':'线稿风格','choice-3':'标注方式','choice-4':'标注语言'},
  'ec-derivative-11':{'choice-2':'用途场景','choice-4':'人物长相来源','choice-5':'姿势来源','choice-6':'背景来源','choice-8':'机位角度','choice-9':'景别','choice-10':'布光'},
  'ec-marketing-06':{'choice-7':'倒计时位置','choice-8':'关闭按钮位置','field-0':'优惠形式','field-1':'金额 / 折扣','field-2':'使用门槛','field-3':'CTA 文案'},
};
const layoutCategories:Record<string,string[]>={
  '主辅叠图':['一大两小','两小一大','一大一小','右主左辅','上大下两小','上大下三小','满铺叠卡','斜向叠放','画册跨页','居中两翼'],
  '多角度':['一前一后','三连拍','走秀叠影','站坐对照','左右对望','双侧身'],
  '模特+平铺':['模特 + 平铺','模特 + 挂拍','模特·平铺·细节','平铺为主','模特+双平铺'],
  '细节特写':['全身 + 半身','全身 + 圆抠特写','全身半身细节','双圆抠','主图+细节条'],
  '格状分栏':['四宫格','顶栏缩略','左栏缩略','六宫格'],
  '卖点版式':['左文右图','底部色带','角标主图','侧栏卖点'],
  '创意拼贴':['杂志封面','拍立得叠放','胶片三联','撕纸拼贴','卡片错落','场景叠抠图','色块分割'],
};
const templateCategories:Record<string,string[]>={'宫格':['四宫格','六宫格'],'单品':['居中主体','展台居中'],'分栏':['左右分栏','斜切分割','三段竖排'],'细节':['双栏细节'],'场景':['生活场景','平铺俯拍'],'调性':['深色高级','浅彩清新']};
const switchLabels:Record<string,Record<string,string>>={
  'ec-product-01':{'switch-12':'商品立体感','switch-13':'不出现人物'},
  'ec-product-02':{'switch-29':'适用人群','switch-30':'无文字'},
  'ec-product-08':{'switch-3':'在图上标注 SKU 名称','switch-4':'附加全系合集图'},
  'ec-product-17':{'switch-3':'场景结构不变'},
  'ec-model-01':{'switch-10':'模特和场景一致'},'ec-model-09':{'switch-2':'同版替换'},
  'ec-model-11':{'switch-2':'脸朝向·姿势自然贴合原图','switch-3':'手脚自动修复'},
  'ec-pod-07':{'switch-7':'保护功能结构','switch-11':'皮肤上出现文字'},
  'ec-pod-17':{'switch-4':'允许人物','switch-5':'允许文字'},
  'ec-marketing-04':{'switch-6':'倒计时显示'},'ec-marketing-06':{'switch-5':'价格爆炸贴','switch-6':'倒计时'},
  'ec-marketing-07':{'switch-3':'左下信息板','switch-4':'商品展示位','switch-5':'显示品牌 Logo'},
};
const optionAliases:Record<string,Record<string,string>>={
  '出图方式':{'智能拼图':'选模板','按参考版式':'选模板'},
  '纯图 / 图文':{'中文图文':'图文（中文）','中英图文':'图文（中英）'},
  '目标季节':{'春季':'春季款','夏季':'夏季款','秋季':'秋季款','冬季':'冬季款'},
  '线稿输出':{'正面':'正面款式图','背面':'背面款式图','细节':'细节放大'},
};

function choice(o:SourceOption):EcommerceChoice|undefined{
  let value=o.name||o.images[0]?.alt||o.choice||o.text;
  if(!value||/^(更多|＋|−|\+|指令案例|推荐方案|推荐搭配)/.test(value)||value.length>85)return;
  value=value.replace(/\s+NEW$|\s+会员$/,'').trim();
  const description=o.desc||(o.name&&o.text.startsWith(o.name)?o.text.slice(o.name.length).trim():'');
  const images=o.images.filter(i=>sources[i.src]).map(i=>({src:sources[i.src].path,alt:i.alt}));
  const diagram=o.rects.map(r=>{
    const percent=(key:string)=>Number(r.style.match(new RegExp(`${key}:\\s*([\\d.]+)%`))?.[1]||0);
    return {x:percent('left'),y:percent('top'),width:percent('width'),height:percent('height'),hero:r.hero,...(/border-radius:\s*50%/.test(r.style)?{round:true}:{})};
  }).filter(r=>r.width>0&&r.height>0);
  return {value,...(description?{description}:{}),...(images.length?{images}:{}),...(diagram.length?{diagram}:{})};
}

const result:Record<string,PageControls>={};
for(const record of audit.records){
  const feature=ecommerceFeatures.find(f=>f.id===record.id)!;
  const base=baseEcommerceFields(feature),labels=Object.values(base).map(f=>f.label),controls:ReferenceControl[]=[];
  let requirements:PageControls['requirements'];
  record.sections.forEach((section,sectionIndex)=>{
    let title=clean(section.title),order=sectionIndex*100;
    const buttons=section.groups.filter(g=>g.id.startsWith('choice-'));
    const photoLabels=record.id==='ec-model-17'?['机位角度','景别','镜头','景深','背景']:['机位角度','景别','布光','镜头','景深','背景'];
    if(title.startsWith('专业摄影控制'))title='专业摄影控制';
    const fields=section.groups.filter(g=>g.id.startsWith('field-')&&['INPUT','TEXTAREA','SELECT'].includes(g.options[0]?.tag)&&g.options[0]?.type!=='checkbox');
    for(const group of section.groups){
      const explicit=map[record.id]?.[group.id];
      if(explicit?.startsWith('@'))continue;
      if(!group.options.length)continue;
      if(group.options[0].type==='range'||group.options[0].tag==='SELECT'&&/^\d+(?:\d+)*$/.test(group.options[0].text.replace(/\s/g,'')))continue;
      if(group.options[0].type==='checkbox'){
        const label=['人物 / 商品结构保真','人物结构保真','智能联想'].find(label=>group.context.startsWith(label));
        if(label)controls.push({id:group.id,label,step:title||label,english:section.english||'PRESERVE',order:order++,type:'boolean',default:group.options[0].selected});
        continue;
      }
      if(group.id.startsWith('switch-')){
        const label=switchLabels[record.id]?.[group.id];
        if(label)controls.push({id:group.id,label,step:title,english:section.english||'CREATE',order:order++,type:'boolean',default:group.options[0].selected||/(^|\s)on(\s|$)/.test(group.options[0].cls)});
        continue;
      }
      const isChoice=group.id.startsWith('choice-');
      if(!isChoice&&!fields.includes(group))continue;
      if(/^(生成比例|输出比例|生成尺寸|生成套数|每张参考图出几张)/.test(title))continue;
      let label=explicit||clean(group.label)||title;
      if(title==='专业摄影控制'&&isChoice)label=photoLabels[buttons.indexOf(group)];
      if(title==='专业摄影控制'&&!isChoice)continue;
      if(record.id.startsWith('ec-derivative-')&&title==='行业模板'&&isChoice)label=buttons.indexOf(group)===0?'行业模板':'规格 / 版型';
      if(['ec-model-13','ec-model-14'].includes(record.id)&&title==='参考姿势'&&isChoice)label=['取景范围','拍摄方向','手势','换姿方式'][buttons.indexOf(group)];
      if(title==='参考模特'&&isChoice)label='模特来源';
      if(title==='参考模特'&&!isChoice)label='模特描述';
      if(!isChoice&&!explicit&&fields.length>1&&!group.label){
        const context=clean(group.context).replace(/≤\s*\d+.*$/,'').trim();
        if(context&&context.length<=28&&!/放大编辑|AI 帮写|^\d+\s*\/|减少多手|不变/.test(context))label=context;
        else if(['长','宽','高'].includes(group.options[0].placeholder||''))label=group.options[0].placeholder!;
      }
      if(!explicit&&isChoice&&buttons.length>1&&title!=='专业摄影控制'&&label===title&&!['参考姿势','行业模板'].includes(title))continue;
      const matching=labels.find(l=>norm(l)===norm(label));
      label=matching||aliases[label]||label;
      if(!label||label.length>45||/本地上传|素材库|手机上传|放大编辑/.test(label))continue;
      const isRequirements=!isChoice&&!explicit&&/^(补充描述|补充要求|补充说明|其他要求|商品卖点.*要求|文本描述|修改说明|补充布光要求|搭配要求|融合描述|修改指令|海报需求|传单内容|要点内容|长图大纲)/.test(label);
      if(isRequirements&&!requirements){requirements={title:label,placeholder:group.options[0].placeholder||'',order};continue;}
      if(isChoice){
        const choices=group.options.map(choice).filter((o):o is EcommerceChoice=>!!o);
        if(choices.length<2||new Set(choices.map(c=>c.value)).size!==choices.length)continue;
        const selected=group.options.filter(o=>o.selected).map(o=>choice(o)?.value).filter(Boolean);
        const old=Object.values(base).find(f=>f.label===label);
        const multiple=group.multiple||selected.length>1||(buttons.length===1||buttons.at(-1)===group)&&/可多选|已选|默认全选/.test(section.title)||!!old?.multiple&& !/拍摄角度|专业摄影控制/.test(title);
        const optional=!selected.length;
        const control:ReferenceControl={id:group.id,label,step:title,english:section.english||'CREATE',order:order++,type:'choice',choices,...(multiple?{multiple:true}:{}),...(optional?{optional:true}:{}),default:multiple?selected.join('、'):selected[0]||'',...(optionAliases[label]?{aliases:optionAliases[label]}:{})};
        if(label==='主图构图'||label==='模板选择'){
          const categories=label==='主图构图'?layoutCategories:templateCategories;
          control.categories=Object.keys(categories);
          for(const item of choices)item.category=Object.keys(categories).find(c=>categories[c].includes(item.value));
        }
        if(label==='模板选择'){control.assetRole='reference';control.multiple=true;control.default='';}
        controls.push(control);
      }else{
        if(fields.length>1&&!group.label&&!explicit&&label===title){
          if(/商品名称/.test(group.options[0].placeholder||''))label='商品名称';
          else if(/文案/.test(group.options[0].placeholder||''))label='图片文案';
          else continue;
        }
        if(record.id==='ec-marketing-06'&&group.id==='field-0')controls.push({id:group.id,label,step:title,english:section.english||'CREATE',order:order++,type:'choice',choices:['满减券','折扣券','无门槛券','红包','赠品'].map(value=>({value})),default:group.options[0].value||'满减券'});
        else controls.push({id:group.id,label,step:title||label,english:section.english||'BRIEF',order:order++,type:'text',long:group.options[0].tag==='TEXTAREA',placeholder:group.options[0].placeholder||'',default:group.options[0].value||''});
      }
    }
  });
  if(record.id==='ec-product-04')controls.push({id:'preserve',label:'人物 / 商品结构保真',step:'人物 / 商品结构保真',english:'PRESERVE',order:350,type:'boolean',default:false});
  const original=feature.mode==='edit'?'targets':'product';
  const roleOrder:Record<string,string[]>={
    'ec-product-14':['targets','product'],'ec-product-17':['product','targets'],
    'ec-model-02':['product','model'],'ec-model-20':['product','model'],
    'ec-model-21':['product','reference','pose','scene'],
    'ec-pod-04':['targets','product','reference'],'ec-derivative-12':['product','bottom','scene'],
  };
  const uploads:NonNullable<PageControls['inputs']>=[];
  record.sections.forEach((section,index)=>{
    for(const u of section.uploads){
      if(!/上传|图|素材|产品|商品|服装|场景|单品/.test(u.label)||/机位与手势|形象风格|写真主题/.test(u.label))continue;
      if(/场景背景/.test(u.label)&&!/上传|图/.test(u.label))continue;
      const label=clean(u.label).replace(/\s*必填$|\s*非必填$|\s*0\/\d+$|\s*\d+\s*个$/g,'').trim();
      if(uploads.some(item=>item.label===label))continue;
      const role=roleOrder[record.id]?.[uploads.length]|| (uploads.length===0?original:uploads.length===1?'reference':`reference${uploads.length}`);
      const optional=/非必填|选填|可选/.test(u.label+section.title);
      uploads.push({role,label,order:index*100-10,required:!optional,cardinality:role==='targets'?'targets':u.multiple?'group':'single'});
    }
  });
  const unique:ReferenceControl[]=[];
  for(const control of controls){
    const section=record.sections[Math.floor(control.order/100)];
    if(control.type!=='boolean'&&section&&/必填/.test(section.title)&&!/非必填/.test(section.title))control.required=true;
    const existing=unique.find(other=>other.label===control.label);if(!existing)unique.push(control);else if(existing.type==='text'&&control.type==='choice')existing.suggestions=control.choices?.map(c=>c.value);
  }
  result[record.id]={controls:unique,...(requirements?{requirements}:{}),...(uploads.length?{inputs:uploads}:{})};
}
fs.writeFileSync('packages/ecommerce/controls.json',JSON.stringify(result,null,2)+'\n');
console.log(`已生成 ${Object.keys(result).length} 页、${Object.values(result).reduce((n,p)=>n+p.controls.length,0)} 个控件（全部使用本地图片）`);
