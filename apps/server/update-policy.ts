/** Read persisted task rows across every workspace before stopping the local process. */
export const updateTaskKinds=['attempt','analysis-job','video-remake','workbench-run','product-research','research-collection','research-quote','catalog-product'];
const active=new Set(['queued','generating','saving','waiting_dependency','pending_verification','running','preparing','submitting','unknown','conflict','extracting','composing','collecting','waiting-login','executing']);
export function blocksUpdate(kind:string,value:{status?:string;collectionStatus?:string}){
  if(kind==='catalog-product')return ['queued','collecting'].includes(value.collectionStatus||'');
  return updateTaskKinds.includes(kind)&&active.has(value.status||'');
}
export function newerUpdate(latest:string,current:string){
  const a=latest.split('.').map(Number),b=current.split('.').map(Number);
  for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i];return false;
}
