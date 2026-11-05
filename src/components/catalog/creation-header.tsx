import {Film,Images,PanelRightClose,PanelRightOpen,Shirt} from 'lucide-react';
import {Tabs,TabsList,TabsTrigger} from '../ui/tabs';
import {IconButton} from '../common';

export type ContentKind='post'|'video'|'wear';
/** One header for all content composers, with a stable title and save-status row. */
export function CreationHeader({type,onType,subtitle='新建作品',saveState,collapsed,onToggle,disabled=false}:{type:ContentKind;onType?:(type:ContentKind)=>void;subtitle?:string;saveState:string;collapsed:boolean;onToggle:()=>void;disabled?:boolean}){
 return <div className="promotion-composer-top">{onType?<Tabs value={type} onValueChange={value=>onType(value as ContentKind)}><TabsList variant="line" aria-label="创作内容类型"><TabsTrigger value="post" disabled={disabled}><Images/>图文</TabsTrigger><TabsTrigger value="video" disabled={disabled}><Film/>视频</TabsTrigger><TabsTrigger value="wear" disabled={disabled}><Shirt/>服饰穿戴</TabsTrigger></TabsList></Tabs>:<strong>新建服饰穿戴</strong>}<span>{subtitle}</span><small aria-live="polite">{saveState}</small><IconButton icon={collapsed?PanelRightOpen:PanelRightClose} label={collapsed?'展开创作侧栏':'收起创作侧栏'} onClick={onToggle}/></div>;
}
