import {RefreshCw} from 'lucide-react';
import {quoteAmount,quoteRange,type GenerationQuoteState} from '@/lib/generation-quote';
import {Tooltip,TooltipContent,TooltipTrigger} from './ui/tooltip';
import {Button} from './ui/button';

export function GenerationCost({state}:{state:GenerationQuoteState}){
  const {quote,error,loading,empty}=state;
  const label=empty?'选择图片后报价':loading?'正在查询报价':quote?`${quoteRange(quote)} ${quote.unit}`:error?'报价查询失败':'等待报价';
  return <Tooltip><TooltipTrigger asChild><div className="generation-cost" data-state={error||quote&&!quote.affordable?'error':'ready'} aria-live="polite" tabIndex={0}>
    <span>预计消耗{state.refreshing?' · 更新中':error&&quote?' · 更新失败':''}</span><strong>{label}</strong>{quote&&!quote.affordable&&<small>可用算力不足</small>}{error&&<Button type="button" size="icon-sm" variant="ghost" aria-label="重新查询生成报价" onClick={()=>void state.refresh()}><RefreshCw/></Button>}
  </div></TooltipTrigger><TooltipContent className="generation-cost-tooltip">{error?(error as Error).message:quote?<>
    {quote.items.length} 项 · 单项 {quoteRange({minimum:Math.min(...quote.items.map(r=>r.minimum)),maximum:Math.max(...quote.items.map(r=>r.maximum))})} {quote.unit}<br/>
    {quote.balance===null?'余额由 Token01 在提交时校验':<>账户余额 {quoteAmount(quote.balance)} {quote.unit} · 当前可用 {quoteAmount(quote.available)} {quote.unit}</>}<br/>
    {quote.keyRemaining!==null&&<>本密钥剩余额度 {quoteAmount(quote.keyRemaining)} {quote.unit}<br/></>}
    {quote.note|| (quote.minimum!==quote.maximum?'供应商按可用线路派单，显示价格区间；余额按最高报价校验。':'按当前接口价格及所选参数计算。')}<br/>提交前重新核价，实际费用以任务结算为准。
  </>:empty?'勾选待生成图片后，自动查询本次总算力。':'正在获取模型价格与账户余额。'}</TooltipContent></Tooltip>;
}
