import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {ChevronDown,LoaderCircle,RefreshCw} from 'lucide-react';
import {toast} from 'sonner';
import type {RelayId,RelayState,RelayCatalog} from '../../packages/relays';
import {api,dateTime} from '@/lib/api';
import {useStudio} from '@/lib/studio';
import {useAnalysis} from './analysis';
import {Button} from './ui/button';
import {Badge} from './ui/badge';
import {Input} from './ui/input';
import {Field,FieldLabel} from './ui/field';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';
import {Token01GroupCredentials} from './token01-routing';
import {MediaModelSettings} from './media-model-settings';
import {RelayAccount} from './relay-account';
import {Token01AdditionalKeys,useToken01Keys} from './token01-keys';

export function RelayModelSettings(){
  const studio=useStudio(),analysis=useAnalysis(),cache=useQueryClient(),extraKeys=useToken01Keys();
  const [keys,setKeys]=useState<Partial<Record<RelayId,string>>>({}),[busy,setBusy]=useState<Partial<Record<RelayId,boolean>>>({});
  const started=useRef(new Set<RelayId>());
  const query=useQuery({queryKey:['relays'],queryFn:()=>api<RelayState[]>('/relays'),retry:false});
  const chuheCatalog=useQuery({queryKey:['relay-catalog','chuhe',query.data?.find(relay=>relay.id==='chuhe')?.checkedAt],queryFn:()=>api<RelayCatalog>('/relays/chuhe/catalog'),enabled:query.data?.some(relay=>relay.id==='chuhe'&&relay.configured)===true,retry:false});
  const refresh=()=>Promise.all([cache.invalidateQueries({queryKey:['relays']}),cache.invalidateQueries({queryKey:['relay-catalog']}),cache.invalidateQueries({queryKey:['token01-routing']}),cache.invalidateQueries({queryKey:['account']}),cache.invalidateQueries({queryKey:['model-configuration-prices']}),cache.invalidateQueries({queryKey:['model-configuration-key']}),studio.refresh(),analysis.refresh()]);
  async function sync(id:RelayId,save=false,automatic=false){
    setBusy(value=>({...value,[id]:true}));
    try{
      if(save){await api(`/relays/${id}/credential`,{key:keys[id]?.trim()},'PUT');setKeys(value=>({...value,[id]:''}));}
      const relay=await api<RelayState>(`/relays/${id}/sync`,{});
      if(!automatic)toast.success('已同步中转站模型权限');
    }catch(error){if(!automatic)toast.error((error as Error).message);}
    finally{await refresh();setBusy(value=>({...value,[id]:false}));}
  }
  useEffect(()=>{for(const relay of query.data||[]){if(relay.configured&&relay.status==='idle'&&!started.current.has(relay.id)){started.current.add(relay.id);void sync(relay.id,false,true);}}},[query.data]);
  return <>
    {query.isPending&&<p role="status"><LoaderCircle className="spin"/>正在读取中转站配置…</p>}
    {query.error&&<Alert variant="destructive"><AlertTitle>读取中转站失败</AlertTitle><AlertDescription>{(query.error as Error).message}<Button variant="outline" onClick={()=>void query.refetch()}>重新读取</Button></AlertDescription></Alert>}
    <div className="relay-connections">{query.data?.map(relay=><section className="settings-panel relay-connection" key={relay.id}>
      <div className="section-heading"><div><h2>{relay.name}</h2><p className="muted">{relay.id==='token01'?'独立账户 · 人民币计费':'自定义模型与渠道 · 算力计费'}{relay.checkedAt&&` · 同步于 ${dateTime(relay.checkedAt)}`}{!!relay.groupCredentialCount&&` · 已保存 ${relay.groupCredentialCount} 个分组密钥`}</p></div><Badge variant="outline">{busy[relay.id]?'同步中':relay.id==='token01'&&!!extraKeys.data?.length?`${relay.configured?'统一密钥已保存 · ':''}${extraKeys.data.length} 把附加密钥`:relay.id==='chuhe'&&chuheCatalog.data?`${chuheCatalog.data.groupCount} 分组 · ${chuheCatalog.data.models.length} 模型`:relay.status==='ready'?`${relay.modelIds.length} 个已接入模型`:relay.configured?'密钥已保存':relay.groupCredentialCount?'已配置分组密钥':'未配置'}</Badge></div>
      <RelayAccount relay={relay}/>
      <details className="relay-credential-details" open={!relay.configured}><summary>API 密钥与分组<span>{relay.configured?'已配置 · 点击管理':'添加密钥'}</span><ChevronDown aria-hidden="true"/></summary>
      <Field><FieldLabel htmlFor={`relay-key-${relay.id}`}>{relay.name} API 密钥</FieldLabel><div className="relay-credential-actions"><Input id={`relay-key-${relay.id}`} type="password" autoComplete="new-password" value={keys[relay.id]||''} placeholder={relay.configured?'留空保留已保存的中转站密钥':'输入中转站的 sk- 密钥'} onChange={e=>setKeys(value=>({...value,[relay.id]:e.target.value}))}/><Button variant="outline" disabled={busy[relay.id]||!keys[relay.id]?.trim()} onClick={()=>void sync(relay.id,true)}>{busy[relay.id]&&<LoaderCircle className="spin"/>}保存并同步模型</Button><Button variant="outline" disabled={busy[relay.id]||!relay.configured} onClick={()=>void sync(relay.id)}><RefreshCw className={busy[relay.id]?'spin':''}/>同步可用模型</Button></div></Field>
      {relay.id==='token01'&&<><Token01AdditionalKeys/><Token01GroupCredentials/></>}
      </details>
      {relay.error&&<p role="alert" className="error-text">{relay.error}，请检查中转站密钥后重新同步。</p>}
      {relay.status==='ready'&&!relay.modelIds.length&&<p className="muted">当前中转站未返回工作台支持的可用模型。</p>}
      {relay.id==='token01'&&<p className="muted"><a href="https://www.token01.net/pricing" target="_blank" rel="noreferrer">价格与分组</a> · <a href="https://token01.apifox.cn/" target="_blank" rel="noreferrer">接口文档</a></p>}
    </section>)}</div>
    <MediaModelSettings relays={query.data||[]} chuheCatalog={chuheCatalog.data} catalogError={chuheCatalog.error} catalogPending={chuheCatalog.isFetching} onRefreshCatalog={()=>void chuheCatalog.refetch()}/>
  </>;
}
