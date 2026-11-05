import {useId,useState,type ReactNode} from 'react';
import {Check,Settings2} from 'lucide-react';
import {ecommerceFonts,ecommerceLanguages,ecommerceMarkets,ecommercePlatforms} from '../../packages/ecommerce/settings';
import {Button} from './ui/button';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle,DialogTrigger} from './ui/dialog';
import {Input} from './ui/input';
import {Textarea} from './ui/textarea';
import {ToggleGroup,ToggleGroupItem} from './ui/toggle-group';

type Values=Record<string,string|number|boolean>;
const defaults:Values={market:'中国',language:'简体中文',platform:'淘宝/天猫/1688',themeColor:'智能主题色',fontStyle:'智能字体风格',settingsDescription:''};
const aliases:Record<string,string>={'Amazon':'亚马逊','TikTok Shop':'TikTok','AliExpress':'速卖通'};
function SettingChoices({label,value,options,custom=false,multiple=false,onChange}:{label:string;value:string;options:readonly string[];custom?:boolean;multiple?:boolean;onChange:(value:string)=>void}){
  const id=useId(),[customMode,setCustomMode]=useState(()=>custom&&!options.includes(value));
  const items=custom?[...options,'自定义']:options;
  const selection=multiple?value.split('、').filter(Boolean):customMode?'自定义':value;
  const selected=(next:string|string[])=>{
    if(Array.isArray(next)){if(next.length)onChange(next.join('、'));return;}
    if(!next)return;
    setCustomMode(next==='自定义');
    if(next!=='自定义')onChange(next);else if(options.includes(value))onChange('');
  };
  return <section className="ecommerce-more-setting"><label id={`${id}-label`} htmlFor={customMode?`${id}-custom`:undefined}>{label}</label>
    {multiple?<ToggleGroup type="multiple" value={selection as string[]} onValueChange={selected} spacing={1} className="ecommerce-setting-chips" aria-labelledby={`${id}-label`}>{items.map(item=><ToggleGroupItem key={item} value={item}>{item}</ToggleGroupItem>)}</ToggleGroup>:<ToggleGroup type="single" value={selection as string} onValueChange={selected} spacing={1} className="ecommerce-setting-chips" aria-labelledby={`${id}-label`}>{items.map(item=><ToggleGroupItem key={item} value={item}>{item}</ToggleGroupItem>)}</ToggleGroup>}
    {customMode&&<Input id={`${id}-custom`} aria-label={`自定义${label}`} value={value} maxLength={200} placeholder={`输入${label}`} onChange={e=>onChange(e.target.value)}/>}
  </section>;
}
export function EcommerceMoreSettings({values,onChange,multiplePlatforms=false,renderExtra,disabled=false}:{values:Values;onChange:(values:Values)=>void;multiplePlatforms?:boolean;renderExtra?:(values:Values,onChange:(values:Values)=>void)=>ReactNode;disabled?:boolean}){
  const [open,setOpen]=useState(false),[pending,setPending]=useState<Values>(defaults),[error,setError]=useState('');
  const set=(key:string,value:string)=>{setPending(old=>({...old,[key]:value}));setError('');};
  const show=(next:boolean)=>{if(next){setPending({...defaults,...values,platform:String(values.platform??defaults.platform).split('、').map(v=>aliases[v]||v).join('、')});setError('');}setOpen(next);};
  const confirm=()=>{if(['market','language','platform','themeColor','fontStyle'].some(key=>!String(pending[key]??'').trim())){setError('请补充自定义设置');return;}onChange(pending);setOpen(false);};
  return <Dialog open={open} onOpenChange={show}><DialogTrigger asChild><Button variant="outline" disabled={disabled} className="ecommerce-more-settings-trigger"><Settings2/>更多设置<span>{String(values.market??defaults.market)} · {String(values.language??defaults.language)}</span></Button></DialogTrigger>
    <DialogContent className="ecommerce-more-settings-dialog"><DialogHeader><DialogTitle>更多设置</DialogTitle><DialogDescription className="sr-only">设置目标销售国家或地区、图片文案语言、目标平台、主题色和字体。</DialogDescription></DialogHeader>
      <div className="ecommerce-more-settings-body">
        <SettingChoices label="目标销售国家/地区" value={String(pending.market)} options={ecommerceMarkets} custom onChange={v=>set('market',v)}/>
        <SettingChoices label="图片文案语言" value={String(pending.language)} options={ecommerceLanguages} custom onChange={v=>set('language',v)}/>
        <SettingChoices label="目标平台" value={String(pending.platform)} options={ecommercePlatforms} multiple={multiplePlatforms} onChange={v=>set('platform',v)}/>
        <ThemeSetting value={String(pending.themeColor)} onChange={v=>set('themeColor',v)}/>
        <SettingChoices label="字体风格" value={String(pending.fontStyle)} options={ecommerceFonts} custom onChange={v=>set('fontStyle',v)}/>
        <section className="ecommerce-more-setting"><label htmlFor="ecommerce-settings-description">额外描述</label><Textarea id="ecommerce-settings-description" aria-label="额外描述" rows={4} maxLength={4000} value={String(pending.settingsDescription)} onChange={e=>set('settingsDescription',e.target.value)}/></section>
        {renderExtra&&<div className="ecommerce-page-extra-settings">{renderExtra(pending,setPending)}</div>}
        {error&&<p role="alert" className="text-destructive">{error}</p>}
      </div><DialogFooter><span>设置会用于当前创作要求</span><Button onClick={confirm}><Check/>确定</Button></DialogFooter>
    </DialogContent></Dialog>;
}
function ThemeSetting({value,onChange}:{value:string;onChange:(value:string)=>void}){
  const [custom,setCustom]=useState(value!=='智能主题色');
  return <section className="ecommerce-more-setting"><label id="ecommerce-theme-label">主题色</label><ToggleGroup type="single" value={custom?'自定义颜色':'智能主题色'} onValueChange={next=>{if(!next)return;setCustom(next==='自定义颜色');onChange(next==='自定义颜色'?'#3f63ff':'智能主题色');}} spacing={1} className="ecommerce-setting-chips" aria-labelledby="ecommerce-theme-label"><ToggleGroupItem value="智能主题色">智能主题色</ToggleGroupItem><ToggleGroupItem value="自定义颜色">自定义颜色</ToggleGroupItem></ToggleGroup>{custom&&<div className="ecommerce-custom-color"><Input type="color" aria-label="选择主题颜色" value={/^#[a-f\d]{6}$/i.test(value)?value:'#3f63ff'} onChange={e=>onChange(e.target.value)}/><Input aria-label="自定义主题色" maxLength={200} value={value} onChange={e=>onChange(e.target.value)}/></div>}</section>;
}
