/** Reads current price and balance through the local service. Does not save drafts or generate media. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:4310';
const boot=await fetch(base+'/api/bootstrap').then(r=>r.json());
const before=await fetch(base+'/api/snapshot').then(r=>r.json());
const rows=[];
async function estimate(skillId,change,label){
 const draft=structuredClone(boot.drafts.find(row=>row.skillId===skillId).value);
 change(draft);
 const response=await fetch(base+'/api/generation/estimate',{method:'POST',headers:{'content-type':'application/json','x-studio-token':boot.token},body:JSON.stringify({skillId,draft,action:'generate'})});
 const quote=await response.json();assert.equal(response.status,200,`${skillId}: ${JSON.stringify(quote)}`);
 assert.equal(typeof quote.maximum,'number');assert.ok(quote.items.length>0);assert.equal(/sk-[A-Za-z0-9_-]{12,}/.test(JSON.stringify(quote)),false);
 const row={skillId,label,quote};rows.push(row);console.log(JSON.stringify({skillId,label,minimum:quote.minimum,maximum:quote.maximum,balance:quote.balance,affordable:quote.affordable}));
 return quote;
}
const one=await estimate('image-generate',draft=>{draft.count=1;draft.requirements='';},'1 张，提示词为空');
const three=await estimate('image-generate',draft=>{draft.count=3;},'3 张');
assert.ok(Math.abs(three.maximum-one.maximum*3)<1e-6);
for(const duration of [4,6,10])await estimate('video-generate',draft=>{draft.count=1;draft.duration=duration;},`${duration} 秒，1 项`);
const detail=await estimate('detail-design',draft=>{draft.imageDesign.screens=[{id:'price-only-a',type:'首屏主视觉',requirements:'',facts:''},{id:'price-only-b',type:'使用场景图',requirements:'',facts:''}];draft.imageDesign.groupCount=3;},'2 屏 × 3 组');
assert.ok(Math.abs(detail.maximum-one.maximum*6)<1e-6);
const expensive=await estimate('video-generate',draft=>{draft.count=10;draft.duration=10;},'10 秒 × 10 项，验证余额不足');
assert.equal(expensive.affordable,false);
const afterBoot=await fetch(base+'/api/bootstrap').then(r=>r.json()),after=await fetch(base+'/api/snapshot').then(r=>r.json());
assert.deepEqual(afterBoot.drafts,boot.drafts);assert.deepEqual(after.batches,before.batches);
fs.mkdirSync('docs/reports/pricing-live-20261029',{recursive:true});
fs.writeFileSync('docs/reports/pricing-live-20261029/真实只读报价.json',JSON.stringify({checkedAt:new Date().toISOString(),upstreamMethods:['GET balance','GET model pricing'],localMethod:'POST /api/generation/estimate (read-only)',paidRequests:0,draftsUnchanged:true,batchesUnchanged:true,rows},null,2)+'\n');
