import {useEffect,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {LoaderCircle,RefreshCw} from 'lucide-react';
import {toast} from 'sonner';
import type {Token01GroupChoice,Token01RoutingConfig} from '../../packages/token01';
import {api,dateTime} from '@/lib/api';
import {useStudio} from '@/lib/studio';
import {FormSelect} from './form-select';
import {Button} from './ui/button';
import {Badge} from './ui/badge';
import {Input} from './ui/input';
import {Field,FieldGroup,FieldLabel,FieldDescription} from './ui/field';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';
import {Table,TableHeader,TableBody,TableRow,TableHead,TableCell,TableCaption} from './ui/table';
import {useToken01Keys} from './token01-keys';

const amount=(value:number)=>new Intl.NumberFormat('zh-CN',{maximumFractionDigits:9}).format(value);

function GroupPrices({choice}:{choice:Token01GroupChoice}){
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center gap-3"><Badge variant="secondary">人民币 · 元 / 秒</Badge><Badge variant="outline">分组倍率 ×{amount(choice.ratio)}</Badge><span className="muted">{choice.ratio<1?`${amount(choice.ratio*10)} 折`:choice.ratio===1?'标准倍率':`${amount(choice.ratio)} 倍计费`}</span></div>
    <Table aria-label={`${choice.group} 价格明细`}><TableCaption>10 秒示例不含额外参考图费用</TableCaption><TableHeader><TableRow><TableHead>画质</TableHead><TableHead>目录基础价 / 秒</TableHead><TableHead>实际单价 / 秒</TableHead><TableHead>低峰单价 / 秒</TableHead><TableHead>10 秒费用</TableHead></TableRow></TableHeader><TableBody>{choice.prices?.map(tier=><TableRow key={tier.resolution}><TableCell>{tier.resolution}</TableCell><TableCell>¥{amount(tier.basePrice)}</TableCell><TableCell><strong>¥{amount(tier.price)}</strong>{tier.specialPrice&&<Badge variant="outline" className="ml-2">分组专价</Badge>}</TableCell><TableCell>{tier.offPeakPrice===undefined?'—':`¥${amount(tier.offPeakPrice)}`}</TableCell><TableCell>¥{tier.offPeakPrice!==undefined&&tier.offPeakPrice!==tier.price?`${amount(tier.offPeakPrice*10)}–${amount(tier.price*10)}`:amount(tier.price*10)}</TableCell></TableRow>)}</TableBody></Table>
    <p className="muted">{choice.inputImagePrice===undefined?'目录未列出额外参考图费用。':`参考图前 ${choice.freeInputImages} 张免费，超出后 ¥${amount(choice.inputImagePrice)} / 张。`}{choice.offPeakWindows?.length?`低峰时段：${choice.offPeakWindows.map(window=>`${window.start}–${window.end} ${window.tz||'平台时区'}`).join('；')}。`:choice.prices?.some(tier=>tier.offPeakPrice!==undefined)?'低峰生效时间以平台设置为准。':''}</p>
    {!!choice.notes?.length&&<details><summary>分组能力与限制</summary>{choice.notes.map((note,index)=><p className="whitespace-pre-wrap muted" key={index}>{note}</p>)}</details>}
  </div>;
}

function useToken01Settings(){
  const studio=useStudio(),cache=useQueryClient();
  const query=useQuery({queryKey:['token01-routing'],queryFn:()=>api<Token01RoutingConfig>('/token01/routing'),retry:false});
  const [busy,setBusy]=useState(false);
  const refresh=()=>Promise.all([cache.invalidateQueries({queryKey:['token01-routing']}),cache.invalidateQueries({queryKey:['model-setup']}),cache.invalidateQueries({queryKey:['relays']}),studio.refresh()]);
  async function action(run:()=>Promise<unknown>,message:string){setBusy(true);try{await run();await refresh();toast.success(message);}catch(error){await refresh();toast.error((error as Error).message);}finally{setBusy(false);}}
  return {studio,query,busy,action};
}

export function Token01GroupCredentials(){
  const {query,busy,action}=useToken01Settings();
  const [group,setGroup]=useState('choose-group'),[key,setKey]=useState('');
  const choices=[...new Map(query.data?.models.flatMap(model=>model.groups).map(choice=>[choice.group,choice])||[]).values()];
  const profile=query.data?.profiles.find(profile=>profile.group===group);
  return <details className="mt-6">
    <summary>固定倍率分组的密钥 · 可选</summary>
    <FieldGroup className="mt-6">
      
      <Field><FieldLabel htmlFor="token01-credential-group">密钥绑定的倍率分组</FieldLabel><FormSelect id="token01-credential-group" value={group} disabled={busy} options={[{value:'choose-group',label:'请选择平台密钥绑定的倍率分组',disabled:true},...choices.map(choice=>({value:choice.group,label:`${choice.group} · 倍率 ×${choice.ratio}`}))]} onValueChange={value=>{setGroup(value);setKey('');}}/></Field>
      {group!=='choose-group'&&<>
        <Field><FieldLabel htmlFor="token01-group-key">Token01 分组 API 密钥</FieldLabel><Input id="token01-group-key" type="password" autoComplete="new-password" value={key} disabled={busy} placeholder={profile?.configured?'留空保留此分组已保存的密钥':'输入在 Token01 绑定此分组的 sk- 密钥'} onChange={e=>setKey(e.target.value)}/></Field>
        <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={busy||!key.trim()} onClick={()=>void action(async()=>{await api('/token01/groups/credential',{group,key:key.trim()},'PUT');setKey('');},'倍率分组密钥已保存，模型权限已同步')}>{busy&&<LoaderCircle data-icon="inline-start" className="spin"/>}保存分组密钥并同步</Button><Button variant="outline" disabled={busy||!profile?.configured} onClick={()=>void action(()=>api('/token01/groups/sync',{group}),'分组模型权限已同步')}>同步分组模型</Button>{profile&&<Badge variant="outline">{profile.status==='ready'?`${profile.modelIds.length} 个模型权限已验证`:profile.status==='error'?'同步失败':'待同步'}</Badge>}</div>
        {profile?.error&&<p role="alert" className="error-text">{profile.error}</p>}
      </>}
      {query.data?.catalogError&&<p role="alert" className="error-text">{query.data.catalogError}</p>}
    </FieldGroup>
  </details>;
}

export function Token01ModelConfiguration({modelId}:{modelId:string}){
  const {studio,query,busy,action}=useToken01Settings();
  const keys=useToken01Keys();
  const [keyId,setKeyId]=useState('default-key');
  const [group,setGroup]=useState('default-key');
  const model=studio.boot.models.find(model=>model.id===modelId),choices=query.data?.models.find(model=>model.id===modelId)?.groups||[];
  const choice=choices.find(choice=>choice.group===group);
  const profile=query.data?.profiles.find(profile=>profile.group===group);
  const named=keys.data?.find(key=>key.id===keyId);
  const ready=keyId!=='default-key'?named?.status==='ready'&&named.modelIds.includes(modelId):profile?.status==='ready'&&profile.modelIds.includes(modelId);
  useEffect(()=>{setGroup(model?.token01Group||'default-key');setKeyId(model?.token01KeyId||'default-key');},[modelId,model?.token01Group,model?.token01KeyId]);
  return <div className="flex flex-col gap-6">
    <div className="section-heading"><div><h3>选择分组与价格</h3></div><Button variant="outline" size="sm" disabled={busy} onClick={()=>void action(async()=>{const result=await api<Token01RoutingConfig>('/token01/routing/refresh',{});if(result.catalogError)throw new Error(result.catalogError);},'倍率分组目录已刷新')}><RefreshCw data-icon="inline-start"/>刷新价格</Button></div>
    {query.isPending&&<p role="status">正在读取模型和分组…</p>}
    {(query.error||query.data?.catalogError)&&<Alert variant="destructive"><AlertTitle>分组目录读取失败</AlertTitle><AlertDescription>{query.data?.catalogError||(query.error as Error)?.message}</AlertDescription></Alert>}
    <FieldGroup>
      <Field><FieldLabel htmlFor="token01-model-key">调用 API Key</FieldLabel><FormSelect id="token01-model-key" value={keyId} disabled={busy} options={[{value:'default-key',label:'统一密钥 / 固定倍率分组密钥'},...(keys.data||[]).map(key=>({value:key.id,label:`${key.name} · ${key.modelNames.length} 个模型`,disabled:key.status!=='ready'||!key.modelIds.includes(modelId)}))]} onValueChange={value=>{setKeyId(value);setGroup(value==='default-key'?'default-key':keys.data?.find(key=>key.id===value)?.group||'default-key');}}/></Field>
      <Field><FieldLabel htmlFor="token01-group-choice">倍率分组</FieldLabel><FormSelect id="token01-group-choice" value={group} disabled={busy||keyId!=='default-key'} options={[{value:'default-key',label:'跟随所选密钥分组（含 auto / auto_price）'},...choices.map(choice=>({value:choice.group,label:`${choice.group} · 倍率 ×${choice.ratio} · ${choice.resolutions.join(' / ')}`}))]} onValueChange={setGroup}/><FieldDescription>{named?'平台绑定分组（手动标注）':'固定分组需使用对应密钥'}</FieldDescription></Field>
    </FieldGroup>
    {choice?<GroupPrices choice={choice}/>:!!choices.length&&<><Table aria-label="Token01 分组价格比较"><TableHeader><TableRow><TableHead>分组</TableHead><TableHead>倍率</TableHead><TableHead>公开单价（元 / 秒）</TableHead><TableHead>配置</TableHead></TableRow></TableHeader><TableBody>{choices.map(choice=>{const rates=choice.prices?.flatMap(tier=>[tier.price,...(tier.offPeakPrice===undefined?[]:[tier.offPeakPrice])])||[];return <TableRow key={choice.group}><TableCell><Button variant="link" disabled={keyId!=='default-key'} onClick={()=>setGroup(choice.group)}>{choice.group}</Button></TableCell><TableCell>×{amount(choice.ratio)}</TableCell><TableCell>{rates.length?`¥${amount(Math.min(...rates))}–${amount(Math.max(...rates))}`:'待刷新'}</TableCell><TableCell>{query.data?.profiles.some(profile=>profile.group===choice.group&&profile.status==='ready'&&profile.modelIds.includes(modelId))?'密钥已配置':'需手动配置分组密钥'}</TableCell></TableRow>;})}</TableBody></Table></>}
    {group!=='default-key'&&<Alert><AlertTitle>{ready?'此分组已就绪':'此分组需要手动配置'}</AlertTitle><AlertDescription>{ready?`${group} · 密钥已就绪`:'请先在 Token01 卡片中保存绑定此分组的密钥。'}</AlertDescription></Alert>}
    <FieldGroup><Field><FieldLabel>当前调用配置</FieldLabel><p>{model?.name} · {keys.data?.find(key=>key.id===model?.token01KeyId)?.name||'统一 / 分组密钥'} · {model?.token01Group||'跟随平台分组'}</p><Button disabled={busy||!model||!!query.data?.catalogError||(keyId!=='default-key'?!ready:group!=='default-key'?!ready:!model.credentialConfigured||model.relayAvailable===false)} onClick={()=>void action(()=>api(`/token01/models/${modelId}/route`,{group:named?named.group||null:group==='default-key'?null:group,keyId:keyId==='default-key'?null:keyId,revision:model!.revision},'PUT'),'模型与分组配置已保存')}>{busy&&<LoaderCircle data-icon="inline-start" className="spin"/>}保存模型与分组</Button></Field></FieldGroup>
    {query.data?.fetchedAt&&<p className="muted">价格更新于 {dateTime(query.data.fetchedAt)}</p>}
  </div>;
}
