import {Link} from 'react-router-dom';
import {Wallet} from 'lucide-react';
import {useAccountBalance,formatPower} from '@/lib/account';
import {Tooltip,TooltipTrigger,TooltipContent} from './ui/tooltip';

export function AccountBalance(){
  const query=useAccountBalance(),data=query.data;
  const time=data?new Date(data.fetchedAt).toLocaleTimeString('zh-CN',{hour12:false}):'';
  return <div className="account-balance" data-state={query.isError?'error':data&&data.balance<=0?'empty':'ready'}>
    <Tooltip><TooltipTrigger asChild><Link to="/usage" aria-label={`账户算力余额 ${data?formatPower(data.balance):'查询中'}${query.isError?'，更新失败':''}`}><Wallet/><span>初和中转站余额</span><strong>{data?formatPower(data.balance):'—'}</strong><span>算力</span>{query.isError&&<small>更新失败</small>}</Link></TooltipTrigger><TooltipContent>{query.isError?'余额更新失败，显示上次结果；可使用右侧统一刷新入口重查。':data?`初和中转站共享余额（不含 Token01） · ${time} 更新 · 每 30 秒自动刷新`:'正在查询账户余额'}</TooltipContent></Tooltip>
  </div>;
}
