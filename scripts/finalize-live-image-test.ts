import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { createStore } from '../apps/server/store';
import { exportLayout } from '../apps/server/layout';
import type { Asset, Attempt, Batch } from '../packages/contracts';
const dir=path.resolve(process.argv[2] || 'docs/reports/henley-live-20261028');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
const complete=manifest.jobs.filter((j:any)=>j.state==='completed');
if(complete.length!==7)throw new Error('Expected seven successful results before completing this report');
const sourceHashes=new Set(fs.readdirSync(path.join(dir,'inputs')).map(file=>createHash('sha256').update(fs.readFileSync(path.join(dir,'inputs',file))).digest('hex')));
if(complete.some((j:any)=>sourceHashes.has(j.sha256)))throw new Error('A generated output is byte-identical to an input');
const store=createStore(path.join(dir,'run-data'),process.cwd());
try{
 const saved=JSON.parse(fs.readFileSync(path.join(dir,'03-detail-plan.json'),'utf8'));
 const now=new Date().toISOString(),batchId='real-detail-test-20261028';
 const attempts:Attempt[]=complete.filter((j:any)=>j.name.startsWith('03-detail')).map((job:any,index:number)=>{
  const id=`real-detail-${index+1}`,assetId=`real-result-${index+1}`,filename=assetId+'.png';
  fs.copyFileSync(path.join(dir,job.output),path.join(store.dataDir,'media',filename));
  // Import confirmed provider files into the isolated export test store only.
  store.put('asset',assetId,{id:assetId,url:`/media/${filename}`,type:'image',mime:'image/png',bytes:job.bytes,source:'upload',createdAt:now} satisfies Asset);
  const item=saved.plan.items[index];
  const attempt:Attempt={id,batchId,itemId:id,index:index+1,variant:1,attemptNumber:1,status:'completed',step:'真实接口实测成功',revision:1,prompt:job.prompt,references:job.references,model:item.model,parameters:item.parameters,groupIndex:1,screenId:item.screenId,screenType:item.screenType,screenOrder:item.screenOrder,assetId,createdAt:job.submittedAt,updatedAt:job.completedAt,points:null,simulated:false};
  store.put('attempt',id,attempt);return attempt;
 });
 store.put('batch',batchId,{id:batchId,skillId:'detail-design',skillName:'详情图设计',skillRevision:saved.plan.skillRevision,action:'generate',createdAt:now,draft:saved.draft,attempts:[],simulated:false} satisfies Batch);
 const exported=await exportLayout(store,batchId,1,{attemptIds:attempts.map(a=>a.id),width:864,gap:0,background:'white',format:'png'});
 const doc=store.get<{filename:string}>('export',exported.url.split('/')[3])!;
 fs.copyFileSync(path.join(store.dataDir,'exports',doc.filename),path.join(dir,'outputs','03-detail-long.png'));
 manifest.longImage={output:'outputs/03-detail-long.png',width:exported.width,height:exported.height,method:'Shared exportLayout on imported real provider files; exact selected attempts in isolated test store'};
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2));
}finally{store.close();}
const labels=['01 · 通用操作','02 · 爆款复刻','03 · 详情首屏','04 · 核心卖点','05 · 商品细节','06 · 图像编辑','07 · 模特换装'];
const composites=[];
for(let i=0;i<complete.length;i++){
 const job=complete[i];const x=(i%4)*360,y=Math.floor(i/4)*536;
 composites.push({input:Buffer.from(`<svg width="360" height="56"><rect width="360" height="56" fill="#f3f1ec"/><text x="18" y="34" font-family="sans-serif" font-size="20" fill="#2e251e">${labels[i]}</text></svg>`),left:x,top:y});
 composites.push({input:await sharp(path.join(dir,job.output)).resize(360,480,{fit:'contain',background:'#f3f1ec'}).png().toBuffer(),left:x,top:y+56});
}
// The final slot shows the unmodified product detail for a side-by-side product check.
composites.push({input:Buffer.from('<svg width="360" height="56"><rect width="360" height="56" fill="#f3f1ec"/><text x="18" y="34" font-family="sans-serif" font-size="20" fill="#2e251e">08 · 原产品细节参照</text></svg>'),left:1080,top:536});
composites.push({input:await sharp(path.join(dir,'inputs','product-3.jpg')).resize(360,480,{fit:'contain',background:'#f3f1ec'}).png().toBuffer(),left:1080,top:592});
await sharp({create:{width:1440,height:1072,channels:3,background:'#f3f1ec'}}).composite(composites).png().toFile(path.join(dir,'overview.png'));
const total=complete.reduce((n:number,j:any)=>n+(j.cost||0),0).toFixed(4);
const rows=complete.map((j:any)=>`| ${j.name} | ${j.upstreamId} | success / final | ${j.width}×${j.height} | ${j.cost??'未知'} |`).join('\n');
const report=`# 亨利领产品：五项图片功能真实接口实测\n\n日期：2026-10-28。产品：${manifest.productName}。\n\n五项功能共 7 张，均通过真实 TT Image 2.5 接口完成。供应商返回最终成功、文件下载成功，解码后均为 864×1152；输出 SHA-256 均与七张处理后的输入图不同。本轮不使用复制素材的模拟器生成输出。\n\n## 调用范围与证据\n\n真实请求由当前技能的 compilePlan 生成提示词、角色、数量与参数，再由独立实测脚本调用 ${manifest.provider}/v1/media/generate，并查询 /v1/media/status。当前网页默认 Worker 仍为模拟，本轮没有把它标为已接入真实生成，也未覆盖日常工作台草稿。独立测试数据保存在 run-data；原 TikTok 数据库只读读取模型连接与凭据，没有迁移旧任务、修改旧系统或写出密钥。\n\n用户提供前四张为同行，后三张为产品。同行图裁去状态栏、播放器与留白；产品图裁去白边。没有改写商品纹理与款式。同行第 4 张用于平铺复刻，第 3 张用于双栏模特换装；同行第 1/2 张作为备选保留，本轮未付费生成其变体。所有任务使用同款三张产品参考；请求为 3:4、1K、单图输出，详情展开为一组三屏。\n\n| 用例 | 上游任务 ID | 最终状态 | 实际尺寸 | 接口 cost |\n| --- | --- | --- | --- | --- |\n${rows}\n\n接口 cost 合计 **${total}**。只累加最终成功返回的字段；接口未声明币种，不自行等同人民币或本地参考点数，最终金额以供应商账单为准。本轮没有重试付费请求。\n\n## 视觉验收\n\n| 功能 | 结论 | 可见结果与问题 |\n| --- | --- | --- |\n| 通用操作 | 基本通过 | 成年男性上身图，咖棕色、三扣亨利领与麦穗纹可见；人物重新生成，符合本项要求。纹理强弱与原图存在差异，不能当作面料精确扫描。 |\n| 爆款复刻 | 基本通过 | 复用同行暖色地毯、耳机、裤装与鞋的平铺关系，白夹克变为本品；领口无拉链，未保留同行夹克标识。铺法与配饰位置重新组织，非像素级一致。 |\n| 详情图设计 | 基本通过 | 主视觉、核心卖点、领口细节三屏齐全；咖棕米白配色一致，短中文标题可读，三粒扣结构基本保留。细节屏仍有生成式重绘，中文与纹理需上架前逐张复核。未验证尺码/成分等精确参数屏，也未调用 AI 编写卖点。 |\n| 图像编辑 | 部分通过 | 走廊变为米灰摄影棚，眼镜、发型与张开双手姿态基本保留；但表情由微张口变为明显微笑，不满足严格只改背景；人物脸部、光线与衣物也有重绘，不算无损局部编辑。 |\n| 模特换装 | 基本通过 | 双栏男模黑色拉链上衣均替换为咖棕三扣亨利领，双栏构图与阔腿裤基本保留；人物五官、姿态与配饰存在细微变化，不能承诺身份像素一致。 |\n\n结论基于人工可见图检查；没有采用身份识别或纹理相似度模型，也不将 API 成功等同上架质量通过。产品标题中的 2026 春季、大码等来自用户，未从图片虚构尺码、成分、克重和功能。\n\n## 详情长图与交付\n\n共享 exportLayout 使用真实三屏，按主视觉 → 核心卖点 → 商品细节等宽无间距拼接，导出 864×3456 PNG；它是本地图片处理，不产生额外模型请求。\n\n- [实测总览](overview.png)\n- [详情长图](outputs/03-detail-long.png)\n- [请求、状态、任务号、成本与文件哈希](manifest.json)\n- 每项 *-plan.json 保存当时的技能计划与素材角色；不含图片 base64 或接口凭据。\n\n![五项功能实测总览](overview.png)\n\n## 后续改进\n\n1. 背景编辑采用蒙版/主体锁定流程或更强局部编辑协议；当前普通多图提示词不足以保证表情和脸部不变化。\n2. 详情图若要求精确文字与尺码参数，应由结构化排版输出，不能只依赖模型直接生成。\n3. 把真实适配器接入网页前，仍需补齐任务提交未知、重启查询、下载重试、凭据配置、真实/模拟标识与账本隔离。此脚本保留上游任务号并拒绝自动重提未知/失败请求，但不替代完整生产 Worker。\n`;
fs.writeFileSync(path.join(dir,'实测报告.md'),report);
console.log(JSON.stringify({completed:complete.length,cost:total,longImage:manifest.longImage,report:path.join(dir,'实测报告.md')}));
