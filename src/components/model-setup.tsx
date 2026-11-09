import {useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Check,ExternalLink,HelpCircle,Image,Video,MessageSquare,LoaderCircle,RefreshCw,Sparkles,ArrowRight} from 'lucide-react';
import {toast} from 'sonner';
import type {ModelSetupPreview,SetupRole} from '../../packages/model-setup';
import {relayPortals,type RelayId} from '../../packages/relays';
import {api} from '@/lib/api';
import {useStudio} from '@/lib/studio';
import {useAnalysis} from './analysis';
import {Button} from './ui/button';
import {Badge} from './ui/badge';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';
import {Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription} from './ui/sheet';

const roleLabels:Record<SetupRole,string>={image:'图片创作',video:'视频生成',chat:'AI 辅助'};
const roleIcons={image:Image,video:Video,chat:MessageSquare};
export function RelayKeyGuide({relayId}:{relayId:RelayId}){
 const [open,setOpen]=useState(false),name=relayId==='chuhe'?'初和中转站':'Token01';
 return <><Button size="sm" variant="outline" onClick={()=>setOpen(true)}><HelpCircle data-icon="inline-start"/>创建 API Key</Button>
  <Sheet open={open} onOpenChange={setOpen}><SheetContent className="analysis-sheet provider-model-sheet"><SheetHeader><SheetTitle>连接{name}</SheetTitle><SheetDescription>只需一把密钥，无需逐个配置模型。</SheetDescription></SheetHeader><div className="analysis-sheet-body relay-key-guide">
   <ol>
    <li><span>01</span><div><h3>在中转站创建密钥</h3><p>登录自己的账户，进入密钥管理并新建 API Key。</p><Button asChild><a href={relayPortals[relayId].keys} target="_blank" rel="noreferrer">打开{name}密钥管理<ExternalLink data-icon="inline-end"/></a></Button></div></li>
    <li><span>02</span><div><h3>模型权限选全部，分组沿用平台设置</h3><p>如果创建页面提供「全部模型」或「不限制模型」，可以选择它。没有该选项时保留平台默认设置。</p><p>{relayId==='chuhe'?'已有自定义渠道时继续沿用；工作台只会使用密钥允许的模型和渠道。':'分组使用平台默认或你已经绑定的分组。不确定时无需逐个配置倍率分组。'}</p></div></li>
    <li><span>03</span><div><h3>复制密钥，回来完成连接</h3><p>将密钥粘贴到{name}卡片，点击「连接并同步」。同步成功后，点击「一键启用推荐」。</p><Button variant="outline" onClick={()=>setOpen(false)}>返回填写密钥<ArrowRight data-icon="inline-end"/></Button></div></li>
   </ol>
   <a className="relay-help-link" href="/help?topic=models" onClick={()=>setOpen(false)}>查看模型、分组与费用说明<ExternalLink aria-hidden="true"/></a>
  </div></SheetContent></Sheet>
 </>;
}

export function ModelSetupPanel({onManual}:{onManual:()=>void}){
 const studio=useStudio(),analysis=useAnalysis(),cache=useQueryClient();
 const queryKey=['model-setup',studio.boot.models.map(model=>model.id+':'+model.revision+':'+model.enabled).join(','),analysis.config?.settings.defaultModelId,analysis.config?.models.map(model=>model.id+':'+model.revision+':'+model.enabled).join(',')];
 const query=useQuery({queryKey,queryFn:()=>api<ModelSetupPreview>('/model-setup'),retry:false});
 const [busy,setBusy]=useState(false),pending=useRef(false);
 const data=query.data,configured=data?.applied===true;
 async function apply(manual=false){
  if(!data||pending.current)return;pending.current=true;setBusy(true);
  try{
   const result=await api<ModelSetupPreview>(manual?'/model-setup/manual':'/model-setup/apply',manual?{revision:data.settings.revision}:{signature:data.signature},manual?'PUT':'POST');
   cache.setQueryData(queryKey,result);
   await Promise.all([studio.refresh(),analysis.refresh(),cache.invalidateQueries({queryKey:['relays']})]);
   if(manual)onManual();
   toast.success(manual?'已切换为手动配置':'推荐模型已就绪，可以开始创作');
  }catch(error){toast.error((error as Error).message);await query.refetch();}
  finally{pending.current=false;setBusy(false);}
 }
 return <section className="settings-panel model-setup-panel" aria-labelledby="model-setup-heading">
  <div className="section-heading"><div><h2 id="model-setup-heading"><Sparkles aria-hidden="true"/>让系统帮你选模型</h2><p className="muted">连接中转站后，为新建创作启用推荐模型；已有草稿与任务保持原配置。</p></div><Badge variant={configured?'secondary':'outline'}>{configured?'推荐配置已启用':data?.settings.mode==='recommended'?'推荐配置待更新':data?.choices.length?'待启用推荐':'首次接入 · 三步完成'}</Badge></div>
  <ol className="model-setup-steps" aria-label="接入步骤"><li><span>1</span>创建密钥</li><li><span>2</span>连接并同步</li><li className={configured?'is-done':''}><span>{configured?<Check aria-hidden="true"/>:'3'}</span>启用推荐</li></ol>
  {query.isPending&&<p role="status"><LoaderCircle className="spin"/>正在读取可用模型…</p>}
  {query.error&&<Alert variant="destructive"><AlertTitle>推荐方案读取失败</AlertTitle><AlertDescription>{(query.error as Error).message}<Button variant="outline" onClick={()=>void query.refetch()}>重新读取</Button></AlertDescription></Alert>}
  {data&&<div className="model-setup-choices">{(['image','video','chat'] as const).map(role=>{const choice=data.choices.find(choice=>choice.role===role),Icon=roleIcons[role];return <article key={role} className={choice?'':'is-unavailable'}><div className="model-setup-role"><Icon aria-hidden="true"/><span>{roleLabels[role]}</span><span>{data.availableCounts[role]} 个可用</span></div><strong>{choice?.name||'暂未接通'}</strong><p>{choice?(choice.provider==='chuhe'?'初和中转站':'Token01')+' · '+choice.group:'连接支持此能力的中转站后即可推荐'}</p>{choice&&<small>{choice.reason}</small>}</article>;})}</div>}
  <div className="model-setup-actions"><Button disabled={busy||!data?.choices.length} onClick={()=>void apply()}>{busy?<LoaderCircle data-icon="inline-start" className="spin"/>:<Sparkles data-icon="inline-start"/>}{configured?'重新应用推荐':'一键启用推荐'}</Button>{data?.settings.mode==='recommended'&&<Button variant="outline" disabled={busy} onClick={()=>void apply(true)}>改为手动配置</Button>}<Button variant="ghost" disabled={busy||query.isFetching} onClick={()=>void query.refetch()}><RefreshCw data-icon="inline-start" className={query.isFetching?'spin':''}/>刷新推荐</Button><span className="muted">按已适配流程推荐；费用在创作前查询，不作最低价承诺。</span></div>
 </section>;
}
