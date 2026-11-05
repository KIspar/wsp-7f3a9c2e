import fs from 'node:fs';
const origin='http://127.0.0.1:4310',file='output/research-acceptance/live.json';
const boot=await fetch(origin+'/api/bootstrap').then(r=>r.json());
async function api(path,body){const r=await fetch(origin+'/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Studio-Token':boot.token},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.message);return data;}
let record=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
const save=()=>fs.writeFileSync(file,JSON.stringify(record,null,2));
if(process.argv[2]==='estimate'){
 const p=(await api('/catalog/products/product-9c05979e-6ea4-4216-81ea-0ebfa327a12d')).product,ref=(await api('/catalog/products/product-6c22dc78-e998-404d-98a5-ea7985378115')).product;
 const input={method:'quick',modelMode:'hybrid',productImageIds:p.bindings.filter(b=>b.kind==='main').slice(0,1).map(b=>b.assetId),groups:[{id:'acceptance-garment-reference',imageIds:ref.bindings.filter(b=>b.kind==='main').slice(0,3).map(b=>b.assetId),collectionIds:[]}]};
 const estimate=await api(`/catalog/products/${p.id}/research/estimate`,input);record={...record,productId:p.id,productRevision:p.revision,input,estimate,note:'真实接口验收：自有棉服图＋现有另一款男装商品图作为跨类服饰视觉参考，不属于同款同行销量/评价研究。没有采集评论，也没有生成媒体。'};save();console.log(JSON.stringify({estimate,productId:p.id}));
}else if(process.argv[2]==='start'){
 if(record.jobId){console.log(JSON.stringify({existing:record.jobId}));process.exit(0);}record.key||=crypto.randomUUID();save();const j=await api(`/catalog/products/${record.productId}/research/start`,{input:record.input,productRevision:record.productRevision,maximumCost:record.estimate.estimated,idempotencyKey:record.key});record.jobId=j.id;save();console.log(JSON.stringify({jobId:j.id,status:j.status}));
}else if(process.argv[2]==='status'){
 const id=record.strategyJobId||record.jobId;if(!id)throw Error('尚未提交');const j=await api('/research/'+id);record[record.strategyJobId?'strategyResult':'analysisResult']=j;save();console.log(JSON.stringify({id:j.id,status:j.status,steps:j.steps.map(s=>({label:s.label,done:!!s.output,jobId:s.jobId})),error:j.error,findings:j.result?.findings.length,strategies:j.strategies?.length,billing:j.analysisJobs.map(a=>({id:a.id,model:a.model.id,status:a.status,cost:a.billing.cost,taskId:a.upstreamTaskId,error:a.error}))}));
}else if(process.argv[2]==='strategies'){
 if(record.strategyJobId){console.log(JSON.stringify({existing:record.strategyJobId}));process.exit(0);}const j=await api('/research/'+record.jobId),selectedIds=j.result.findings.filter(f=>f.usable&&['selling','pain','scene'].includes(f.category)).slice(0,5).map(f=>f.id);const q=await api('/research/'+j.id+'/strategy-estimate');record.strategyKey||=crypto.randomUUID();save();const next=await api('/research/'+j.id+'/strategies',{selectedIds,maximumCost:q.estimated*q.calls,idempotencyKey:record.strategyKey});record.strategyJobId=next.id;save();console.log(JSON.stringify({jobId:next.id,maximumCost:q.estimated*q.calls,selectedIds}));
}else throw Error('使用 estimate/start/status/strategies，付费阶段只在明确选择start或strategies时提交。');
