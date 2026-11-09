export type UpdateProgress={receivedBytes:number;totalBytes:number;bytesPerSecond:number;startedAt:string;updatedAt:string;lastByteAt?:string};
export type UpdateState={phase:string;step?:string;version?:string;error?:string;progress?:UpdateProgress};
export const activeUpdatePhases=['downloading','preparing'];
export function updateStageLabel(state:UpdateState){
  const labels:Record<string,string>={checking:'正在确认更新信息',connecting:'正在连接下载服务器',downloading:'正在下载更新',verifying:'正在校验更新包',extracting:'正在解压更新包',dependencies:'正在准备运行依赖'};
  return labels[state.step||'']||(state.phase==='preparing'?'正在准备更新':'正在下载更新');
}
export function downloadMetrics(progress:UpdateProgress,now=Date.now()){
  const received=Math.max(0,progress.receivedBytes),total=Math.max(0,progress.totalBytes);
  const idleSeconds=Math.max(0,(now-Date.parse(progress.lastByteAt||progress.updatedAt||progress.startedAt))/1000);
  const stale=idleSeconds>=15,speed=stale?0:Math.max(0,progress.bytesPerSecond);
  return {received,total,percent:total?Math.min(100,Math.floor(received/total*100)):undefined,speed,stale,idleSeconds,remainingSeconds:speed>0&&total>received?Math.ceil((total-received)/speed):undefined};
}
export function formatUpdateBytes(bytes:number){return bytes>=1024*1024?`${(bytes/1024/1024).toFixed(1)} MB`:bytes>=1024?`${Math.round(bytes/1024)} KB`:`${Math.round(bytes)} B`;}
export function formatUpdateTime(seconds:number){return seconds>=60?`约 ${Math.ceil(seconds/60)} 分钟`:`约 ${Math.ceil(seconds)} 秒`;}
