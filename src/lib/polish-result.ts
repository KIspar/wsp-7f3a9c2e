// A late result must never replace text edited while the model was running.
export function polishResult(source:string,current:string,result:string|undefined){
  const text=result?.trim()||'';
  if(!text)return {kind:'empty' as const,text};
  if(text.length>16000)return {kind:'too-long' as const,text};
  return {kind:source===current?'apply' as const:'changed' as const,text};
}
