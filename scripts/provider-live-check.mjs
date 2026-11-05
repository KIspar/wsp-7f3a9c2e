/** Read-only acceptance against the local API using already saved encrypted credentials. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:4310',before=await(await fetch(base+'/api/analysis/jobs')).json(),rows=[];
for(const credentialId of ['tt-6.1-sol','gem-3.8-flash']){
 for(const [endpoint,args]of [['balance',{}],['key',{}],['usage',{days:7,scope:'key',detail:0}],['usage',{days:7,scope:'user',detail:1,limit:2}],['task',{taskId:'193571161'}],['models',{type:'chat'}],['model',{model:credentialId}],['pricing',{model:credentialId}]]){
  const response=await fetch(base+'/api/provider/'+endpoint+'?'+new URLSearchParams({credentialId,...args}));const body=await response.json();assert.equal(response.status,200,`${credentialId} ${endpoint}: ${JSON.stringify(body)}`);assert.equal(body.credentialId,credentialId);assert.ok(body.fetchedAt);assert.equal(/sk-[A-Za-z0-9_-]{12,}/.test(JSON.stringify(body)),false);
  const data=body.data;let checked;
  if(endpoint==='balance'){assert.equal(typeof data.balance,'number');checked={balanceReturned:true,unit:data.unit,unlimitedKeyQuota:data.api_key_quota.limit===0};}
  if(endpoint==='key'){assert.equal('api_key'in data,false);checked={readOnly:true,keyMaterialOmitted:true};}
  if(endpoint==='usage')checked={scope:data.scope,mode:args.detail===1?'records':'summary',recordCount:data.records?.length,modelCount:data.by_model?.length};
  if(endpoint==='task'){assert.equal(data.is_final,true);checked={taskId:data.task_id,state:data.state,isFinal:data.is_final,hasReply:!!data.ai_reply,hasTokenUsage:data.input_tokens!==undefined&&data.output_tokens!==undefined};}
  if(endpoint==='models')checked={total:data.total,returned:data.models.length,includesEligibility:data.models.every(m=>typeof m.available_for_this_key==='boolean')};
  if(endpoint==='model')checked={name:data.name,parameterCount:data.params?.length,hasApiFormat:!!data.api_format};
  if(endpoint==='pricing')checked={channelGroups:data.channel_groups.length,active:data.channel_groups.filter(g=>g.is_active).length,paused:data.channel_groups.filter(g=>!g.is_active).length,tokenRateGroups:data.channel_groups.filter(g=>g.input_token_price!==undefined).length};
  const row={credentialId,endpoint,status:response.status,checked};rows.push(row);console.log(JSON.stringify(row));
 }
}
const after=await(await fetch(base+'/api/analysis/jobs')).json();assert.equal(after.length,before.length);assert.deepEqual(after.map(j=>j.id).sort(),before.map(j=>j.id).sort());
const report={checkedAt:new Date().toISOString(),method:'GET',base,totalQueries:rows.length,analysisJobCountBefore:before.length,analysisJobCountAfter:after.length,paidRequests:0,rows};fs.writeFileSync('docs/reports/provider-live-20261028/只读接口验收.json',JSON.stringify(report,null,2)+'\n');
