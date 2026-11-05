/** Original feature-specific diagrams, without third-party artwork. */
import fs from 'node:fs';
import path from 'node:path';
import {ecommerceFeatures,type EcommerceFeature} from '../src/lib/ecommerce-features';

const output=path.resolve('public/ecommerce-art');
fs.mkdirSync(output,{recursive:true});
const escapeXml=(text:string)=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const palette:Record<string,[string,string]>={
  product:['#eef2ff','#4f46e5'],model:['#fff1f2','#e11d48'],pod:['#ecfdf5','#059669'],
  tools:['#eff6ff','#0284c7'],derivative:['#fff7ed','#ea580c'],crossborder:['#f0fdfa','#0d9488'],
  marketing:['#fef2f2','#dc2626'],design:['#faf5ff','#9333ea'],
};
function element(tag:string,attributes:Record<string,string|number>,children=''){
  const attrs=Object.entries(attributes).map(([key,value])=>key+'="'+escapeXml(String(value))+'"').join(' ');
  return '<'+tag+' '+attrs+'>'+children+'</'+tag+'>';
}
const rect=(x:number,y:number,w:number,h:number,fill:string,r=6,stroke='none')=>element('rect',{x,y,width:w,height:h,rx:r,fill,stroke});
const text=(x:number,y:number,value:string,fill:string,size=12,weight=500)=>element('text',{x,y,fill,'font-size':size,'font-weight':weight,'font-family':'sans-serif'},escapeXml(value));
function pictogram(group:string,x:number,y:number,color:string,index:number){
  const fade=color+'22';
  if(group==='model')return element('circle',{cx:x+57,cy:y+27,r:17,fill:color})+element('path',{d:'M'+(x+41)+' '+(y+49)+' Q'+(x+21)+' '+(y+57)+' '+(x+29)+' '+(y+117)+' L'+(x+85)+' '+(y+117)+' Q'+(x+93)+' '+(y+57)+' '+(x+73)+' '+(y+49)+'Z',fill:color});
  if(group==='pod'||group==='derivative')return element('path',{d:'M'+(x+40)+' '+(y+19)+' L'+(x+20)+' '+(y+28)+' L'+(x+7)+' '+(y+53)+' L'+(x+33)+' '+(y+65)+' L'+(x+33)+' '+(y+124)+' L'+(x+101)+' '+(y+124)+' L'+(x+101)+' '+(y+65)+' L'+(x+127)+' '+(y+53)+' L'+(x+114)+' '+(y+28)+' L'+(x+94)+' '+(y+19)+' Q'+(x+67)+' '+(y+45)+' '+(x+40)+' '+(y+19)+'Z',fill:fade,stroke:color,'stroke-width':3})+element('circle',{cx:x+67,cy:y+79,r:13+index%5,fill:color,opacity:.65});
  if(group==='marketing'||group==='design')return rect(x+11,y+11,115,116,'#fff',6,color)+rect(x+23,y+28,65,7,color,3)+rect(x+23,y+43,40+index%23,5,fade,2)+element('circle',{cx:x+91,cy:y+88,r:22,fill:color,opacity:.4})+rect(x+23,y+106,51,5,fade,2);
  if(group==='crossborder')return rect(x+17,y+7,103,122,'#fff',6,color)+rect(x+29,y+19,79,66,fade,4)+rect(x+52,y+37,33,42,color,5)+rect(x+29,y+94,69,6,color,3)+rect(x+29,y+108,45,5,fade,2);
  if(group==='tools')return rect(x+12,y+18,110,93,'#fff',6,color)+element('circle',{cx:x+89,cy:y+45,r:11,fill:color,opacity:.6})+element('path',{d:'M'+(x+19)+' '+(y+100)+' L'+(x+49)+' '+(y+64)+' L'+(x+71)+' '+(y+91)+' L'+(x+89)+' '+(y+74)+' L'+(x+115)+' '+(y+100)+'Z',fill:color,opacity:.5});
  return rect(x+25,y+14,85,111,fade,7,color)+rect(x+39,y+37,57,5,color,3)+rect(x+39,y+51,40,5,color,3)+element('circle',{cx:x+67,cy:y+94,r:19,fill:color,opacity:.5});
}
function action(name:string){
  if(/拼图|矩阵|切图|版式|套图/.test(name))return '多画面编排';
  if(/换|替换|改|复刻|转绘/.test(name))return '定向变换';
  if(/修|增强|超清|质感|去皱/.test(name))return '细节优化';
  if(/标题|Listing|检测|诊断/.test(name))return '内容分析';
  if(/背景|场景|配景|光影/.test(name))return '场景呈现';
  if(/裁剪|压缩|格式|尺寸/.test(name))return '本地处理';
  return '创意输出';
}
function diagram(feature:EcommerceFeature,index:number){
  const [tint,color]=palette[feature.groupId];
  const first=feature.mode==='text'?'商品资料':feature.mode==='local'?'导入图片':'上传素材';
  const last=feature.mode==='text'?'分析结果':feature.mode==='local'?'处理结果':'生成画面';
  const stacked=/套图|拼图|多视角|三视图|系列|批量|矩阵|详情/.test(feature.name);
  const items=[rect(0,0,780,220,tint,0),text(24,28,feature.group+' / 流程示意',color,12,700),
    rect(161,29,169,145,'#fff',10,color+'55'),pictogram(feature.groupId,176,30,'#94a3b8',index),text(217,165,first,'#64748b',10),
    element('path',{d:'M353 104 H444 m-11 -10 11 10 -11 10',fill:'none',stroke:color,'stroke-width':4,'stroke-linecap':'round','stroke-linejoin':'round'}),
    rect(364,67,70,22,'#fff',11),text(372,82,action(feature.name),color,10),
    stacked?rect(585,38,152,137,'#fff',9,color+'33'):'',
    rect(567,29,169,145,'#fff',10,color+'99'),pictogram(feature.groupId,582,30,color,index),text(625,165,last,color,10,700),
    element('path',{d:'M0 185 H780',stroke:color,'stroke-opacity':.12}),
    text(25,204,first+'  /  '+feature.name+'  /  '+last,'#475569',11),text(348,178,feature.name,'#334155',13,700)];
  return element('svg',{xmlns:'http://www.w3.org/2000/svg',width:780,height:220,viewBox:'0 0 780 220',role:'img','aria-label':feature.name+'流程示意'},items.join(''));
}
for(const [index,feature] of ecommerceFeatures.entries())fs.writeFileSync(path.join(output,feature.id+'.svg'),diagram(feature,index));
console.log('Generated '+ecommerceFeatures.length+' original feature illustrations');
