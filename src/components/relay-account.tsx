import {useQuery} from '@tanstack/react-query';
import {ExternalLink,RefreshCw} from 'lucide-react';
import type {RelayState,RelayBalance} from '../../packages/relays';
import {relayPortals} from '../../packages/relays';
import type {AccountBalance} from '../../packages/account';
import {api,dateTime} from '@/lib/api';
import {formatPower,accountQueryOptions} from '@/lib/account';
import {Button} from './ui/button';
import {RelayKeyGuide} from './model-setup';
import {Token01AccountLogin,useToken01Account} from './token01-account';

export function RelayAccount({relay}:{relay:RelayState}){
  const session=useToken01Account(relay.id==='token01');
  const balance=useQuery({queryKey:['account','balance'],queryFn:()=>api<AccountBalance>('/account'),...accountQueryOptions,enabled:relay.id==='chuhe'&&relay.configured});
  const canRead=relay.configured||!!relay.groupCredentialCount||relay.id==='token01'&&session.data?.authenticated===true;
  const tokenBalance=useQuery({queryKey:['account','token01-balance',relay.checkedAt,session.data?.revision],queryFn:()=>api<RelayBalance>('/relays/token01/balance'),...accountQueryOptions,enabled:relay.id==='token01'&&canRead});
  const query=relay.id==='chuhe'?balance:tokenBalance,known=canRead&&query.data,portal=relayPortals[relay.id];
  return <div className="relay-account-summary">
    <div><p className="muted">{relay.name}账户余额</p><p className="relay-account-amount"><strong>{known?formatPower(known.balance):'—'}</strong><span>{known?known.unit:relay.id==='chuhe'?'算力':'余额待查询'}</span></p><p className="muted">{!canRead?relay.id==='token01'?'登录 Token01 账户后同步余额。':'保存密钥后显示本中转站余额。':query.isError?`${known?'更新失败，保留上次结果。':''}${(query.error as Error).message}`:known?`${dateTime(known.fetchedAt)} 更新`:'正在查询余额…'}</p></div>
    <div className="flex flex-wrap items-center gap-2">
      {relay.id==='token01'&&<Token01AccountLogin/>}
      <Button size="sm" variant="outline" disabled={!canRead||query.isFetching} onClick={()=>void query.refetch()}><RefreshCw data-icon="inline-start"/>刷新余额</Button>
      <Button size="sm" variant="outline" asChild><a href={portal.wallet} target="_blank" rel="noreferrer">{relay.id==='token01'?'钱包 / 充值':'账户 / 充值'}<ExternalLink data-icon="inline-end"/></a></Button>
      <RelayKeyGuide relayId={relay.id}/>
      <Button size="sm" variant="ghost" asChild><a href={portal.usage} target="_blank" rel="noreferrer">使用记录<ExternalLink data-icon="inline-end"/></a></Button>
    </div>
  </div>;
}
