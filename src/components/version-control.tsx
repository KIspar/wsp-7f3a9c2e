import {flushBackgroundSaves} from '@/lib/background-save-registry';
import {flushDraftCache} from '@/lib/background-persistence';
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {ArrowUpRight,Download,LoaderCircle,RefreshCw,RotateCw,TriangleAlert} from 'lucide-react';
import {version} from '../../package.json';
import {api} from '@/lib/api';
import {Modal} from './common';
import {Button} from './ui/button';
import {ConfirmDialog} from './confirm-dialog';
import './version-control.css';
type UpdateStatus={currentVersion:string;managed:boolean;checking:boolean;running:boolean;check?:{available:boolean;latestVersion:string;notes:string;releaseUrl:string;checkedAt:string};state:{phase:string;version?:string;error?:string};preferences:{autoCheck:boolean;autoDownload:boolean}};
export function VersionControl({panel=false}:{panel?:boolean}){
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(''),[confirm,setConfirm]=useState(false),[restarting,setRestarting]=useState(false);
  const query=useQuery({queryKey:['application-updates'],queryFn:()=>api<UpdateStatus>('/updates'),enabled:open||panel,refetchInterval:open||panel?2500:false,retry:false});
  const data=query.data,phase=data?.state.phase,ready=phase==='ready',preparing=data?.running||['downloading','preparing'].includes(phase||'');
  async function check(){setBusy('check');setError('');try{await api('/updates/check',{});await query.refetch();}catch(e){setError((e as Error).message);}finally{setBusy('');}}
  async function download(){setBusy('download');setError('');try{await api('/updates/download',{});await query.refetch();}catch(e){setError((e as Error).message);}finally{setBusy('');}}
  async function install(){setBusy('install');setError('');try{await flushBackgroundSaves();await flushDraftCache();await api('/updates/install',{});setConfirm(false);setRestarting(true);}catch(e){setError((e as Error).message);}finally{setBusy('');}}
  const content=<>
    <div className="update-status"><strong>{restarting?'正在备份并重启':preparing?phase==='preparing'?'正在准备更新':'正在下载更新':ready?'更新已准备就绪':data?.check?.available?'发现新版本':data?.check?'已是最新版本':'尚未检查版本'}</strong>{(preparing||restarting)&&<LoaderCircle className="spin"/>}</div>
    <dl className="update-versions"><dt>当前版本</dt><dd>v{data?.currentVersion||version}</dd><dt>最新版本</dt><dd>{data?.check?`v${data.check.latestVersion}`:'—'}</dd></dl>
    {data?.check?.notes&&<details className="update-notes"><summary>更新内容</summary><p>{data.check.notes}</p></details>}
    {(error||query.error||data?.state.error)&&<p className="update-error" role="alert"><TriangleAlert/>{error||query.error?.message||data?.state.error}</p>}
    {!data?.managed&&data&&<p className="update-hint">开发模式支持检查和下载。使用 npm start 启动后可安装更新。</p>}
    {restarting?<div className="update-actions"><Button onClick={()=>window.location.reload()}><RotateCw/>重新连接工作台</Button></div>:<>
      {data&&<div className="update-preferences"><label><input type="checkbox" checked={data.preferences.autoCheck} onChange={event=>void api('/updates/preferences',{...data.preferences,autoCheck:event.target.checked},'PUT').then(()=>query.refetch()).catch(e=>setError(e.message))}/>自动检查更新</label><label><input type="checkbox" checked={data.preferences.autoDownload} onChange={event=>void api('/updates/preferences',{...data.preferences,autoDownload:event.target.checked},'PUT').then(()=>query.refetch()).catch(e=>setError(e.message))}/>后台下载更新包</label></div>}
      <div className="update-actions"><Button variant="outline" disabled={!!busy||!!preparing} onClick={()=>void check()}>{busy==='check'?<LoaderCircle className="spin"/>:<RefreshCw/>}检查更新</Button>{ready?<Button disabled={!data?.managed||!!busy} onClick={()=>setConfirm(true)}><RotateCw/>安装并重启</Button>:data?.check?.available&&<Button disabled={!!busy||!!preparing} onClick={()=>void download()}><Download/>{preparing?'后台准备中':'下载更新'}</Button>}{data?.check?.releaseUrl&&<Button variant="ghost" asChild><a href={data.check.releaseUrl} target="_blank" rel="noreferrer">GitHub<ArrowUpRight/></a></Button>}</div>
    </>}
  </>;
  return <>{panel?<section className="settings-panel update-panel"><div className="panel-heading"><RefreshCw/><div><h2>版本与更新</h2></div></div>{content}</section>:<><button className="version-entry" onClick={()=>setOpen(true)}><RefreshCw/><span>版本</span><small>v{version}</small></button><Modal title="版本检查" open={open} onClose={()=>!busy&&setOpen(false)}>{content}</Modal></>}
    <ConfirmDialog open={confirm} title="安装更新并重启？" description="本地程序和数据将先备份。后台任务完成后才能安装，启动失败会自动恢复旧版本。" confirmLabel="备份并更新" onClose={()=>setConfirm(false)} onConfirm={()=>void install()}/>
  </>;
}
