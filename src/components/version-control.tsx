import {flushBackgroundSaves} from '@/lib/background-save-registry';
import {flushDraftCache} from '@/lib/background-persistence';
import {useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {ArrowUpRight,Download,LoaderCircle,RefreshCw,RotateCw,TriangleAlert} from 'lucide-react';
import {version} from '../../package.json';
import {api} from '@/lib/api';
import {Modal} from './common';
import {Button} from './ui/button';
import {ConfirmDialog} from './confirm-dialog';
import {activeUpdatePhases,downloadMetrics,formatUpdateBytes,formatUpdateTime,updateStageLabel,type UpdateState} from '../../packages/update-progress';
import './version-control.css';
type UpdateStatus={currentVersion:string;managed:boolean;checking:boolean;running:boolean;check?:{available:boolean;latestVersion:string;notes:string;releaseUrl:string;checkedAt:string};state:UpdateState;preferences:{autoCheck:boolean;autoDownload:boolean}};
export function VersionControl({panel=false}:{panel?:boolean}){
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(''),[confirm,setConfirm]=useState(false),[restarting,setRestarting]=useState(false);
  const query=useQuery({queryKey:['application-updates'],queryFn:()=>api<UpdateStatus>('/updates'),enabled:open||panel,refetchInterval:open||panel?1000:false,retry:false});
  const data=query.data,phase=data?.state.phase,ready=phase==='ready',preparing=data?.running||activeUpdatePhases.includes(phase||'');
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{if(!(open||panel)||!preparing)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[open,panel,preparing]);
  const metrics=data?.state.progress?downloadMetrics(data.state.progress,Math.max(now,Date.now())):undefined;
  async function check(){setBusy('check');setError('');try{await api('/updates/check',{});await query.refetch();}catch(e){setError((e as Error).message);}finally{setBusy('');}}
  async function download(){setBusy('download');setError('');try{await api('/updates/download',{});await query.refetch();}catch(e){setError((e as Error).message);}finally{setBusy('');}}
  async function install(){setBusy('install');setError('');try{await flushBackgroundSaves();await flushDraftCache();await api('/updates/install',{});setConfirm(false);setRestarting(true);}catch(e){setError((e as Error).message);}finally{setBusy('');}}
  const content=<>
    <div className="update-status" role="status"><strong>{restarting?'正在备份并重启':phase==='error'?'更新准备失败':preparing?updateStageLabel(data?.state||{phase:'downloading',step:'checking'}):ready?'更新已准备就绪':data?.check?.available?'发现新版本':data?.check?'已是最新版本':'尚未检查版本'}</strong>{(preparing||restarting)&&<LoaderCircle className="spin"/>}</div>
    {preparing&&<div className="update-transfer">
      {phase==='downloading'&&metrics?<><div className="update-transfer-heading"><span>{formatUpdateBytes(metrics.received)} / {formatUpdateBytes(metrics.total)}</span><strong>{metrics.percent??0}%</strong></div><div className="update-progress-track" role="progressbar" aria-label="更新包下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={metrics.percent} aria-valuetext={`${metrics.percent??0}%，已下载 ${formatUpdateBytes(metrics.received)}`}><span style={{transform:`scaleX(${(metrics.percent||0)/100})`}}/></div><div className="update-transfer-detail"><span>{metrics.stale?'等待网络响应':metrics.speed?`${formatUpdateBytes(metrics.speed)}/s`:'正在建立连接…'}</span><span>{metrics.remainingSeconds?`剩余${formatUpdateTime(metrics.remainingSeconds)}`:metrics.stale?`${Math.floor(metrics.idleSeconds)} 秒未收到数据`:''}</span></div>{metrics.stale&&<p className="update-network-hint">下载暂时没有收到新数据，系统仍在等待；连续 60 秒无响应会结束并提示重试。</p>}</>:<p className="update-stage-detail">{phase==='preparing'?'更新包已下载完成，正在后台处理。此阶段不计入下载百分比。':'正在获取下载地址，收到数据后将显示进度。'}</p>}
      <p className="update-background-hint">可关闭此窗口继续使用，后台处理不会停止。</p>
    </div>}
    <dl className="update-versions"><dt>当前版本</dt><dd>v{data?.currentVersion||version}</dd><dt>最新版本</dt><dd>{data?.check?`v${data.check.latestVersion}`:'—'}</dd></dl>
    {data?.check?.notes&&<details className="update-notes"><summary>更新内容</summary><p>{data.check.notes}</p></details>}
    {(error||query.error||data?.state.error)&&<p className="update-error" role="alert"><TriangleAlert/>{error||query.error?.message||data?.state.error}</p>}
    {!data?.managed&&data&&<p className="update-hint">开发模式支持检查和下载。使用 npm start 启动后可安装更新。</p>}
    {restarting?<div className="update-actions"><Button onClick={()=>window.location.reload()}><RotateCw/>重新连接工作台</Button></div>:<>
      {data&&<div className="update-preferences"><label><input type="checkbox" checked={data.preferences.autoCheck} onChange={event=>void api('/updates/preferences',{...data.preferences,autoCheck:event.target.checked},'PUT').then(()=>query.refetch()).catch(e=>setError(e.message))}/>自动检查更新</label><label><input type="checkbox" checked={data.preferences.autoDownload} onChange={event=>void api('/updates/preferences',{...data.preferences,autoDownload:event.target.checked},'PUT').then(()=>query.refetch()).catch(e=>setError(e.message))}/>后台下载更新包</label></div>}
      <div className="update-actions"><Button variant="outline" disabled={!!busy||!!preparing} onClick={()=>void check()}>{busy==='check'?<LoaderCircle className="spin"/>:<RefreshCw/>}检查更新</Button>{ready?<Button disabled={!data?.managed||!!busy} onClick={()=>setConfirm(true)}><RotateCw/>安装并重启</Button>:data?.check?.available&&<Button disabled={!!busy||!!preparing} onClick={()=>void download()}><Download/>{preparing?phase==='preparing'?'正在准备':'正在下载':phase==='error'?'重新下载':'下载更新'}</Button>}{data?.check?.releaseUrl&&<Button variant="ghost" asChild><a href={data.check.releaseUrl} target="_blank" rel="noreferrer">GitHub<ArrowUpRight/></a></Button>}</div>
    </>}
  </>;
  return <>{panel?<section className="settings-panel update-panel"><div className="panel-heading"><RefreshCw/><div><h2>版本与更新</h2></div></div>{content}</section>:<><button className="version-entry" onClick={()=>setOpen(true)}><RefreshCw/><span>版本</span><small>v{version}</small></button><Modal title="版本检查" open={open} onClose={()=>!busy&&setOpen(false)}>{content}</Modal></>}
    <ConfirmDialog open={confirm} title="安装更新并重启？" description="本地程序和数据将先备份。后台任务完成后才能安装，启动失败会自动恢复旧版本。" confirmLabel="备份并更新" onClose={()=>setConfirm(false)} onConfirm={()=>void install()}/>
  </>;
}
