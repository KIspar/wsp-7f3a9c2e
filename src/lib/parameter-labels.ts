/** Presentation only: API values, saved drafts, pricing keys and historical snapshots remain unchanged. */
const names:Record<string,string>={
  prompt:'提示词',images:'参考图片',videos:'参考视频',audio:'参考音频',files:'参考文件',
  version:'模型版本',quality:'质量档位',background:'背景模式',resolution:'输出分辨率',referenceMode:'图片用途',
  aspect_ratio:'画面比例',aspectRatio:'画面比例',duration:'视频时长',size:'自定义尺寸',
  enhance_prompt:'提示词增强',enable_upsample:'超分处理',seed:'随机种子',n:'生成数量',count:'生成数量',
  max_tokens:'最大输出长度',max_output_tokens:'最大输出长度',temperature:'随机程度',top_p:'采样范围',
  thinking_level:'思考程度',thinking_budget:'思考预算',reasoning_effort:'思考程度',
  response_format:'输出格式',output_format:'文件格式',format:'文件格式',negative_prompt:'排除内容',
  language:'成品语言',variation:'多图差异',productName:'产品名',sellingPoints:'商品卖点与参数',
  platform:'平台',whiteMode:'商品参考来源',targetDescription:'替换对象',sourceUrl:'商品来源链接',
  scope:'换装范围',replacementMode:'换装范围',newCopy:'新宣传文案',text:'宣传文案',fps:'每秒帧数',width:'宽度',height:'高度',strength:'调整强度',
};
const options:Record<string,string>={
  auto:'自动',low:'低',medium:'中',high:'高',xhigh:'超高',max:'极致',reference:'参考图（无图时文生视频）','first-frame':'首帧（1 张图）','first-last-frame':'首尾帧（按顺序 2 张图）',
  opaque:'不透明背景',transparent:'透明背景',true:'开启',false:'关闭',none:'无',
  standard:'标准',enhanced:'增强',fast:'快速',balanced:'均衡',custom:'自定义',
  text:'文本',select:'下拉选择',number:'数字',boolean:'开关',switch:'开关',radio:'单项选择',
  input:'单行输入',textarea:'多行输入',upload:'素材上传',string:'文本',integer:'整数',array:'列表',object:'结构化数据',
};
export function parameterLabel(name:string,label?:string):string{
  return label&&/[\u3400-\u9fff]/.test(label)?label:names[name]||label||name;
}
export function parameterValueLabel(name:string,value:unknown,label?:string):string{
  if(label&&/[\u3400-\u9fff]/.test(label))return label;
  const raw=String(value??'');
  // Use the supplier's published Chinese version names, without inventing capability claims.
  if(name==='version'&&raw==='flare')return '标准版';
  if(name==='version'&&raw==='sunburst')return '增强版';
  if(name==='duration'&&/^\d+(\.\d+)?$/.test(raw))return `${raw} 秒`;
  return options[raw]||label||raw;
}
export function parameterOptions(name:string,values:string[]){
  return values.map(value=>({value,label:parameterValueLabel(name,value)}));
}
