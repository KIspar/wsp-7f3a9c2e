import {useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Image,Video,MessageSquare,AudioLines,Layers,RefreshCw,ExternalLink,ChevronRight,Check,LoaderCircle} from 'lucide-react';
import {toast} from 'sonner';
import type {Model} from '../../packages/contracts';
import type {AnalysisModelId} from '../../packages/analysis';
import type {RelayState,RelayCatalog,RelayCatalogModel} from '../../packages/relays';
import type {ProviderEnvelope,ProviderPricing} from '../../packages/provider';
import {chuheChannelStatus,chuheChannelStatusLabel} from '../../packages/chuhe-routing';
import {api,dateTime} from '@/lib/api';
import {useStudio} from '@/lib/studio';
import {FormSelect} from './form-select';
import {Token01ModelConfiguration} from './token01-routing';
import {useToken01Keys} from './token01-keys';
import {AnalysisModelsPanel,useAnalysis} from './analysis';
import {PriceGroup} from './provider';
import {Button} from './ui/button';
import {Badge} from './ui/badge';
import {Switch} from './ui/switch';
import {Field,FieldLabel,FieldDescription} from './ui/field';
import {Tabs,TabsList,TabsTrigger,TabsContent} from './ui/tabs';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';
import {Empty,EmptyHeader,EmptyTitle,EmptyDescription} from './ui/empty';
import {Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription} from './ui/sheet';

const categoryLabels:Record<string,string>={image:'图片类',video:'视频类',chat:'聊天类',audio:'音频类',other:'其他'};
const categoryIcons={image:Image,video:Video,chat:MessageSquare,audio:AudioLines,other:Layers};
const groupLabel=(group:RelayCatalogModel['groups'][number])=>group.name+(group.status==='active'?'':` · ${chuheChannelStatusLabel(group.status)}`)+(group.forced?' · 强行调用':'');
function unavailableLabel(entry:RelayCatalogModel){
  if(entry.groups.some(group=>group.status==='congested'))return '临时拥挤';
  if(entry.groups.length&&entry.groups.every(group=>group.status==='removed'))return '渠道已关闭';
  return '调用待确认';
}

function LegacyModelConfiguration({entry,model,credentialStamp}:{entry:RelayCatalogModel;model?:Model;credentialStamp?:string}){
  const studio=useStudio(),[group,setGroup]=useState(''),[busy,setBusy]=useState(false);
  const pricing=useQuery({queryKey:['model-configuration-prices',entry.upstreamId,credentialStamp],queryFn:()=>api<ProviderEnvelope<ProviderPricing>>('/provider/pricing?'+new URLSearchParams({credentialId:'tt-image',model:entry.upstreamId})),retry:false,staleTime:15000});
  const groups=pricing.data?.data.channel_groups.filter(row=>entry.groups.some(group=>group.id===String(row.group_id))).map(row=>{const configured=entry.groups.find(group=>group.id===String(row.group_id))!;return {...row,routingStatus:chuheChannelStatus(row.is_active,configured.status==='removed'?'removed':undefined),configuredForceCall:configured.forced};})||[],selected=groups.find(row=>String(row.group_id)===group)||groups[0];
  async function save(){if(!model)return;setBusy(true);try{await api(`/models/${model.id}`,{...model,enabled:true},'PUT');await studio.refresh();toast.success('模型已启用，调用沿用密钥的自定义渠道策略');}catch(error){toast.error((error as Error).message);}finally{setBusy(false);}}
  return <div className="flex flex-col gap-5">
    <div className="section-heading"><h3>已配置的渠道分组</h3><Button variant="outline" size="sm" disabled={pricing.isFetching} onClick={()=>void pricing.refetch()}><RefreshCw data-icon="inline-start"/>刷新价格</Button></div>
    {pricing.isPending&&<p role="status">正在读取渠道价格…</p>}
    {pricing.error&&<Alert variant="destructive"><AlertTitle>价格读取失败</AlertTitle><AlertDescription>{(pricing.error as Error).message}</AlertDescription></Alert>}
    {!!groups.length&&<Field><FieldLabel htmlFor="legacy-price-group">渠道分组 · {entry.groups.length} 个已配置</FieldLabel><FormSelect id="legacy-price-group" value={String(selected.group_id)} onValueChange={setGroup} options={groups.map(row=>({value:String(row.group_id),label:groupLabel({id:String(row.group_id),name:row.group_name,status:row.routingStatus,forced:row.configuredForceCall})}))}/><FieldDescription>仅查看价格；调用沿用平台渠道策略。</FieldDescription></Field>}
    {!!entry.groups.length&&!groups.length&&<div className="flex flex-wrap gap-2">{entry.groups.map(group=><Badge key={group.id} variant="outline">{groupLabel(group)}</Badge>)}</div>}
    {selected&&<PriceGroup group={selected}/>}
    {!entry.available&&<p role="status" className="muted">{unavailableLabel(entry)} · 请核对平台渠道设置</p>}
    {!entry.localId&&<p className="muted">已同步 · 尚未接入调用</p>}
    <div className="flex flex-wrap gap-3">{model&&<Button disabled={busy||!entry.available||!pricing.data||pricing.isError} onClick={()=>void save()}>保存并启用模型</Button>}<Button variant="outline" asChild><a href="https://chuhe.lk888.ai/api/console/keys" target="_blank" rel="noreferrer">管理自定义渠道<ExternalLink data-icon="inline-end"/></a></Button></div>
    {pricing.data&&<p className="muted">价格更新于 {dateTime(pricing.data.fetchedAt)}</p>}
  </div>;
}

export function MediaModelSettings({relays,chuheCatalog,catalogError,catalogPending,onRefreshCatalog}:{relays:RelayState[];chuheCatalog?:RelayCatalog;catalogError?:unknown;catalogPending?:boolean;onRefreshCatalog:()=>void}){
  const studio=useStudio(),analysis=useAnalysis(),keys=useToken01Keys(),[category,setCategory]=useState('image'),[selected,setSelected]=useState<string>(),[busy,setBusy]=useState(false);
  const [defaultBusy,setDefaultBusy]=useState<AnalysisModelId>(),defaultPending=useRef(false);
  async function selectDefault(id:AnalysisModelId){
    if(defaultPending.current||analysis.config?.settings.defaultModelId===id)return;
    defaultPending.current=true;setDefaultBusy(id);
    try{await api('/analysis/settings',{defaultModelId:id},'PUT');await analysis.refresh();toast.success('默认 AI 辅助模型已切换');}
    catch(error){toast.error((error as Error).message);}
    finally{defaultPending.current=false;setDefaultBusy(undefined);}
  }
  const available=new Set(relays.filter(relay=>relay.status==='ready').flatMap(relay=>relay.modelIds));
  const namedModels=new Set(keys.data?.filter(key=>key.status==='ready').flatMap(key=>key.modelIds)||[]);
  const tokenModels=studio.boot.models.filter(model=>model.provider==='token01'&&(namedModels.has(model.id)||((model.token01Group||model.token01KeyId)?model.relayAvailable===true:available.has(model.id))));
  const entries=[...(chuheCatalog?.models||[]).map(entry=>({...entry,provider:'chuhe' as const})),...tokenModels.map(model=>({id:model.id,name:model.name,upstreamId:model.upstreamId,category:model.category,localId:model.id,available:model.relayAvailable!==false||namedModels.has(model.id),groups:[],provider:'token01' as const}))];
  const entry=entries.find(entry=>`${entry.provider}:${entry.id}`===selected),model=studio.boot.models.find(model=>model.id===entry?.localId);
  const credentialStamp=relays.find(relay=>relay.id==='chuhe')?.checkedAt;
  const categories=['image','video','chat',...['audio','other'].filter(category=>entries.some(entry=>entry.category===category||category==='other'&&!categoryLabels[entry.category]))];
  return <section className="settings-panel flex flex-col gap-5" aria-labelledby="media-model-heading">
    <div className="section-heading"><div><h2 id="media-model-heading">模型与调用配置</h2></div><Badge variant="outline">{entries.length} 个模型</Badge></div>
    {!!catalogError&&<Alert variant="destructive"><AlertTitle>初和模型查询失败</AlertTitle><AlertDescription>{(catalogError as Error).message}<Button variant="outline" onClick={onRefreshCatalog}>重新查询</Button></AlertDescription></Alert>}
    <Tabs value={category} onValueChange={setCategory}>
      <TabsList aria-label="模型类别">{categories.map(value=>{const Icon=categoryIcons[value as keyof typeof categoryIcons];return <TabsTrigger key={value} value={value}><Icon/>{categoryLabels[value]}</TabsTrigger>;})}</TabsList>
      {categories.map(value=><TabsContent key={value} value={value} className="pt-4">
        {entries.some(entry=>(categoryLabels[entry.category]?entry.category:'other')===value)?<div className="media-model-grid">{entries.filter(entry=>(categoryLabels[entry.category]?entry.category:'other')===value).map(entry=>{const local=studio.boot.models.find(model=>model.id===entry.localId),chat=analysis.config?.models.find(model=>model.id===entry.localId),enabled=local?.enabled??chat?.enabled,isDefault=!!chat&&analysis.config?.settings.defaultModelId===chat.id,Icon=categoryIcons[value as keyof typeof categoryIcons];return <div key={`${entry.provider}:${entry.id}`} className={`media-model-card${isDefault?' is-default':''}`}><button type="button" className="media-model-tile" aria-label={`配置 ${entry.name}`} aria-haspopup="dialog" onClick={()=>setSelected(`${entry.provider}:${entry.id}`)}>
          <span className="media-model-tile-top"><span className="media-model-icon"><Icon aria-hidden="true"/></span><span className={`media-model-status ${entry.available&&enabled?'is-enabled':''}`}>{!entry.available?unavailableLabel(entry):!entry.localId?'已同步':enabled?'已启用':'未启用'}</span></span>
          <strong>{entry.name}</strong><span className="media-model-provider">{entry.provider==='token01'?'Token01':'初和中转站'}</span>
          <span className="media-model-groups">{entry.provider==='token01'?local?.token01Group||'跟随密钥分组':entry.groups.map(groupLabel).join(' / ')}</span>
          <span className="media-model-tile-bottom"><span>{entry.localId?'价格与配置':'查看价格 · 尚未接入调用'}</span><ChevronRight aria-hidden="true"/></span>
        </button>{chat&&<label className="media-model-default-choice" aria-busy={defaultBusy===chat.id}><input className="sr-only" type="radio" name="default-analysis-model" value={chat.id} checked={isDefault} aria-label={`将 ${entry.name} 设为默认 AI 辅助模型`} aria-disabled={!!defaultBusy||!entry.available||!chat.enabled||!chat.credentialConfigured} disabled={!entry.available||!chat.enabled||!chat.credentialConfigured} onChange={()=>void selectDefault(chat.id)}/><span className="media-model-default-check" aria-hidden="true"><Check/></span><span>{isDefault?'默认 AI 辅助模型':'设为 AI 辅助模型'}</span>{defaultBusy===chat.id&&<LoaderCircle className="spin" aria-hidden="true"/>}</label>}</div>;})}</div>:<Empty><EmptyHeader><EmptyTitle>{catalogPending?'正在查询模型…':`暂无已配置的${categoryLabels[value]}模型`}</EmptyTitle><EmptyDescription>在上方保存中转站密钥并同步模型。</EmptyDescription></EmptyHeader></Empty>}
      </TabsContent>)}
    </Tabs>
    <Sheet open={!!entry} onOpenChange={open=>{if(!open)setSelected(undefined);}}><SheetContent className="analysis-sheet provider-model-sheet"><SheetHeader><SheetTitle>{entry?.name}</SheetTitle><SheetDescription>{entry?.provider==='token01'?'Token01':'初和中转站'} · 价格与调用配置</SheetDescription></SheetHeader><div className="analysis-sheet-body">
      {entry&&<>
        {model&&<Field orientation="horizontal"><FieldLabel htmlFor="media-model-enabled">启用模型</FieldLabel><Switch id="media-model-enabled" checked={model.enabled} disabled={busy||!entry.available} onCheckedChange={async enabled=>{setBusy(true);try{await api(`/models/${model.id}`,{...model,enabled},'PUT');await studio.refresh();}catch(error){toast.error((error as Error).message);}finally{setBusy(false);}}}/></Field>}
        {entry.provider==='token01'?<Token01ModelConfiguration key={entry.id} modelId={entry.id}/>:<><LegacyModelConfiguration key={entry.id} entry={entry} model={model} credentialStamp={credentialStamp}/>{entry.category==='chat'&&entry.localId&&entry.available&&<AnalysisModelsPanel allowedIds={[entry.localId]} embedded/>}</>}
      </>}
    </div></SheetContent></Sheet>
  </section>;
}
