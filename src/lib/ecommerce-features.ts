export type EcommerceFeature = {
  id: string;
  name: string;
  group: string;
  groupId: string;
  mode: 'generate' | 'edit' | 'text' | 'local';
};

const groups = [
  {id:'product',name:'商品图',features:[
    '商品套图','电商详情页','商品主图','主图拼图','商品直通车图','爆款图复刻','详情图复刻','商品 SKU 图','修改封面',
    '实拍转平铺','百变服饰图','平铺转 3D','面料上身','材质增强','一键去皱','面料质感还原',
    '产品替换','种草网感复刻','一键种草图','商品图合成','商品换背景','一键代言图','一键卖点图',
    '商品多视角图','三视图','商品细节图','一键细节图','商品精修 Pro','商品光影棚','AI 换布光','商品系列一致化',
  ]},
  {id:'model',name:'模特图',features:[
    '万物上身','专属模特套拍','AI 智能搭配','模特图生图','搭配融图','AI 试戴','手持商品','平铺/人台试衣','真人图试衣','鞋靴试穿',
    'AI 换模特','模特塑形','模特换姿势','模特多种换','相机镜头','AI 换脸','模拍换景','服饰换色','模特去 AI 感',
    '服饰商拍套图','套图裂变','AI 配景','服饰种草图','专属模特定妆照',
  ]},
  {id:'pod',name:'图片 POD',features:[
    '图案裁剪','印花提取','满印提取','素材粘合','四方连续图','AI 印花设计','产品皮肤设计','履约制图',
    '图裂变','风格转绘','局部替换','印花效果图','智能抠图','商品主图','定向替换图','商品尺寸图','场景图','POD 标题提取','印花侵权检测',
  ]},
  {id:'tools',name:'图片工具',features:[
    'AI 万能改图','产品分解图','设计 Logo','图片翻译','商品白底图','证件照制作','AI 职业形象照','AI 艺术写真照','商品堆品图','投前检测',
    'AI 抠图','无痕改字','通用多图融合','通用风格转换','线稿提取与上色','智能版式适配','消除笔','图片超清','AI 扩图','AI 消除','手脚修复','服饰修复','鞋靴修复',
    '无损改尺寸','在线拼图','图片切图','图片批量压缩','图片批量修改尺寸','批量图片格式转换','商品图片标注','主图诊断与优选',
  ]},
  {id:'derivative',name:'爆款衍生',features:[
    '款式创新','款式融合','灵感改款','面料替换','颜色替换','套系衍生','季节转款','局部改款','工艺线稿','线稿变实物','同款换拍','搭配矩阵图',
  ]},
  {id:'crossborder',name:'跨境上架',features:[
    '跨境 Listing 生成','平台套图','Listing 本地化','多语言多尺寸','A+ 与品牌故事','Listing 合规检测','SKU 批量上架包',
  ]},
  {id:'marketing',name:'营销场景',features:[
    '营销图','智能设计','高转化主图','节日海报','横版 Banner','促销弹窗','直播背景图','社媒种草图','营销海报复刻','营销创意裂变','大促整套物料','博主大字封面','图文封面生成','纯图加文案',
  ]},
  {id:'design',name:'平面设计',features:['自由海报','传单折页','信息图','封面设计','设计长图']},
] as const;

const textFeatures = new Set(['跨境 Listing 生成','Listing 本地化','Listing 合规检测','A+ 与品牌故事','SKU 批量上架包','POD 标题提取','印花侵权检测','主图诊断与优选','投前检测']);
const localFeatures = new Set(['图案裁剪','无损改尺寸','在线拼图','图片切图','图片批量压缩','图片批量修改尺寸','批量图片格式转换','商品图片标注']);
const editFeatures = new Set(['修改封面','实拍转平铺','材质增强','一键去皱','面料质感还原','产品替换','商品换背景','商品图合成','搭配融图','AI 试戴','平铺/人台试衣','真人图试衣','鞋靴试穿','AI 换模特','模特塑形','模特换姿势','AI 换脸','模拍换景','服饰换色','模特去 AI 感','印花提取','满印提取','素材粘合','风格转绘','局部替换','智能抠图','定向替换图','AI 万能改图','图片翻译','商品白底图','AI 抠图','无痕改字','通用多图融合','通用风格转换','线稿提取与上色','智能版式适配','消除笔','图片超清','AI 扩图','AI 消除','手脚修复','服饰修复','鞋靴修复','面料替换','颜色替换','季节转款','局部改款','线稿变实物','同款换拍','多语言多尺寸','纯图加文案']);

export const ecommerceGroups = groups.map(group => ({
  id: group.id, name: group.name,
  features: group.features.map((name,index):EcommerceFeature => ({
    id: `ec-${group.id}-${String(index+1).padStart(2,'0')}`, name, group: group.name, groupId:group.id,
    mode: textFeatures.has(name) ? 'text' : localFeatures.has(name) ? 'local' : editFeatures.has(name) ? 'edit' : 'generate',
  })),
}));
export const ecommerceFeatures = ecommerceGroups.flatMap(group => group.features);
export const ecommerceFeatureById = new Map(ecommerceFeatures.map(feature => [feature.id,feature]));
