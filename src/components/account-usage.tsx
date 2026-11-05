import {useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Copy,Download,RefreshCw} from 'lucide-react';
import {toast} from 'sonner';
import {formatPower,useAccountRecords,useAccountUsage,useRefreshAccount} from '@/lib/account';
import type {DailyConsumption} from '../../packages/account';
import type {ProviderUsageRecord} from '../../packages/provider';
import {dateTime} from '@/lib/api';
import {Button} from './ui/button';
import {Badge} from './ui/badge';
import {ToggleGroup,ToggleGroupItem} from './ui/toggle-group';
import {Tooltip,TooltipContent,TooltipTrigger} from './ui/tooltip';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from './ui/table';
import {Skeleton} from './ui/skeleton';
import {Alert,AlertDescription,AlertTitle} from './ui/alert';
import {Empty,EmptyDescription,EmptyHeader,EmptyTitle} from './ui/empty';

function QueryError({error,onRetry}:{error:unknown;onRetry:()=>void}){
  if(!error)return null;
  return <Alert variant="destructive"><AlertTitle>数据更新失败</AlertTitle><AlertDescription>{(error as Error).message}<Button size="sm" variant="outline" onClick={onRetry}>重新查询</Button></AlertDescription></Alert>;
}
const names:Record<string,string>={'tt-image-2.5':'TT Image 2.5','omni-flash':'Omni Flash','tt-6.1-sol':'TT-6.1 sol','gem-3.8-flash':'GEM 3.8 flash','gem-4-argon':'GEM 4 argon'};
function RecordStatus({row}:{row:ProviderUsageRecord}){
  return <span className="usage-record-status"><Badge variant={row.state==='failed'?'outline':'secondary'} data-state={row.state}>{({success:'已完成',failed:'失败',running:'处理中',pending:'等待中'}[row.state]||row.state)}</Badge></span>;
}
function exportPage(rows:ProviderUsageRecord[]){
  const cell=(v:unknown)=>'"'+String(v??'').replaceAll('"','""').replace(/^[=+@\-\t\r]/,"'$&")+'"';
  const csv=[['提交时间','模型','任务号','状态','净消费（算力）','退款（算力）'],...rows.map(r=>[r.created_at,r.model,r.task_id,r.state,r.cost,r.refunded?r.refunded_amount:0])].map(row=>row.map(cell).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');
  link.href=url;link.download='账户消费明细-本页.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function AccountUsagePage(){
  const [days,setDays]=useState(7),[page,setPage]=useState(0);
  const overview=useAccountUsage(days),details=useAccountRecords(days,page),refresh=useRefreshAccount();
  const data=overview.data,rows=details.data?.records||[],total=details.data?.total;
  const [refreshing,setRefreshing]=useState(false);
  const updating=refreshing||overview.isFetching||details.isFetching;
  async function reload(){setRefreshing(true);try{await refresh();}finally{setRefreshing(false);}}
  useEffect(()=>{if(!details.isPlaceholderData&&total!==undefined&&page>0&&page*10>=total)setPage(Math.max(0,Math.ceil(total/10)-1));},[total,page,details.isPlaceholderData]);
  return <div className="management-page account-usage-page">
    <header className="usage-page-heading"><div><h1>算力统计</h1></div><div className="usage-page-actions"><ToggleGroup type="single" value={String(days)} onValueChange={value=>{if(value){setDays(Number(value));setPage(0);}}} aria-label="消费时间范围"><ToggleGroupItem value="7">近 7 天</ToggleGroupItem><ToggleGroupItem value="30">近 30 天</ToggleGroupItem></ToggleGroup><Button variant="outline" disabled={updating} onClick={()=>void reload()}><RefreshCw className={updating?'spin':''}/>刷新</Button></div></header>
    <section className="usage-trend" aria-labelledby="usage-trend-heading" aria-busy={overview.isFetching}>
      <div className="usage-section-heading"><div><h2 id="usage-trend-heading">消费趋势</h2><p>每日净消费 · 算力</p></div><div className="usage-period-totals"><span>期间消费 <strong>{formatPower(data?.totals.cost)}</strong> 算力</span><span>共 <strong>{data?.totals.count??'—'}</strong> 次调用</span><span>已退款 <strong>{formatPower(data?.totals.refunded_cost)}</strong> 算力</span></div></div>
      <QueryError error={overview.error} onRetry={()=>void overview.refetch()}/>
      {overview.isPending?<Skeleton className="usage-chart-skeleton"/>:data?<ConsumptionChart rows={data.daily}/>:<div className="usage-chart-unavailable">成功查询消费数据后显示趋势曲线。</div>}
      <div className="usage-chart-footer"><span className="usage-chart-legend"><i/>净消费</span><span>{data?`${dateTime(data.from).split(' ')[0]} — ${dateTime(data.to).split(' ')[0]} · 北京时间`:'按北京时间统计'}</span></div>
    </section>
    <section className="usage-records" aria-labelledby="usage-records-heading" aria-busy={details.isFetching}>
      <div className="usage-section-heading"><div className="usage-table-title"><h2 id="usage-records-heading">消费明细</h2><span>{total===undefined?'':`${total} 条`}</span></div><Button size="sm" variant="ghost" disabled={!rows.length||details.isFetching} onClick={()=>exportPage(rows)}><Download/>导出本页</Button></div>
      <QueryError error={details.error} onRetry={()=>void details.refetch()}/>
      <Table aria-label="账户消费明细"><TableHeader><TableRow><TableHead scope="col">提交时间</TableHead><TableHead scope="col">模型</TableHead><TableHead scope="col">任务号</TableHead><TableHead scope="col">状态</TableHead><TableHead scope="col" className="text-right">净消费 / 算力</TableHead><TableHead scope="col" className="text-right">退款 / 算力</TableHead></TableRow></TableHeader><TableBody>
        {details.isPending?Array.from({length:5},(_,i)=><TableRow key={i}>{Array.from({length:6},(_,j)=><TableCell key={j}><Skeleton className="h-4 w-20"/></TableCell>)}</TableRow>):rows.map(row=><TableRow key={row.task_id}><TableCell className="usage-date">{row.created_at?dateTime(row.created_at):'未提供'}</TableCell><TableCell><span className="usage-model-name">{names[row.model]||row.model}</span></TableCell><TableCell><span className="usage-task-id">{row.task_id}<Button variant="ghost" size="icon-sm" aria-label={`复制任务号 ${row.task_id}`} onClick={async()=>{try{await navigator.clipboard.writeText(String(row.task_id));toast.success('任务号已复制');}catch{toast.error('复制失败，请选择任务号手动复制');}}}><Copy/></Button></span></TableCell><TableCell><RecordStatus row={row}/></TableCell><TableCell className="usage-cost text-right">{formatPower(row.cost)}</TableCell><TableCell className="usage-refund text-right">{row.refunded?formatPower(row.refunded_amount):'—'}</TableCell></TableRow>)}
      </TableBody></Table>
      {!details.isPending&&!details.isError&&!rows.length&&<Empty><EmptyHeader><EmptyTitle>这段时间还没有消费</EmptyTitle><EmptyDescription>通过 API 完成创作后，真实消费会自动显示在这里。</EmptyDescription></EmptyHeader></Empty>}
      <footer className="usage-table-footer"><span>{details.data?`第 ${total===0?0:page*10+1}–${Math.min((page+1)*10,total||0)} 条，共 ${total} 条`:'每页 10 条'}</span><div><Button size="sm" variant="outline" aria-label="上一页消费明细" disabled={page===0||details.isFetching} onClick={()=>setPage(p=>Math.max(0,p-1))}><ChevronLeft/>上一页</Button><span className="usage-page-number">{page+1} / {Math.max(1,Math.ceil((total||0)/10))}</span><Button size="sm" variant="outline" aria-label="下一页消费明细" disabled={total===undefined||(page+1)*10>=total||details.isFetching} onClick={()=>setPage(p=>p+1)}>下一页<ChevronRight/></Button></div></footer>
    </section>
    <footer className="usage-page-note"><span>初和 API 消费 · 已扣除退款</span><span>{overview.isError||details.isError?'更新失败，保留上次结果':`每 30 秒自动刷新${data?' · '+new Date(data.fetchedAt).toLocaleTimeString('zh-CN',{hour12:false})+' 更新':''}`}</span></footer>
  </div>;
}

function ConsumptionChart({rows}:{rows:DailyConsumption[]}){
  const ref=useRef<HTMLDivElement>(null),[width,setWidth]=useState(850),[selected,setSelected]=useState<number|null>(null);
  useEffect(()=>{const element=ref.current;if(!element)return;const observer=new ResizeObserver(([entry])=>setWidth(Math.max(280,entry.contentRect.width)));observer.observe(element);return ()=>observer.disconnect();},[]);
  const height=230,left=48,right=16,top=20,bottom=36,plotWidth=width-left-right,plotHeight=height-top-bottom;
  const peak=Math.max(0,...rows.map(r=>r.cost||0));
  const magnitude=10**Math.floor(Math.log10(peak||1)),step=Math.ceil((peak||1)/magnitude/4)*magnitude,max=step*4;
  const points=rows.map((r,i)=>({x:left+i*plotWidth/Math.max(1,rows.length-1),y:r.cost===null?null:top+plotHeight*(1-r.cost/max)}));
  // Monotone cubic interpolation keeps the consumption curve within adjacent daily values.
  const segments:string[]=[];
  for(let i=0;i<points.length;i++){
    const p=points[i];if(p.y===null)continue;
    const prev=points[i-1];if(!prev||prev.y===null){segments.push(`M${p.x},${p.y}`);continue;}
    const slope=(a:number,b:number)=>(points[b].y!-points[a].y!)/(points[b].x-points[a].x);
    const tangent=(index:number)=>{const a=points[index-1],b=points[index],c=points[index+1];if(!a||a.y===null)return c&&c.y!==null?slope(index,index+1):0;if(!c||c.y===null)return slope(index-1,index);const s1=slope(index-1,index),s2=slope(index,index+1);return s1*s2<=0?0:2*s1*s2/(s1+s2);};
    const dx=(p.x-prev.x)/3;
    segments.push(`C${prev.x+dx},${prev.y+tangent(i-1)*dx} ${p.x-dx},${p.y-tangent(i)*dx} ${p.x},${p.y}`);
  }
  const gap=width<500?Math.ceil(rows.length/4):Math.ceil(rows.length/7);
  return <div ref={ref} className="usage-chart" aria-label="每日净消费趋势">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`每日净消费曲线，共 ${rows.length} 天，最高 ${formatPower(peak)} 算力`}><title>每日净消费趋势，按北京时间统计</title>
      {[0,1,2,3,4].map(i=>{const y=top+plotHeight*i/4;return <g key={i}><line x1={left} x2={width-right} y1={y} y2={y} className="usage-chart-grid"/><text x={left-12} y={y+4} textAnchor="end">{formatPower(max*(4-i)/4)}</text></g>;})}
      {selected!==null&&<line x1={points[selected]?.x} x2={points[selected]?.x} y1={top} y2={height-bottom} className="usage-chart-guide"/>}
      <path d={segments.join(' ')} className="usage-chart-line"/>
      {rows.map((row,i)=><g key={row.date}>{points[i].y!==null&&<circle cx={points[i].x} cy={points[i].y!} r={selected===i?4.5:3} className="usage-chart-point"/>}{(i%gap===0||i===rows.length-1)&&<text x={points[i].x} y={height-10} textAnchor={i===0?'start':i===rows.length-1?'end':'middle'}>{row.date.slice(5).replace('-','/')}</text>}</g>)}
    </svg>
    {rows.map((row,i)=><Tooltip key={row.date}><TooltipTrigger asChild><button type="button" className="usage-chart-target" style={{left:points[i].x,top:points[i].y??height-bottom}} aria-label={`${row.date}，净消费 ${row.cost===null?'待确认':formatPower(row.cost)} 算力，${row.count} 次调用`} onMouseEnter={()=>setSelected(i)} onMouseLeave={()=>setSelected(null)} onFocus={()=>setSelected(i)} onBlur={()=>setSelected(null)} /></TooltipTrigger><TooltipContent><strong>{row.date}</strong><br/>净消费 {row.cost===null?'待确认':formatPower(row.cost)} 算力 · {row.count} 次调用</TooltipContent></Tooltip>)}
  </div>;
}
