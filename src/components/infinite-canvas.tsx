import {createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ChangeEvent, type DragEvent, type ReactNode, type SetStateAction} from 'react';
import {Background, BaseEdge, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, SelectionMode, ViewportPortal, addEdge, useEdgesState, useNodesState, useReactFlow, useStore, useViewport, getBezierPath, type ConnectionLineComponentProps, type FinalConnectionState, type Connection, type Edge, type EdgeProps, type Node, type NodeChange, type EdgeChange, type NodeProps, type Viewport} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {ArrowUp, ArrowUpRight, ChevronDown, Circle, MoreHorizontal, LayoutGrid, FolderOpen, Play, Redo2, Undo2, PanelLeftClose, PanelLeftOpen, Check, CircleHelp, Code2, Copy, FileImage, Film, Globe2, Grid3X3, Hand, ImagePlus, Images, Keyboard, Layers3, Link2, List, LocateFixed, Map as MapIcon, Maximize2, Mic2, Minus, MousePointer2, PenTool, SquarePen, Minimize2, Plus, RefreshCw, ScanEye, Search, Settings2, Sparkles, Trash2, Type, UploadCloud, Video, WandSparkles, X, Zap, type LucideIcon} from 'lucide-react';
import {Link} from 'react-router-dom';
import {toast} from 'sonner';
import {api, ApiError, dateTime, shortId} from '@/lib/api';
import {useStudio} from '@/lib/studio';
import {quoteRange} from '@/lib/generation-quote';
import {pendingKey} from './submission';
import {Modal} from './common';
import {defaultDraft, statusLabels, type Asset, type Batch, type Draft, type Model, type Plan, type Skill, type Submission} from '../../packages/contracts';
import type {CanvasBoard, CanvasDocument, CanvasGroupRecord, CanvasNodeRecord} from '../../packages/canvas';
import {Button} from './ui/button';
import {FormSelect} from './form-select';
import {Popover,PopoverTrigger,PopoverContent} from './ui/popover';
import {Dialog,DialogContent,DialogTitle} from './ui/dialog';
import {currentWorkspaceId} from '@/lib/workspace-scope';
import {CanvasHistory} from '@/lib/canvas-history';
import {CanvasAutosave,whenCanvasIdle} from '@/lib/canvas-autosave';
import {CanvasSaveClient} from '@/lib/canvas-save-client';
import type {CanvasSaveGraph} from '@/lib/canvas-save-protocol';
import {mediaRatio} from '@/lib/canvas-layout';
import {arrangeCanvasNodes,canvasBackgrounds,frameCanvasBounds,layoutCanvasSelection,parseCanvasPreferences,type CanvasPreferences,type SelectionLayout} from '@/lib/canvas-interaction';
import {AccountBalance} from './account-balance';
import {useMediaQuery} from '@/lib/use-media-query';
import {CanvasSidePanel} from './canvas-side-panel';
import {Tabs,TabsList,TabsTrigger} from './ui/tabs';
import {Tooltip,TooltipTrigger,TooltipContent} from './ui/tooltip';
import {AlignLeft,AlignCenter,AlignRight,AlignStartVertical,AlignCenterVertical,AlignEndVertical,AlignHorizontalDistributeCenter,AlignVerticalDistributeCenter,Columns3,Rows3,ArrowLeftRight,ArrowUpDown} from 'lucide-react';
import './infinite-canvas.css';

type CanvasKind = CanvasNodeRecord['kind'];
type CardData = {kind:CanvasKind; title:string; text:string; assetId?:string; toolId?:string; modelId?:string; aspectRatio?:string; duration?:number; [key:string]:unknown};
type CanvasNode = Node<CardData, 'canvasCard'>;
type Filter = 'all' | 'image' | 'video';
type SaveStatus = 'loading'|'saved'|'error'|'conflict';
type Runtime = {models:Model[];skills:Skill[];assets:Asset[];batches:Batch[];refresh:()=>Promise<void>};
const runtimeContext = createContext<Runtime>(null!);
const assetContext = createContext<Map<string,Asset>>(new Map());
type CanvasActions={patch:(id:string,data:Partial<CardData>)=>void;prepare:(id:string)=>void;addResult:(id:string,asset:Asset)=>void;pickAsset:(id:string,kind:CanvasKind)=>void;resize:(id:string,width:number)=>void;beginEdit:()=>void;commit:()=>void;openAssets:(referenceTargetId?:string)=>void};
const actionContext=createContext<CanvasActions>(null!);
const kindLabel:Record<CanvasKind,string> = {image:'图片',video:'视频',text:'文字',tool:'功能'};
const kindIcons:Record<CanvasKind,LucideIcon>={text:Type,image:FileImage,video:Video,tool:WandSparkles};
const connectionColors:Record<CanvasKind,string>={text:'#4f78cc',image:'#009d91',video:'#8a63cc',tool:'#b17b27'};
function connectionColor(data:Pick<CardData,'kind'|'toolId'>){
  return connectionColors[data.toolId==='ai-image'?'image':data.toolId==='ai-video'?'video':data.kind];
}
function nodeIcon(data:Pick<CardData,'kind'|'toolId'>):LucideIcon{
  return data.toolId==='ai-video'?Video:data.toolId==='ai-image'?FileImage:kindIcons[data.kind];
}
function NodeTypeIcon({data}:{data:Pick<CardData,'kind'|'toolId'>}){const Icon=nodeIcon(data);return <Icon/>;}
function nextNodeTitle(base:string,nodes:CanvasNode[]){
  const names=new Set(nodes.map(node=>node.data.title));let suffix=1;
  while(names.has(`${base} ${suffix}`))suffix++;
  return `${base} ${suffix}`;
}
type ToolOption={id:string;label:string;shortcut:string;icon:LucideIcon;description:string;route?:string;kind?:CanvasKind};
const toolGroups:{label:string;items:ToolOption[]}[]=[
  {label:'添加节点',items:[
    {id:'image',label:'图片',shortcut:'I',icon:FileImage,description:'从素材库选择图片',kind:'image'},
    {id:'video',label:'视频',shortcut:'V',icon:Video,description:'从素材库选择视频',kind:'video'},
    {id:'text',label:'文本',shortcut:'T',icon:Type,description:'记录创意、提示词与分镜说明',kind:'text'},
    {id:'sketch',label:'画草图',shortcut:'P',icon:PenTool,description:'整理画面构图与草图想法'},
  ]},
  {label:'AI 生成',items:[
    {id:'ai-image',label:'AI 绘图',shortcut:'G',icon:FileImage,description:'在画布内生成图片',route:'/studio/image-generate'},
    {id:'ai-video',label:'AI 视频',shortcut:'B',icon:Video,description:'在画布内生成视频',route:'/studio/video-generate'},
    {id:'ai-audio',label:'AI 音频',shortcut:'M',icon:Mic2,description:'规划音频生成流程'},
  ]},
  {label:'工具',items:[
    {id:'batch-image',label:'批量绘图',shortcut:'',icon:Images,description:'规划批量出图流程'},
    {id:'upscale',label:'高清放大',shortcut:'H',icon:ScanEye,description:'使用图片超清功能',route:'/ecommerce/ec-tools-18'},
    {id:'storyboard',label:'脚本分镜',shortcut:'S',icon:Code2,description:'使用提示词工作台',route:'/agents/prompt-workbench'},
    {id:'compare',label:'图像对比',shortcut:'C',icon:Images,description:'规划图像对比流程'},
    {id:'video-analysis',label:'视频拆解',shortcut:'A',icon:Film,description:'使用视频反推功能',route:'/video-reverse'},
    {id:'panorama',label:'360°预览',shortcut:'O',icon:Globe2,description:'规划全景预览流程'},
    {id:'director',label:'导演台',shortcut:'D',icon:WandSparkles,description:'规划镜头与成片流程'},
  ]},
];
const toolById=new Map(toolGroups.flatMap(group=>group.items.map(item=>[item.id,item] as const)));
const isGenerator=(toolId?:string)=>toolId==='ai-image'||toolId==='ai-video';

const previewUrl=(asset:Asset,size=768)=>`/api/canvas-preview/${encodeURIComponent(asset.id)}?size=${size}&workspace=${encodeURIComponent(currentWorkspaceId())}`;
const resultFor=(batches:Batch[],id:string,assets:Map<string,Asset>)=>assets.get(batches.find(batch=>batch.canvasNodeId===id)?.attempts.at(-1)?.assetId||'');

const CanvasMedia=memo(function CanvasMedia({asset,title,selected,onRatio}:{asset:Asset;title:string;selected:boolean;onRatio:(ratio:number)=>void}){
  const [playing,setPlaying]=useState(false),[failed,setFailed]=useState(false);
  useEffect(()=>{if(!selected)setPlaying(false);},[selected]);
  return <>
    {!failed&&<img src={previewUrl(asset)} alt={title} draggable={false} decoding="async" onLoad={event=>onRatio(event.currentTarget.naturalWidth/event.currentTarget.naturalHeight)} onError={event=>{if(asset.type==='image'&&event.currentTarget.getAttribute('src')!==asset.url)event.currentTarget.src=asset.url;else setFailed(true);}}/>}
    {asset.type==='video'&&(playing?<video className="nodrag nowheel canvas-video-player" src={asset.url} controls autoPlay playsInline preload="none" aria-label={`${title}播放器`} onLoadedMetadata={event=>onRatio(event.currentTarget.videoWidth/event.currentTarget.videoHeight)} onError={()=>{setPlaying(false);toast.error('视频暂时无法播放，请尝试打开原文件');}}/>:<button className="canvas-play nodrag nowheel" aria-label={`播放${title}`} onClick={()=>setPlaying(true)}><Play fill="currentColor"/><span>播放视频</span></button>)}
    {failed&&asset.type==='image'&&<span className="canvas-media-error">预览加载失败</span>}
  </>;
});
function ResizeGrip({id,width,title}:{id:string;width:number;title:string}){
  const actions=useContext(actionContext),{getZoom}=useReactFlow();
  const start=useRef<{x:number;width:number}|undefined>(undefined),frame=useRef<number|undefined>(undefined),pending=useRef(width);
  useEffect(()=>()=>{if(frame.current)cancelAnimationFrame(frame.current);},[]);
  const flush=()=>{if(frame.current)cancelAnimationFrame(frame.current);frame.current=undefined;actions.resize(id,pending.current);};
  return <button className="canvas-resize nodrag nowheel" aria-label={`调整${title}宽度`} title="拖动调整尺寸，或使用左右方向键" onPointerDown={event=>{event.preventDefault();event.stopPropagation();start.current={x:event.clientX,width};pending.current=width;actions.beginEdit();event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{if(!start.current)return;pending.current=Math.max(180,Math.min(1200,start.current.width+(event.clientX-start.current.x)/getZoom()));if(!frame.current)frame.current=requestAnimationFrame(flush);}} onPointerUp={event=>{if(!start.current)return;flush();start.current=undefined;event.currentTarget.releasePointerCapture(event.pointerId);actions.commit();}} onPointerCancel={()=>{if(start.current){flush();start.current=undefined;actions.commit();}}} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();event.stopPropagation();actions.beginEdit();actions.resize(id,Math.max(180,Math.min(1200,width+(event.key==='ArrowRight'?20:-20))));actions.commit();}}><Maximize2/></button>;
}

const CanvasCard=memo(function CanvasCard({id,data,selected,width}:NodeProps<CanvasNode>){
  const assets=useContext(assetContext),runtime=useContext(runtimeContext),actions=useContext(actionContext);
  const generator=isGenerator(data.toolId),category=data.toolId==='ai-video'?'video':'image';
  const model=generator?(runtime.models.find(item=>item.id===data.modelId&&item.category===category&&item.enabled&&item.credentialConfigured&&item.relayAvailable!==false)||runtime.models.find(item=>item.category===category&&item.enabled&&item.credentialConfigured&&item.relayAvailable!==false)):undefined;
  const asset=generator?resultFor(runtime.batches,id,assets):assets.get(data.assetId||'');
  const attempt=generator?runtime.batches.find(batch=>batch.canvasNodeId===id)?.attempts.at(-1):undefined;
  const [intrinsic,setIntrinsic]=useState<{id:string;ratio:number}>();
  const [renaming,setRenaming]=useState(false);
  useEffect(()=>{if(!selected)setRenaming(false);},[selected]);
  const onRatio=useCallback((ratio:number)=>{if(asset&&ratio>0&&Number.isFinite(ratio))setIntrinsic(current=>current?.id===asset.id&&current.ratio===ratio?current:{id:asset.id,ratio});},[asset?.id]);
  const generationRatio=model?.aspectRatios.includes(data.aspectRatio||'')?data.aspectRatio:model?.aspectRatios[0];
  const ratio=asset&&intrinsic?.id===asset.id?intrinsic.ratio:mediaRatio(generator?generationRatio:data.aspectRatio,data.kind==='video'||category==='video'?16/9:1);
  const tool=toolById.get(data.toolId||'');
  const Icon=nodeIcon(data);
  return <article className={'canvas-card'+(selected?' is-selected':'')+(generator?' is-generator':'')} aria-label={data.title} style={{'--canvas-port-color':connectionColor(data)} as CSSProperties}>
    <div className="canvas-card-head canvas-node-drag"><Icon/>{renaming?<input className="canvas-node-title-input nodrag nowheel" aria-label="节点名称" autoFocus maxLength={120} value={data.title} onChange={event=>actions.patch(id,{title:event.target.value})} onBlur={()=>setRenaming(false)} onKeyDown={event=>{if(event.key==='Enter'||event.key==='Escape')setRenaming(false);}}/>:<strong title="双击重命名" onDoubleClick={()=>setRenaming(true)}>{data.title}</strong>}{data.kind==='tool'&&!generator&&<span className="canvas-node-badge">{tool?.route?'工具':'规划'}</span>}</div>
    <div className="canvas-node-body">
      <Handle className="canvas-handle is-target" type="target" position={Position.Left} aria-label={`${data.title}输入连接点`}><Plus className="canvas-handle-icon" aria-hidden="true"/></Handle>
      {data.kind==='text'?<div className={'canvas-card-text'+(selected?'':' canvas-node-drag')} style={{height:width||256}}>{selected?<textarea className="nodrag nowheel" aria-label={`${data.title}内容`} value={data.text} maxLength={10000} placeholder="在此输入文本内容…" onChange={event=>actions.patch(id,{text:event.target.value})}/>:<p>{data.text||'在此输入文本内容…'}</p>}</div>:!generator&&data.kind==='tool'?<div className="canvas-card-tool canvas-node-drag"><WandSparkles/><strong>{tool?.label||'流程节点'}</strong>{tool?.route?<Link className="nodrag nowheel" to={tool.route}>打开工具 ↗</Link>:<small>规划节点</small>}</div>:<div className={'canvas-card-media canvas-node-drag'+(!asset?' is-empty':'')} style={{aspectRatio:ratio}}>
        {asset?<CanvasMedia key={asset.id} asset={asset} title={data.title} selected={!!selected} onRatio={onRatio}/>:<><span className="canvas-generator-symbol"><NodeTypeIcon data={data}/></span><strong>{generator?(attempt?statusLabels[attempt.status]:category==='video'?'等待视频生成':'等待图片生成'):`添加${kindLabel[data.kind]}素材`}</strong>{attempt?.error&&<small>{attempt.error}</small>}{!generator&&<button className="canvas-replace-asset nodrag nowheel" onClick={()=>actions.pickAsset(id,data.kind)}><Plus/>选择素材</button>}</>}
      </div>}
      <Handle className="canvas-handle is-source" type="source" position={Position.Right} aria-label={`${data.title}输出连接点`}><Plus className="canvas-handle-icon" aria-hidden="true"/></Handle>
      {selected&&<ResizeGrip id={id} width={width||320} title={data.title}/>}
    </div>

  </article>;
},(before,after)=>before.id===after.id&&before.data===after.data&&before.selected===after.selected&&before.width===after.width);
const nodeTypes={canvasCard:CanvasCard};

function NodeInspector({node,sources,saveStatus,busyId,prepare,appendResult,focusNode,onOpenLibrary}:{node:CanvasNode;sources:CanvasNode[];saveStatus:SaveStatus;busyId?:string;prepare:(id:string)=>void;appendResult:(id:string,asset:Asset)=>void;focusNode:(id:string)=>void;onOpenLibrary:()=>void}){
  const runtime=useContext(runtimeContext),assets=useContext(assetContext),actions=useContext(actionContext),data=node.data;
  const category=data.toolId==='ai-video'?'video':'image',generator=isGenerator(data.toolId);
  const models=useMemo(()=>runtime.models.filter(model=>model.category===category&&model.enabled&&model.credentialConfigured&&model.relayAvailable!==false),[runtime.models,category]);
  const model=models.find(item=>item.id===data.modelId)||models[0];
  const ratio=model?.aspectRatios.includes(data.aspectRatio||'')?data.aspectRatio||'':model?.aspectRatios[0]||'';
  const duration=model?.durations.includes(data.duration||0)?data.duration||0:model?.durations[0]||6;
  const result=resultFor(runtime.batches,node.id,assets),asset=assets.get(data.assetId||'');
  const tool=toolById.get(data.toolId||'');
  if(data.kind==='text')return <textarea className="nodrag nowheel canvas-text-editor" key={node.id} aria-label={`${data.title}编辑内容`} autoFocus maxLength={10000} value={data.text} onChange={event=>actions.patch(node.id,{text:event.target.value})} placeholder="记录创意、提示词或分镜说明…"/>;
  if(!generator)return data.kind==='image'||data.kind==='video'?<div className="canvas-media-actions"><button onClick={()=>{onOpenLibrary();actions.pickAsset(node.id,data.kind);}}><ImagePlus/>{asset?'替换素材':'选择素材'}</button>{asset&&<a href={asset.url} target="_blank" rel="noreferrer"><ArrowUpRight/>打开原文件</a>}</div>:<div className="canvas-tool-info"><WandSparkles/><span>{tool?.label||'创作节点'}</span>{tool?.route&&<Link to={tool.route}>打开工具 ↗</Link>}</div>;
  return <>
    <div className="canvas-reference-strip" aria-label="上游参考素材"><div>{sources.map(source=>{const refAsset=assets.get(source.data.assetId||'')||resultFor(runtime.batches,source.id,assets);return <button key={source.id} title={source.data.title} aria-label={`定位参考：${source.data.title}`} onClick={()=>focusNode(source.id)}>{refAsset?<img src={previewUrl(refAsset,384)} alt={source.data.title} loading="lazy"/>:<NodeTypeIcon data={source.data}/>}<small>{source.data.title}</small></button>;})}<button className="canvas-reference-add" aria-label="打开素材库添加参考" title="添加参考素材" onClick={()=>{onOpenLibrary();actions.openAssets(node.id);}}><ImagePlus/></button></div></div>
    <div className="canvas-node-mode"><span className="is-active">{category==='video'?'视频生成':'图片生成'}</span><span>{sources.length?'参考 '+sources.length+' 项':'提示词'}</span></div>
    <textarea className="nodrag nowheel" key={node.id} aria-label={`${data.title}提示词`} maxLength={10000} rows={4} value={data.text} onChange={event=>actions.patch(node.id,{text:event.target.value})} placeholder={category==='video'?'描述画面、动作和运镜…':'描述想要生成的画面…'}/>
    <div className="canvas-prompt-footer">
      <div className="canvas-generator-settings"><FormSelect aria-label={`${data.title}模型`} value={model?.id||''} disabled={!models.length} onValueChange={id=>{const next=models.find(item=>item.id===id);if(next)actions.patch(node.id,{modelId:next.id,aspectRatio:next.aspectRatios[0],duration:next.durations[0]||6});}} placeholder="选择模型" options={models.map(item=>({value:item.id,label:item.name}))}/>
      <Popover><PopoverTrigger asChild><button className="canvas-parameter-trigger" aria-label={`${data.title}生成参数`}><Settings2/>{ratio||'画幅'}{category==='video'?` · ${duration}s`:''}<ChevronDown/></button></PopoverTrigger><PopoverContent className="canvas-parameter-popover" side="top" align="start"><strong>生成参数</strong><fieldset className="canvas-ratio-options"><legend>画幅</legend>{(model?.aspectRatios||[]).map(value=><label key={value}><input type="radio" name={'ratio-'+node.id} aria-label={'画幅 '+value} checked={ratio===value} onChange={()=>actions.patch(node.id,{aspectRatio:value})}/><span>{value}</span></label>)}</fieldset>{category==='video'&&<fieldset className="canvas-ratio-options"><legend>时长</legend>{(model?.durations||[]).map(value=><label key={value}><input type="radio" name={'duration-'+node.id} aria-label={'时长 '+value+' 秒'} checked={duration===value} onChange={()=>actions.patch(node.id,{duration:value})}/><span>{value}s</span></label>)}</fieldset>}</PopoverContent></Popover></div>
      <span className="canvas-provider-label">{model?.provider==='token01'?'Token01':model?'初和':'未配置'}</span>
      {model?<button className="canvas-generate-button" aria-label={busyId===node.id?'查询报价中':'预览生成费用'} title="预览费用，确认后生成" disabled={saveStatus!=='saved'||!!busyId} onClick={()=>prepare(node.id)}>{busyId===node.id?<RefreshCw className="spin"/>:<ArrowUp/>}</button>:<Link to="/models">配置模型 ↗</Link>}
    </div>
    {result&&<button className="canvas-add-result" onClick={()=>appendResult(node.id,result)}>将结果加入画布 <Plus/></button>}
  </>;
}

function SelectionOverlay({node,count,sources,status,busyId,prepare,appendResult,focusNode,duplicate,remove,close,editorOpen,toggleEditor,nodes,canGroup,grouped,groupFrame,onGroup,onUngroup,onLayout,onFocus}:{node:CanvasNode;count:number;sources:CanvasNode[];status:SaveStatus;busyId?:string;prepare:(id:string)=>void;appendResult:(id:string,asset:Asset)=>void;focusNode:(id:string)=>void;duplicate:()=>void;remove:()=>void;close:()=>void;editorOpen:boolean;toggleEditor:()=>void;nodes:CanvasNode[];canGroup:boolean;grouped:boolean;groupFrame?:{left:number;top:number;width:number;height:number};onGroup:()=>void;onUngroup:()=>void;onLayout:(action:SelectionLayout)=>void;onFocus:()=>void}){
  const [expanded,setExpanded]=useState(false);
  const selected=nodes.filter(item=>item.selected);
  const bounds=groupFrame||{left:Math.min(...selected.map(item=>item.position.x)),top:Math.min(...selected.map(item=>item.position.y)),width:Math.max(...selected.map(item=>item.position.x+(item.measured?.width||item.width||Number(item.style?.width)||320)))-Math.min(...selected.map(item=>item.position.x)),height:Math.max(...selected.map(item=>item.position.y+(item.measured?.height||300)))-Math.min(...selected.map(item=>item.position.y))};
  const editorWidth=Math.max(700,bounds.width+64);
  const inspector=<NodeInspector node={node} sources={sources} saveStatus={status} busyId={busyId} prepare={prepare} appendResult={appendResult} focusNode={id=>{setExpanded(false);focusNode(id);}} onOpenLibrary={()=>setExpanded(false)}/>;
  return <><ViewportPortal><div className="canvas-node-overlays" style={{transform:`translate(${bounds.left}px, ${bounds.top}px)`,width:bounds.width}}>
    <div className="canvas-selectionbar canvas-floating" aria-label="所选元素操作">{count>1&&<><strong>{count} 个元素</strong><IconButton label="定位所选元素" onClick={onFocus}><Maximize2/></IconButton></>}{canGroup&&<IconButton label="将所选元素编为一组" onClick={onGroup}><Layers3/></IconButton>}{grouped&&<IconButton label="取消所选分组" onClick={onUngroup}><Layers3/></IconButton>}{count===1&&<button className={'canvas-edit-action'+(editorOpen?' is-active':'')} aria-label={node.data.kind==='text'?'展开文本编辑':editorOpen?'收起节点编辑':'展开节点编辑'} aria-pressed={node.data.kind==='text'?expanded:editorOpen} onClick={()=>node.data.kind==='text'?setExpanded(true):toggleEditor()}>{node.data.kind==='text'?<SquarePen/>:<Settings2/>}<span>{node.data.kind==='text'?'编辑文本':'编辑'}</span></button>}<IconButton label="复制所选元素" onClick={duplicate}><Copy/></IconButton><Popover><PopoverTrigger asChild><button className="canvas-icon-button" aria-label="所选元素更多操作"><MoreHorizontal/></button></PopoverTrigger><PopoverContent className="canvas-context-menu canvas-selection-menu" side="top" align="center"><button className="is-danger" onClick={remove}><Trash2/>删除所选元素</button></PopoverContent></Popover><IconButton label="取消选择" onClick={close}><X/></IconButton></div>
    {count>1&&<div className="canvas-alignmentbar canvas-floating nodrag nopan nowheel" aria-label="所选元素排版">{([
      ['对齐',[['left','左对齐',AlignLeft],['center','水平居中',AlignCenter],['right','右对齐',AlignRight],['top','顶对齐',AlignStartVertical],['middle','垂直居中',AlignCenterVertical],['bottom','底对齐',AlignEndVertical]]],
      ['均分',[['distribute-x','横向均分',AlignHorizontalDistributeCenter],['distribute-y','纵向均分',AlignVerticalDistributeCenter]]],
      ['整理',[['row','横向整理',Columns3],['column','纵向整理',Rows3]]],
      ['间距',[['gap-x-80','水平间距 80',ArrowLeftRight],['gap-x-160','水平间距 160',ArrowLeftRight],['gap-y-80','垂直间距 80',ArrowUpDown],['gap-y-160','垂直间距 160',ArrowUpDown]]],
    ] as const).map(([label,items])=><div key={label}><span>{label}</span>{items.map(([action,title,Icon])=><button key={action} title={title} aria-label={title} disabled={action.startsWith('distribute')&&count<3} onClick={()=>onLayout(action)}><Icon/>{action.startsWith('gap')&&<small>{action.split('-').at(-1)}</small>}</button>)}</div>)}</div>}
    {count===1&&editorOpen&&node.data.kind!=='text'&&!expanded&&<section className="canvas-node-editor canvas-floating nodrag nopan nowheel" style={{top:(node.measured?.height||300)+(isGenerator(node.data.toolId)?84:14),width:editorWidth,left:(bounds.width-editorWidth)/2}} role="region" aria-label={`${node.data.title}编辑面板`}>
      <button className="canvas-expand-editor" aria-label="展开输入框" title="展开输入框" onClick={()=>setExpanded(true)}><Maximize2/></button>
      {inspector}
    </section>}
  </div></ViewportPortal>
    <Dialog open={expanded&&count===1} onOpenChange={setExpanded}><DialogContent className="canvas-expanded-dialog" showCloseButton={false} aria-describedby={undefined}>
      <DialogTitle className="sr-only">{node.data.title}展开编辑</DialogTitle>
      <div className="canvas-node-editor canvas-expanded-editor">
        <button className="canvas-expand-editor" aria-label="收起输入框" title="收起输入框" onClick={()=>setExpanded(false)}><Minimize2/></button>
        {inspector}
      </div>
    </DialogContent></Dialog>
  </>;
}

const edgeStyle={stroke:'#9bafba'};
function CanvasConnectionEdge({id,source,sourceX,sourceY,targetX,targetY,sourcePosition,targetPosition,style}:EdgeProps){
  const color=useStore(state=>{const node=state.nodeLookup.get(source);return node?connectionColor(node.data as CardData):edgeStyle.stroke;});
  // React Flow anchors to the hit area's outer edge; draw through its centre.
  const [path]=getBezierPath({sourceX:sourceX-24,sourceY,targetX:targetX+24,targetY,sourcePosition,targetPosition});
  return <BaseEdge id={id} path={path} style={{...style,stroke:color,'--canvas-edge-color':color} as CSSProperties} interactionWidth={24}/>;
}
const edgeTypes={canvasConnection:CanvasConnectionEdge};
const defaultEdgeOptions={type:'canvasConnection',style:edgeStyle};
const grid:[number,number]=[10,10];

function NodePicker({menu,onChoose,onClose,onArrange,onUpload,onDuplicate}:{menu:{x:number;y:number;maxHeight:number;sourceId?:string};onChoose:(option:ToolOption)=>void;onClose:()=>void;onArrange:()=>void;onUpload:()=>void;onDuplicate?:()=>void}){
  return <div className="canvas-node-picker canvas-floating" style={{left:menu.x,top:menu.y,maxHeight:menu.maxHeight}} role="dialog" aria-label={menu.sourceId?'选择下游节点':'添加节点'}>
    <div className="canvas-panel-heading"><strong>{menu.sourceId?'选择下游节点':'添加节点'}</strong><button aria-label="关闭节点选择" onClick={onClose}><X/></button></div>
    <div className="canvas-node-picker-scroll">{!menu.sourceId&&<section>{onDuplicate&&<button onClick={onDuplicate}><Copy/><span>复制所选节点</span><kbd>⌘ D</kbd></button>}<button onClick={onArrange}><LayoutGrid/><span>自动整理节点</span></button><button onClick={onUpload}><UploadCloud/><span>上传图片</span></button></section>}{toolGroups.map(group=>({...group,items:menu.sourceId?group.items.filter(item=>item.kind||isGenerator(item.id)):group.items})).filter(group=>group.items.length).map(group=><section key={group.label}><h3>{group.label}</h3>{group.items.map(item=><button key={item.id} onClick={()=>onChoose(item)} title={item.description}><item.icon/><span>{item.label}</span>{!item.route&&!item.kind&&!isGenerator(item.id)?<small>规划</small>:item.shortcut&&<kbd>{item.shortcut}</kbd>}</button>)}</section>)}</div>
  </div>;
}

function CanvasConnectionLine({fromNode,fromX,fromY,toX,toY,fromPosition,toPosition}:ConnectionLineComponentProps<CanvasNode>){
  const [path]=getBezierPath({sourceX:fromX,sourceY:fromY,sourcePosition:fromPosition,targetX:toX,targetY:toY,targetPosition:toPosition});
  return <path d={path} fill="none" stroke={connectionColor(fromNode.data)} strokeWidth={3} strokeLinecap="round" strokeDasharray="6 5" vectorEffect="non-scaling-stroke"/>;
}

function PendingConnection({node,point}:{node:CanvasNode;point:{x:number;y:number}}){
  const width=node.measured?.width||node.width||Number(node.style?.width)||320;
  const height=node.measured?.height||300;
  const [path]=getBezierPath({sourceX:node.position.x+width+22,sourceY:node.position.y+34+(height-34)/2,sourcePosition:Position.Right,targetX:point.x,targetY:point.y,targetPosition:Position.Left});
  return <ViewportPortal><svg className="canvas-pending-connection" style={{color:connectionColor(node.data)}} aria-label="待连接的下游节点" width="1" height="1"><path d={path}/><circle cx={point.x} cy={point.y} r="5"/></svg></ViewportPortal>;
}

function IconButton({label,active,children,onClick,disabled,tooltipSide='top'}:{label:string;active?:boolean;children:ReactNode;onClick:()=>void;disabled?:boolean;tooltipSide?:'top'|'right'}){
  return <Tooltip><TooltipTrigger asChild><button type="button" className={'canvas-icon-button'+(active?' is-active':'')} aria-label={label} aria-pressed={active} onClick={onClick} disabled={disabled}>{children}</button></TooltipTrigger><TooltipContent side={tooltipSide} sideOffset={8}>{label}</TooltipContent></Tooltip>;
}
function ZoomControls(){
  const {zoom}=useViewport(),{zoomTo}=useReactFlow();
  return <button className="canvas-zoom-value" title="重置缩放为 100%" aria-label="重置缩放为 100%" onClick={()=>void zoomTo(1,{duration:0})}>{Math.round(zoom*100)}%</button>;
}

const toFlowNode=(node:CanvasNodeRecord):CanvasNode=>({id:node.id,type:'canvasCard',position:{x:node.x,y:node.y},data:{kind:node.kind,title:node.title,text:node.text,assetId:node.assetId,toolId:node.toolId,modelId:node.modelId,aspectRatio:node.aspectRatio,duration:node.duration},dragHandle:'.canvas-node-drag',style:{width:node.width||(isGenerator(node.toolId)?640:node.kind==='text'?256:560)}});
const toRecord=(node:CanvasNode):CanvasNodeRecord=>({id:node.id,kind:node.data.kind,title:node.data.title.trim()||'未命名节点',text:node.data.text,assetId:node.data.assetId,toolId:node.data.toolId,modelId:node.data.modelId,aspectRatio:node.data.aspectRatio,duration:node.data.duration,x:node.position.x,y:node.position.y,width:typeof node.style?.width==='number'?node.style.width:node.width});
type GraphSnapshot={nodes:CanvasNodeRecord[];edges:{id:string;source:string;target:string}[];groups:CanvasGroupRecord[];selected:string[]};
function groupBounds(group:CanvasGroupRecord,nodes:CanvasNode[]){
  const memberIds=new Set(group.memberIds);
  const members=nodes.filter(node=>memberIds.has(node.id));
  if(!members.length)return;
  const left=Math.min(...members.map(node=>node.position.x))-30;
  const top=Math.min(...members.map(node=>node.position.y))-52;
  const right=Math.max(...members.map(node=>node.position.x+(node.measured?.width||node.width||Number(node.style?.width)||320)))+30;
  const bottom=Math.max(...members.map(node=>node.position.y+(node.measured?.height||300)))+30;
  return {left,top,width:right-left,height:bottom-top};
}
function useReducedMotion(){
  const [reduced,setReduced]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(()=>{const media=window.matchMedia('(prefers-reduced-motion: reduce)'),changed=()=>setReduced(media.matches);media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed);},[]);
  return reduced;
}

function useStableContent<T>(value:T):T{
  const cache=useRef<{input:T;signature:string;value:T}>(undefined);
  if(cache.current?.input===value)return cache.current.value;
  const signature=JSON.stringify(value);
  if(!cache.current||cache.current.signature!==signature)cache.current={input:value,signature,value};
  else cache.current.input=value;
  return cache.current.value;
}

function GroupFrame({group,nodes,onBegin,onMove,onEnd,onRename,onUngroup,onSelect}:{group:CanvasGroupRecord;nodes:CanvasNode[];onBegin:()=>void;onMove:(id:string,dx:number,dy:number)=>void;onEnd:()=>void;onRename:(id:string,title:string)=>void;onUngroup:(id:string)=>void;onSelect:()=>void}){
  const {getZoom}=useReactFlow();
  const last=useRef<{x:number;y:number}|undefined>(undefined),pending=useRef({x:0,y:0}),frame=useRef<number|undefined>(undefined);
  const [draft,setDraft]=useState(group.title);
  const bounds=groupBounds(group,nodes);
  useEffect(()=>()=>{if(frame.current)cancelAnimationFrame(frame.current);},[]);
  useEffect(()=>setDraft(group.title),[group.title]);
  const flush=()=>{if(frame.current)cancelAnimationFrame(frame.current);frame.current=undefined;const delta=pending.current;pending.current={x:0,y:0};if(delta.x||delta.y)onMove(group.id,delta.x,delta.y);};
  if(!bounds)return null;
  return <div className="canvas-group-frame" style={{transform:`translate(${bounds.left}px, ${bounds.top}px)`,width:bounds.width,height:bounds.height}} aria-label={'分组 '+group.title}>
    <div className="canvas-group-header nodrag nopan" onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}>
      <button type="button" className="canvas-group-grip" aria-label={'移动分组 '+group.title} title="拖动整个分组" onPointerDown={event=>{event.preventDefault();event.stopPropagation();last.current={x:event.clientX,y:event.clientY};onBegin();event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{if(!last.current)return;const zoom=getZoom();pending.current.x+=(event.clientX-last.current.x)/zoom;pending.current.y+=(event.clientY-last.current.y)/zoom;last.current={x:event.clientX,y:event.clientY};if(!frame.current)frame.current=requestAnimationFrame(flush);}} onPointerUp={event=>{if(!last.current)return;flush();last.current=undefined;event.currentTarget.releasePointerCapture(event.pointerId);onEnd();}} onPointerCancel={()=>{if(last.current){flush();last.current=undefined;onEnd();}}}><Hand/></button>
      <input aria-label={'分组名称 '+group.title} value={draft} maxLength={80} onChange={event=>setDraft(event.target.value)} onBlur={()=>onRename(group.id,draft.trim()||'未命名分组')} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}}/>
      <button className="canvas-group-select" aria-label={'选择分组 '+group.title} onClick={onSelect}>{group.memberIds.length} 个元素</button>
      <button type="button" aria-label={'取消分组 '+group.title} title="取消分组，保留节点" onClick={()=>onUngroup(group.id)}><X/></button>
    </div>
  </div>;
}

export function InfiniteCanvas(){
  const studio=useStudio(),refreshRef=useRef(studio.refresh);
  refreshRef.current=studio.refresh;
  const refresh=useCallback(()=>refreshRef.current(),[]);
  // Reuse unchanged collections so polling a task cannot invalidate media cards.
  const [boards,setBoards]=useState<CanvasBoard[]>([]),[boardId,setBoardId]=useState('main');
  const models=useStableContent(studio.boot.models),skills=useStableContent(studio.boot.skills),assets=useStableContent(studio.snapshot.assets);
  const batches=useStableContent(studio.snapshot.batches.filter(batch=>batch.canvasNodeId&&(batch.canvasBoardId||'main')===boardId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
  const runtime=useMemo(()=>({models,skills,assets,batches,refresh}),[models,skills,assets,batches,refresh]);
  useEffect(()=>{let cancelled=false;void api<CanvasBoard[]>('/canvas/boards').then(list=>{if(cancelled)return;setBoards(list);const saved=localStorage.getItem('canvas-board:'+currentWorkspaceId());if(saved&&list.some(board=>board.id===saved))setBoardId(saved);}).catch(error=>toast.error((error as Error).message));return()=>{cancelled=true;};},[]);
  const chooseBoard=useCallback((id:string)=>{localStorage.setItem('canvas-board:'+currentWorkspaceId(),id);setBoardId(id);},[]);
  return <runtimeContext.Provider value={runtime}><ReactFlowProvider key={boardId}><CanvasEditor key={boardId} boardId={boardId} boards={boards} setBoards={setBoards} chooseBoard={chooseBoard}/></ReactFlowProvider></runtimeContext.Provider>;
}

const CanvasEditor=memo(function CanvasEditor({boardId,boards,setBoards,chooseBoard}:{boardId:string;boards:CanvasBoard[];setBoards:(boards:CanvasBoard[])=>void;chooseBoard:(id:string)=>void}){
  const runtime=useContext(runtimeContext);
  const assets=useMemo(()=>runtime.assets.filter(asset=>asset.type==='image'||asset.type==='video').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),[runtime.assets]);
  const assetMap=useMemo(()=>new Map(assets.map(asset=>[asset.id,asset])),[assets]);
  const [nodes,setNodes,applyNodeChanges]=useNodesState<CanvasNode>([]);
  const [edges,setEdges,applyEdgeChanges]=useEdgesState<Edge>([]);
  const [groups,setGroups]=useState<CanvasGroupRecord[]>([]);
  const [viewport,setViewport]=useState<Viewport>({x:0,y:0,zoom:1});
  const [loaded,setLoaded]=useState(false);
  const [status,setStatus]=useState<SaveStatus>('loading');
  const narrow=useMediaQuery('(max-width: 760px)');
  const [panel,setPanel]=useState<'elements'|'assets'|undefined>(()=>window.matchMedia('(max-width: 760px)').matches?undefined:'elements');
  useEffect(()=>{if(narrow)setPanel(undefined);},[narrow]);
  const [elementType,setElementType]=useState('all'),[searchOpen,setSearchOpen]=useState(false);
  const [contextMenu,setContextMenu]=useState<{x:number;y:number;hasSelection:boolean}>();
  const [filter,setFilter]=useState<Filter>('all'),[search,setSearch]=useState('');
  const [mode,setMode]=useState<'select'|'pan'>('select');
  const [preferences,setPreferences]=useState<CanvasPreferences>(()=>{try{return parseCanvasPreferences(JSON.parse(localStorage.getItem('canvas-preferences')||'null'));}catch{return parseCanvasPreferences(null);}});
  const {minimap:showMinimap,edges:showEdges,snap,performance,operation,toolbar,background,panelWidth}=preferences;
  const updatePreferences=useCallback((patch:Partial<CanvasPreferences>)=>setPreferences(current=>({...current,...patch})),[]);
  useEffect(()=>{try{localStorage.setItem('canvas-preferences',JSON.stringify(preferences));}catch{/* A full browser cache does not block editing. */}},[preferences]);
  const [settings,setSettings]=useState(false),[shortcuts,setShortcuts]=useState(false);
  const [boardDialog,setBoardDialog]=useState<'create'|'rename'|'delete'>(),[boardName,setBoardName]=useState(''),[boardBusy,setBoardBusy]=useState(false);
  const [editorOpen,setEditorOpen]=useState(true),[focused,setFocused]=useState(false);
  const reducedMotion=useReducedMotion();
  const [,setHistoryVersion]=useState(0);
  const history=useRef(new CanvasHistory<GraphSnapshot>(snapshot=>JSON.stringify({nodes:snapshot.nodes,edges:snapshot.edges,groups:snapshot.groups})));
  useEffect(()=>{const shell=stageRef.current?.closest('.app-shell');shell?.classList.toggle('is-canvas-focused',focused);return()=>shell?.classList.remove('is-canvas-focused');},[focused]);
  const [targetId,setTargetId]=useState<string>(),[referenceTargetId,setReferenceTargetId]=useState<string>(),[busyId,setBusyId]=useState<string>();
  const [preview,setPreview]=useState<{nodeId:string;skill:Skill;draft:Draft;plan:Plan;key:string}>();
  const [nodeMenu,setNodeMenu]=useState<{x:number;y:number;maxHeight:number;point?:{x:number;y:number};sourceId?:string}>();
  const [loadAttempt,setLoadAttempt]=useState(0);
  const stageRef=useRef<HTMLDivElement>(null),uploadRef=useRef<HTMLInputElement>(null);
  const panelWidthRef=useRef(panelWidth);
  const syncPanelWidth=useCallback((width:number)=>{
    panelWidthRef.current=width;
    stageRef.current?.style.setProperty('--canvas-panel-width',`${width}px`);
  },[]);
  const commitPanelWidth=useCallback((width:number)=>updatePreferences({panelWidth:Math.round(width)}),[updatePreferences]);
  const autosave=useRef<CanvasAutosave<CanvasSaveGraph>|undefined>(undefined);
  const graphRef=useRef({nodes,edges,groups,viewport});graphRef.current={nodes,edges,groups,viewport};
  const groupsRef=useRef(groups);groupsRef.current=groups;
  const {screenToFlowPosition,fitView,setViewport:setFlowViewport}=useReactFlow<CanvasNode,Edge>();
  const markEdited=useCallback(()=>autosave.current?.markDirty(),[]);
  const takeSnapshot=useCallback(():GraphSnapshot=>{const graph=graphRef.current;return {nodes:graph.nodes.map(toRecord),edges:graph.edges.map(({id,source,target})=>({id,source,target})),groups:graph.groups,selected:graph.nodes.filter(node=>node.selected).map(node=>node.id)};},[]);
  const beginEdit=useCallback((key?:string)=>{history.current.record(takeSnapshot(),key);setHistoryVersion(value=>value+1);},[takeSnapshot]);
  const editNodes=useCallback((update:SetStateAction<CanvasNode[]>,key?:string)=>{beginEdit(key);setNodes(update);markEdited();},[setNodes,markEdited,beginEdit]);
  const editEdges=useCallback((update:SetStateAction<Edge[]>)=>{beginEdit();setEdges(update);markEdited();},[setEdges,markEdited,beginEdit]);
  const editGroups=useCallback((update:SetStateAction<CanvasGroupRecord[]>,key?:string)=>{beginEdit(key);setGroups(update);markEdited();},[beginEdit,markEdited]);
  const onNodesChange=useCallback((changes:NodeChange<CanvasNode>[])=>{
    if(changes.some(change=>['remove','add','replace'].includes(change.type)||(change.type==='position'&&change.dragging===undefined)))beginEdit();
    applyNodeChanges(changes);
    const removed=new Set(changes.filter(change=>change.type==='remove').map(change=>change.id));
    if(removed.size)setGroups(current=>current.map(group=>({...group,memberIds:group.memberIds.filter(id=>!removed.has(id))})).filter(group=>group.memberIds.length));
    // Positions and measurements are transient during a gesture; save only the commit.
    if(changes.some(change=>['remove','add','replace'].includes(change.type)||(change.type==='position'&&change.dragging!==true)))markEdited();
  },[applyNodeChanges,markEdited,beginEdit]);
  const onEdgesChange=useCallback((changes:EdgeChange[])=>{if(changes.some(change=>change.type!=='select'))beginEdit();applyEdgeChanges(changes);if(changes.some(change=>change.type!=='select'))markEdited();},[applyEdgeChanges,markEdited,beginEdit]);
  const patchNode=useCallback((id:string,patch:Partial<CardData>)=>editNodes(current=>current.map(node=>node.id===id?{...node,data:{...node.data,...patch}}:node),`field:${id}:${Object.keys(patch).join(',')}`),[editNodes]);
  const resizeNode=useCallback((id:string,width:number)=>setNodes(current=>current.map(node=>node.id===id?{...node,width,style:{...node.style,width}}:node)),[setNodes]);
  const pickAsset=useCallback((id:string,kind:CanvasKind)=>{setReferenceTargetId(undefined);setTargetId(id);setFilter(kind as Filter);setPanel('assets');setSearch('');},[]);
  const openAssets=useCallback((referenceTargetId?:string)=>{setReferenceTargetId(referenceTargetId);setTargetId(undefined);setFilter(referenceTargetId?'image':'all');setPanel('assets');setSearch('');},[]);
  const interacting=useCallback((value:boolean)=>{stageRef.current?.classList.toggle('is-interacting',value);autosave.current?.setInteracting(value);},[]);
  const openContextMenu=useCallback((event:ReactMouseEvent|MouseEvent,hasSelection=false)=>{
    event.preventDefault();event.stopPropagation();
    const rect=stageRef.current?.getBoundingClientRect();if(!rect)return;
    setNodeMenu(undefined);setSettings(false);
    setContextMenu({x:Math.max(12,Math.min(event.clientX-rect.left,rect.width-232)),y:Math.max(12,Math.min(event.clientY-rect.top,rect.height-350)),hasSelection});
  },[]);
  function arrangeNodes(){editNodes(current=>arrangeCanvasNodes(current,graphRef.current.edges,groupsRef.current));setContextMenu(undefined);setNodeMenu(undefined);}
  function layoutSelected(action:SelectionLayout){const ids=new Set(nodes.filter(node=>node.selected).map(node=>node.id));editNodes(current=>layoutCanvasSelection(current,ids,action));}
  function restore(direction:'undo'|'redo'){
    const snapshot=history.current[direction](takeSnapshot());if(!snapshot)return;
    setNodes(snapshot.nodes.map(record=>({...toFlowNode(record),selected:snapshot.selected.includes(record.id)})));
    setEdges(snapshot.edges.map(edge=>({...edge,...defaultEdgeOptions})));setGroups(snapshot.groups);setHistoryVersion(value=>value+1);markEdited();
  }
  function groupSelected(){
    const ids=nodes.filter(node=>node.selected).map(node=>node.id);
    if(ids.length<2)return;
    if(groups.some(group=>group.memberIds.some(id=>ids.includes(id)))){toast.error('请先取消已有分组，再重新选择节点');return;}
    editGroups(current=>[...current,{id:crypto.randomUUID(),title:'新分组',memberIds:ids}]);
  }
  const ungroup=useCallback((id:string)=>editGroups(current=>current.filter(group=>group.id!==id)),[editGroups]);
  const renameGroup=useCallback((id:string,title:string)=>{if(groupsRef.current.find(group=>group.id===id)?.title!==title)editGroups(current=>current.map(group=>group.id===id?{...group,title}:group),'group:'+id);},[editGroups]);
  const shiftGroup=useCallback((id:string,dx:number,dy:number)=>{
    const members=new Set(groupsRef.current.find(group=>group.id===id)?.memberIds||[]);
    setNodes(current=>current.map(node=>members.has(node.id)?{...node,position:{x:node.position.x+dx,y:node.position.y+dy}}:node));
  },[setNodes]);
  async function switchBoard(id:string){
    if(id===boardId)return;
    try{await flushCanvas();chooseBoard(id);}catch{/* Save errors are reported by the controller. */}
  }
  async function openBoardDialog(kind:'create'|'rename'|'delete'){
    try{await flushCanvas();setBoardName(kind==='create'?'':boards.find(board=>board.id===boardId)?.name||'主画布');setBoardDialog(kind);}catch{/* Keep the current board open. */}
  }
  async function flushCanvas(){
    if(!autosave.current)throw new Error('画布尚未加载完成');
    await autosave.current.flush();
  }
  async function retrySave(){
    if(!loaded){setLoadAttempt(value=>value+1);return;}
    try{await autosave.current?.retry();setStatus('saved');}catch{/* The error remains visible. */}
  }
  async function submitBoardDialog(){
    if(!boardDialog||boardBusy)return;
    const name=boardName.trim();
    if(boardDialog!=='delete'&&!name){toast.error('请输入画布名称');return;}
    setBoardBusy(true);
    try{
      if(boardDialog==='create'){
        const board=await api<CanvasBoard>('/canvas/boards',{name});
        setBoards([...boards,board]);chooseBoard(board.id);
      }else if(boardDialog==='rename'){
        const board=await api<CanvasBoard>('/canvas/boards/'+boardId,{name},'PATCH');
        setBoards(boards.map(item=>item.id===boardId?board:item));
      }else{
        await api('/canvas/boards/'+boardId,{},'DELETE');
        setBoards(boards.filter(board=>board.id!==boardId));chooseBoard('main');
      }
      setBoardDialog(undefined);
    }catch(error){toast.error((error as Error).message);}finally{setBoardBusy(false);}
  }

  useEffect(()=>{
    let cancelled=false;
    let controller:CanvasAutosave<CanvasSaveGraph>|undefined;
    let client:CanvasSaveClient|undefined;
    setStatus('loading');
    void api<CanvasDocument>('/canvas/'+boardId).then(document=>{
      if(cancelled)return;
      client=new CanvasSaveClient(boardId,document.revision);
      controller=new CanvasAutosave<CanvasSaveGraph>({read:()=>graphRef.current,save:graph=>client!.save(graph),idle:whenCanvasIdle,onError:error=>{
        if(!cancelled)setStatus(error instanceof ApiError&&error.status===409?'conflict':'error');
        toast.error((error as Error).message);
      }});
      autosave.current=controller;
      setNodes(document.nodes.map(toFlowNode));setEdges(document.edges.map(edge=>({...edge,...defaultEdgeOptions})));setGroups(document.groups||[]);setViewport(document.viewport);setLoaded(true);setStatus('saved');
    }).catch(error=>{if(!cancelled){setStatus('error');toast.error((error as Error).message);}});
    const releasePointer=()=>controller?.setInteracting(false,'pointer');
    const beforeUnload=(event:BeforeUnloadEvent)=>{if(controller?.dirty){event.preventDefault();event.returnValue='';}};
    const visibility=()=>{if(document.visibilityState==='hidden')void controller?.flush().catch(()=>{});};
    window.addEventListener('pointerup',releasePointer);window.addEventListener('pointercancel',releasePointer);
    window.addEventListener('blur',releasePointer);window.addEventListener('beforeunload',beforeUnload);document.addEventListener('visibilitychange',visibility);
    return()=>{
      cancelled=true;autosave.current=undefined;
      window.removeEventListener('pointerup',releasePointer);window.removeEventListener('pointercancel',releasePointer);
      window.removeEventListener('blur',releasePointer);window.removeEventListener('beforeunload',beforeUnload);document.removeEventListener('visibilitychange',visibility);
      // Keep this board's worker alive until queued edits have reached storage on SPA navigation.
      if(controller)void controller.close().catch(()=>{}).finally(()=>client?.destroy());else client?.destroy();
    };
  },[boardId,loadAttempt,setEdges,setNodes]);

  function addNode(kind:CanvasKind,assetId?:string,point?:{x:number;y:number},toolId?:string,sourceId?:string,frame=true){
    const rect=stageRef.current?.getBoundingClientRect();
    const center=point??screenToFlowPosition({x:(rect?.left||0)+((rect?.width||800)+(panel?panelWidthRef.current:0))/2,y:(rect?.top||0)+(rect?.height||600)/2});
    const id=crypto.randomUUID(),title=nextNodeTitle(kind==='text'?'文本':kind==='video'?'视频素材':kind==='tool'?toolById.get(toolId||'')?.label||'功能节点':'图片素材',graphRef.current.nodes);
    const model=isGenerator(toolId)?runtime.models.find(item=>item.category===(toolId==='ai-video'?'video':'image')&&item.enabled&&item.credentialConfigured&&item.relayAvailable!==false):undefined;
    const width=isGenerator(toolId)?640:kind==='text'?256:560;
    const next=toFlowNode({id,kind,title,text:'',assetId,toolId,modelId:model?.id,aspectRatio:model?.aspectRatios[0],duration:model?.durations[0],x:point?center.x:center.x-width/2,y:point?center.y:center.y-estimatedHeight(kind,toolId,width,model?.aspectRatios[0])/2});
    next.selected=true;setEditorOpen(true);
    editNodes(current=>[...current.map(node=>node.selected?{...node,selected:false}:node),next]);
    if(sourceId)editEdges(current=>addEdge({id:crypto.randomUUID(),source:sourceId,target:id,...defaultEdgeOptions},current));
    setTargetId(undefined);setNodeMenu(undefined);if(frame)frameNode(next,0);return id;
  }
  function openNodeMenu(sourceId?:string,clientX?:number,clientY?:number){
    const rect=stageRef.current?.getBoundingClientRect();if(!rect)return;
    const x=clientX??rect.left+(panel?panelWidthRef.current:0)+96,y=clientY??rect.top+100,maxHeight=Math.max(160,Math.min(sourceId?400:620,rect.height-100));
    const localX=x-rect.left;
    const menuX=sourceId?(localX+268<rect.width?localX+18:localX-268):localX;
    setNodeMenu({x:Math.max(12,Math.min(menuX,rect.width-264)),y:Math.max(76,Math.min(y-rect.top,rect.height-maxHeight-12)),maxHeight,point:clientX===undefined?undefined:screenToFlowPosition({x,y}),sourceId});setSettings(false);
  }
  function connectionEnded(event:MouseEvent|TouchEvent,state:FinalConnectionState){
    if(!state.fromNode||state.toNode||state.fromHandle?.type!=='source')return;
    const touch='changedTouches' in event?event.changedTouches[0]:null;
    openNodeMenu(state.fromNode.id,touch?.clientX??(event as MouseEvent).clientX,touch?.clientY??(event as MouseEvent).clientY);
  }
  function chooseTool(option:ToolOption){const id=addNode(option.kind||'tool',undefined,nodeMenu?.point,option.kind?undefined:option.id,nodeMenu?.sourceId);if(option.kind==='image'||option.kind==='video')pickAsset(id,option.kind);}
  function removeSelected(){
    const ids=new Set(nodes.filter(node=>node.selected).map(node=>node.id));
    editNodes(current=>current.filter(node=>!ids.has(node.id)));editEdges(current=>current.filter(edge=>!edge.selected&&!ids.has(edge.source)&&!ids.has(edge.target)));setTargetId(undefined);
    setGroups(current=>current.map(group=>({...group,memberIds:group.memberIds.filter(id=>!ids.has(id))})).filter(group=>group.memberIds.length));
  }
  function duplicateSelected(){
    const selected=nodes.filter(node=>node.selected),ids=new Map(selected.map(node=>[node.id,crypto.randomUUID()]));
    if(!selected.length)return;
    const left=Math.min(...selected.map(node=>node.position.x));
    const right=Math.max(...selected.map(node=>node.position.x+(node.measured?.width||node.width||Number(node.style?.width)||320)));
    const offsetX=right-left+80;
    const copiedGroup=groups.find(group=>group.memberIds.length===selected.length&&group.memberIds.every(id=>ids.has(id)));
    editNodes(current=>[...current.map(node=>node.selected?{...node,selected:false}:node),...selected.map(node=>({...node,id:ids.get(node.id)!,position:{x:node.position.x+offsetX,y:node.position.y+20},data:{...node.data,title:node.data.title+' 副本'},selected:true}))]);
    editEdges(current=>[...current,...current.filter(edge=>ids.has(edge.source)&&ids.has(edge.target)).map(edge=>({...edge,id:crypto.randomUUID(),source:ids.get(edge.source)!,target:ids.get(edge.target)!}))]);
    if(copiedGroup)setGroups(current=>[...current,{...copiedGroup,id:crypto.randomUUID(),title:copiedGroup.title+' 副本',memberIds:copiedGroup.memberIds.map(id=>ids.get(id)!)}]);
  }
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if(event.defaultPrevented)return;
      if(event.key==='Escape'){
        if((event.target as HTMLElement).closest('[data-slot="popover-content"],[data-slot="select-content"],[data-slot="dialog-content"]'))return;
        if(!nodeMenu&&!contextMenu&&!settings&&!shortcuts){setEditorOpen(false);stageRef.current?.focus({preventScroll:true});}
        setNodeMenu(undefined);setContextMenu(undefined);setSettings(false);setShortcuts(false);return;
      }
      const target=event.target as HTMLElement;
      if(target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')||!stageRef.current?.contains(target))return;
      if((event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();restore(event.shiftKey||event.key.toLowerCase()==='y'?'redo':'undo');return;}
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='d'){event.preventDefault();duplicateSelected();return;}
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='g'){event.preventDefault();groupSelected();return;}
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();setNodes(current=>current.map(node=>({...node,selected:true})));return;}
      if(event.ctrlKey||event.metaKey||event.altKey)return;
      if(event.key==='Enter'){setEditorOpen(true);return;}
      const option=toolGroups.flatMap(group=>group.items).find(item=>item.shortcut&&item.shortcut.toLowerCase()===event.key.toLowerCase());
      if(option){event.preventDefault();chooseTool(option);}
    };
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  });
  function chooseAsset(asset:Asset){
    if(targetId){const target=nodes.find(node=>node.id===targetId);if(target?.data.kind!==asset.type){toast.error('请选择与节点类型一致的素材');return;}patchNode(targetId,{assetId:asset.id});setTargetId(undefined);setPanel(undefined);frameNode(target,0,false);}
    else if(referenceTargetId){
      if(asset.type!=='image'){toast.error('当前生成节点仅支持图片参考');return;}
      const target=nodes.find(node=>node.id===referenceTargetId);if(!target)return;
      const existing=nodes.find(node=>node.data.assetId===asset.id&&node.data.kind==='image');
      const id=existing?.id||addNode('image',asset.id,{x:target.position.x-720,y:target.position.y+edges.filter(edge=>edge.target===target.id).length*680},undefined,undefined,false);
      if(!edges.some(edge=>edge.source===id&&edge.target===target.id))editEdges(current=>addEdge({id:crypto.randomUUID(),source:id,target:target.id,...defaultEdgeOptions},current));
      setNodes(current=>current.map(node=>({...node,selected:node.id===target.id})));setReferenceTargetId(undefined);setPanel(undefined);setEditorOpen(true);frameNode(target,0,false);
    }else addNode(asset.type as CanvasKind,asset.id);
  }
  function onConnect(connection:Connection){
    if(!connection.source||!connection.target||connection.source===connection.target)return;
    editEdges(current=>current.some(edge=>edge.source===connection.source&&edge.target===connection.target)?current:addEdge({...connection,id:crypto.randomUUID(),...defaultEdgeOptions},current));
  }
  function latestBatchFor(id:string){return runtime.batches.find(batch=>batch.canvasNodeId===id);}
  async function prepareGeneration(id:string){
    setBusyId(id);
    try{
      await flushCanvas();
      if(localStorage.getItem(pendingKey))throw new Error('上一笔接单结果尚未核实，请先在顶部核实');
      const node=nodes.find(item=>item.id===id);if(!node||!isGenerator(node.data.toolId))throw new Error('生成节点已不存在');
      const skillId=node.data.toolId==='ai-video'?'video-generate':'image-generate';
      const skill=runtime.skills.find(item=>item.id===skillId);if(!skill)throw new Error('生成技能不可用');
      const model=runtime.models.find(item=>item.id===node.data.modelId&&item.category===skill.model.category&&item.enabled&&item.credentialConfigured&&item.relayAvailable!==false)||runtime.models.find(item=>item.category===skill.model.category&&item.enabled&&item.credentialConfigured&&item.relayAvailable!==false);
      if(!model)throw new Error('请先在模型配置中启用可用模型');
      const incoming=edges.filter(edge=>edge.target===id).map(edge=>nodes.find(item=>item.id===edge.source)).filter((item):item is CanvasNode=>!!item);
      const sourceText=incoming.filter(item=>item.data.kind==='text').map(item=>item.data.text.trim()).filter(Boolean);
      const requirements=[...sourceText,node.data.text.trim()].filter(Boolean).join('\n\n');
      if(requirements.length>16000)throw new Error('上游文字与节点提示词合计不能超过 16000 字');
      const references=[...new Set(incoming.map(item=>item.data.kind==='image'?item.data.assetId:isGenerator(item.data.toolId)?latestBatchFor(item.id)?.attempts.at(-1)?.assetId:undefined).filter((assetId):assetId is string=>!!assetId&&assetMap.get(assetId)?.type==='image'))];
      const defaults=defaultDraft(skill,runtime.models);
      const draft:Draft={...defaults,requirements,modelId:model.id,count:1,aspectRatio:model.aspectRatios.includes(node.data.aspectRatio||'')?node.data.aspectRatio!:model.aspectRatios[0],duration:model.durations.includes(node.data.duration||0)?node.data.duration!:model.durations[0]||6,parameters:Object.fromEntries(Object.entries(model.parameters).map(([key,field])=>[key,field.default??''])),inputRoles:{[skillId==='video-generate'?'references':'product']:references}};
      const plan=await api<Plan>('/plan',{skillId,draft,action:'generate'});
      setPreview({nodeId:id,skill,draft,plan,key:crypto.randomUUID()});
    }catch(error){toast.error((error as Error).message);}finally{setBusyId(undefined);}
  }
  async function confirmGeneration(){
    if(!preview||busyId||!preview.plan.quote?.affordable)return;
    setBusyId(preview.nodeId);
    const request:Submission={canvasBoardId:boardId,canvasNodeId:preview.nodeId,skillId:preview.skill.id,draft:preview.draft,action:'generate',idempotencyKey:preview.key,planHash:preview.plan.hash,maximumCost:preview.plan.quote.maximum};
    localStorage.setItem(pendingKey,JSON.stringify(request));window.dispatchEvent(new Event('studio-pending'));
    try{
      await api('/submit',request);
      localStorage.removeItem(pendingKey);window.dispatchEvent(new Event('studio-pending'));
      setPreview(undefined);toast.success('生成任务已提交，结果将在画布节点内更新');await runtime.refresh();
    }catch(error){
      if(error instanceof ApiError&&error.status>=400&&error.status<500){localStorage.removeItem(pendingKey);window.dispatchEvent(new Event('studio-pending'));}
      toast.error((error as Error).message);if(error instanceof ApiError&&[402,409].includes(error.status))setPreview(undefined);
    }finally{setBusyId(undefined);}
  }
  function addResult(id:string,asset:Asset){const source=nodes.find(node=>node.id===id);if(source)addNode(asset.type as CanvasKind,asset.id,{x:source.position.x+450,y:source.position.y},undefined,id);}
  const handlers=useRef({prepareGeneration,addResult});handlers.current={prepareGeneration,addResult};
  const prepare=useCallback((id:string)=>void handlers.current.prepareGeneration(id),[]);
  const appendResult=useCallback((id:string,asset:Asset)=>handlers.current.addResult(id,asset),[]);
  const actions=useMemo(()=>({patch:patchNode,prepare,addResult:appendResult,pickAsset,resize:resizeNode,beginEdit:()=>beginEdit(),commit:markEdited,openAssets}),[patchNode,prepare,appendResult,pickAsset,resizeNode,beginEdit,markEdited,openAssets]);
  function onDrop(event:DragEvent<HTMLDivElement>){event.preventDefault();const asset=assetMap.get(event.dataTransfer.getData('application/studio-asset'));if(asset)addNode(asset.type as CanvasKind,asset.id,screenToFlowPosition({x:event.clientX,y:event.clientY}));}
  async function uploadImage(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];if(!file)return;
    if(targetId&&nodes.find(node=>node.id===targetId)?.data.kind!=='image'){toast.error('图片只能加入图片节点');event.target.value='';return;}
    const form=new FormData();form.append('file',file);
    try{const asset=await api<Asset>('/upload',form);await runtime.refresh();if(targetId){patchNode(targetId,{assetId:asset.id});setTargetId(undefined);}else chooseAsset(asset);toast.success('图片已加入画布');}
    catch(error){toast.error((error as Error).message);}finally{event.target.value='';}
  }
  function estimatedHeight(kind:CanvasKind,toolId:string|undefined,width:number,ratio?:string){return 32+(kind==='text'?width:kind==='tool'&&!isGenerator(toolId)?180:width/mediaRatio(ratio,kind==='video'||toolId==='ai-video'?16/9:1));}
  function frameNode(node:CanvasNode,duration=reducedMotion?0:220,panelVisible=!!panel){
    const rect=stageRef.current?.getBoundingClientRect();if(!rect)return;
    const width=node.measured?.width||node.width||Number(node.style?.width)||320;
    const height=node.measured?.height||estimatedHeight(node.data.kind,node.data.toolId,width,node.data.aspectRatio);
    const editorWidth=node.data.kind==='text'?width:Math.max(700,width+64),editorHeight=node.data.kind==='text'?0:isGenerator(node.data.toolId)?340:90;
    const next=frameCanvasBounds({x:node.position.x-(editorWidth-width)/2-24,y:node.position.y-70,width:editorWidth+48,height:height+editorHeight+100},{width:rect.width,height:rect.height},{left:(panelVisible&&!narrow?panelWidthRef.current:0)+(toolbar==='left'?100:24),right:32,top:84,bottom:toolbar==='bottom'?150:90});
    void setFlowViewport(next,{duration});
  }
  function focusNode(id:string){const node=nodes.find(node=>node.id===id);if(!node)return;setEditorOpen(true);setNodes(current=>current.map(node=>node.selected===(node.id===id)?node:{...node,selected:node.id===id}));frameNode(node,undefined,narrow?false:!!panel);}
  function focusSelection(){
    const selected=nodes.filter(node=>node.selected),rect=stageRef.current?.getBoundingClientRect();if(!selected.length||!rect)return;
    const group=groups.find(group=>group.memberIds.length===selected.length&&group.memberIds.every(id=>selected.some(node=>node.id===id)));
    const bounds=group?groupBounds(group,nodes):undefined;
    const x=bounds?.left??Math.min(...selected.map(node=>node.position.x)),y=bounds?.top??Math.min(...selected.map(node=>node.position.y));
    const width=bounds?.width??Math.max(...selected.map(node=>node.position.x+(node.measured?.width||Number(node.style?.width)||320)))-x,height=bounds?.height??Math.max(...selected.map(node=>node.position.y+(node.measured?.height||300)))-y;
    void setFlowViewport(frameCanvasBounds({x:x-30,y:y-130,width:width+60,height:height+160},{width:rect.width,height:rect.height},{left:(panel?panelWidthRef.current:0)+(toolbar==='left'?88:20),right:32,top:84,bottom:toolbar==='bottom'?150:90}),{duration:reducedMotion?0:220});
  }
  const selected=nodes.find(node=>node.selected),selectedCount=nodes.filter(node=>node.selected).length;
  const selectedIds=new Set(nodes.filter(node=>node.selected).map(node=>node.id));
  const selectedGroup=groups.find(group=>group.memberIds.length===selectedCount&&group.memberIds.every(id=>selectedIds.has(id)));
  const canGroup=selectedCount>=2&&!groups.some(group=>group.memberIds.some(id=>selectedIds.has(id)));
  const currentBoard=boards.find(board=>board.id===boardId);
  const shown=useMemo(()=>assets.filter(asset=>(filter==='all'||asset.type===filter)&&(!search||asset.id.toLowerCase().includes(search.toLowerCase()))).slice(0,80),[assets,filter,search]);
  const visibleEdges=useMemo(()=>showEdges?edges:edges.map(edge=>({...edge,hidden:true})),[showEdges,edges]);
  const sources=useMemo(()=>{const ids=new Set(edges.filter(edge=>edge.target===selected?.id).map(edge=>edge.source));return nodes.filter(node=>ids.has(node.id));},[nodes,edges,selected?.id]);
  const matchingNodes=nodes.filter(node=>(elementType==='all'||node.data.kind===elementType||node.data.toolId===elementType)&&(!search||node.data.title.toLowerCase().includes(search.toLowerCase())));
  const flowCallbacksRef=useRef({onConnect,connectionEnded});flowCallbacksRef.current={onConnect,connectionEnded};
  const flowCallbacks=useMemo(()=>({
    connect:(connection:Connection)=>flowCallbacksRef.current.onConnect(connection),
    connectEnd:(event:MouseEvent|TouchEvent,state:FinalConnectionState)=>flowCallbacksRef.current.connectionEnded(event,state),
    moveStart:()=>interacting(true),moveEnd:(_:unknown,next:Viewport)=>{interacting(false);const previous=graphRef.current.viewport;if(previous.x!==next.x||previous.y!==next.y||previous.zoom!==next.zoom){setViewport(next);markEdited();}},
    dragStart:()=>{beginEdit();interacting(true);},dragStop:()=>interacting(false),
    paneClick:()=>{setNodeMenu(undefined);setContextMenu(undefined);setSettings(false);},
  }),[interacting,beginEdit,markEdited]);
  const surface=useMemo(()=>loaded?<ReactFlow<CanvasNode,Edge> nodes={nodes} edges={visibleEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={flowCallbacks.connect} onConnectEnd={flowCallbacks.connectEnd} onClickConnectEnd={flowCallbacks.connectEnd} onMoveStart={flowCallbacks.moveStart} onMoveEnd={flowCallbacks.moveEnd} onNodeDragStart={flowCallbacks.dragStart} onNodeDragStop={flowCallbacks.dragStop} onSelectionDragStart={flowCallbacks.dragStart} onSelectionDragStop={flowCallbacks.dragStop} onPaneClick={flowCallbacks.paneClick} onPaneContextMenu={openContextMenu} onNodeContextMenu={(event,node)=>{if(!(event.target as HTMLElement).closest('input,textarea')){if(!node.selected)setNodes(current=>current.map(item=>({...item,selected:item.id===node.id})));openContextMenu(event,true);}}} defaultViewport={viewport} minZoom={.1} maxZoom={4} fitView={false} snapToGrid={snap} snapGrid={grid} panOnDrag={mode==='pan'||operation==='mouse'?true:[1,2]} panOnScroll={operation==='trackpad'} zoomActivationKeyCode={['Meta','Control']} zoomOnScroll={operation!=='trackpad'} zoomOnPinch selectionOnDrag={mode==='select'&&operation!=='mouse'} selectionMode={SelectionMode.Partial} deleteKeyCode={['Backspace','Delete']} defaultEdgeOptions={defaultEdgeOptions} connectionLineComponent={CanvasConnectionLine} onlyRenderVisibleElements aria-label="无限画布"><Background color="#d2d4d5" gap={24} size={1.2}/><ViewportPortal>{groups.map(group=><GroupFrame key={group.id} group={group} nodes={nodes} onBegin={()=>{setNodes(current=>current.map(node=>({...node,selected:group.memberIds.includes(node.id)})));beginEdit();interacting(true);}} onSelect={()=>setNodes(current=>current.map(node=>({...node,selected:group.memberIds.includes(node.id)})))} onMove={shiftGroup} onEnd={()=>{interacting(false);markEdited();}} onRename={renameGroup} onUngroup={ungroup}/>)}</ViewportPortal>{showMinimap&&<MiniMap className="canvas-minimap" style={{width:280,height:160}} nodeColor="#93979e" maskColor="#e9edf144" maskStrokeColor="#a7b4c6" maskStrokeWidth={1} pannable zoomable/>}</ReactFlow>:<div className="canvas-loading">正在载入画布…</div>,[loaded,nodes,visibleEdges,onNodesChange,onEdgesChange,flowCallbacks,viewport,snap,mode,operation,showMinimap,groups,beginEdit,interacting,shiftGroup,markEdited,renameGroup,ungroup,openContextMenu]);
  return <assetContext.Provider value={assetMap}><actionContext.Provider value={actions}><div className="canvas-workspace">
    <div ref={stageRef} className={'canvas-stage'+(performance?' is-performance':'')+(panel?' has-panel':'')+(toolbar==='bottom'?' toolbar-bottom':'')} style={{background}} tabIndex={-1} onWheelCapture={()=>autosave.current?.activity()} onPointerDownCapture={event=>{autosave.current?.setInteracting(true,'pointer');if(!(event.target as HTMLElement).closest('input,textarea,button,a,[role=combobox]'))stageRef.current?.focus({preventScroll:true});}} onDrop={onDrop} onDragOver={event=>event.preventDefault()}>
      {surface}
      {nodeMenu?.sourceId&&nodeMenu.point&&nodes.find(node=>node.id===nodeMenu.sourceId)&&<PendingConnection node={nodes.find(node=>node.id===nodeMenu.sourceId)!} point={nodeMenu.point}/>}
      <header className="canvas-projectbar"><div className="canvas-project-title"><IconButton label={focused?'退出专注模式':'专注模式'} active={focused} onClick={()=>setFocused(value=>!value)}>{focused?<PanelLeftOpen/>:<PanelLeftClose/>}</IconButton><div className="canvas-project-copy"><select className="canvas-board-select" aria-label="切换画布" value={boardId} disabled={!loaded||status!=='saved'} onChange={event=>switchBoard(event.target.value)}>{boards.map(board=><option key={board.id} value={board.id}>{board.name}</option>)}</select>{status!=='saved'&&<span className={'canvas-save-state is-'+status} role="status">{status==='loading'?'正在加载…':status==='conflict'?'保存冲突':'保存失败'}{(status==='error'||status==='conflict')&&<button onClick={()=>void retrySave()}>重试</button>}</span>}</div><IconButton label="新建画布" onClick={()=>openBoardDialog('create')}><Plus/></IconButton><IconButton label="重命名画布" onClick={()=>openBoardDialog('rename')}><PenTool/></IconButton>{boardId!=='main'&&<IconButton label="删除当前画布" onClick={()=>openBoardDialog('delete')}><Trash2/></IconButton>}</div><div className="canvas-project-actions"><AccountBalance/><Link className="canvas-help" to="/help?topic=canvas"><CircleHelp/><span>画布帮助</span></Link></div></header>
      <nav className={'canvas-tools canvas-floating'+(toolbar==='bottom'?' is-bottom':'')} aria-label="画布工具栏"><IconButton tooltipSide={toolbar==='bottom'?'top':'right'} label="添加节点" active={!!nodeMenu} onClick={()=>nodeMenu?setNodeMenu(undefined):openNodeMenu()}><Plus/></IconButton><i/><IconButton tooltipSide={toolbar==='bottom'?'top':'right'} label="选择工具" active={mode==='select'} onClick={()=>setMode('select')}><MousePointer2/></IconButton><IconButton tooltipSide={toolbar==='bottom'?'top':'right'} label="平移工具" active={mode==='pan'} onClick={()=>setMode('pan')}><Hand/></IconButton><i/><IconButton tooltipSide={toolbar==='bottom'?'top':'right'} label="画布元素" active={panel==='elements'} onClick={()=>{setPanel(panel==='elements'?undefined:'elements');setSearch('');}}><List/></IconButton><IconButton tooltipSide={toolbar==='bottom'?'top':'right'} label="素材库" active={panel==='assets'} onClick={()=>{setReferenceTargetId(undefined);setPanel(panel==='assets'?undefined:'assets');setSearch('');setTargetId(undefined);}}><FolderOpen/></IconButton><IconButton tooltipSide={toolbar==='bottom'?'top':'right'} label="上传图片" onClick={()=>{setTargetId(undefined);uploadRef.current?.click();}}><UploadCloud/></IconButton><i/><IconButton tooltipSide={toolbar==='bottom'?'top':'right'} label="快捷键" active={shortcuts} onClick={()=>setShortcuts(value=>!value)}><Keyboard/></IconButton><IconButton tooltipSide={toolbar==='bottom'?'top':'right'} label="画布设置" active={settings} onClick={()=>{setSettings(value=>!value);setNodeMenu(undefined);}}><Settings2/></IconButton></nav>
      {panel&&<CanvasSidePanel onClose={()=>{setPanel(undefined);setTargetId(undefined);setReferenceTargetId(undefined);}} stageRef={stageRef} width={panelWidth} onResize={syncPanelWidth} onCommit={commitPanelWidth}><aside className="canvas-panel" aria-label={panel==='elements'?'画布元素列表':'画布素材库'}><div className="canvas-panel-heading"><Tabs value={panel} onValueChange={value=>{setPanel(value as 'elements'|'assets');setSearch('');}}><TabsList variant="line" className="canvas-panel-tabs" aria-label="画布侧栏内容"><TabsTrigger value="elements">画布</TabsTrigger><TabsTrigger value="assets">素材</TabsTrigger></TabsList></Tabs><button aria-label="收起画布面板" onClick={()=>{setPanel(undefined);setTargetId(undefined);setReferenceTargetId(undefined);}}><X/></button></div>
        <div className="canvas-panel-filter-row"><span>{panel==='elements'?'画布元素':'素材库'}</span><select aria-label={panel==='elements'?'筛选画布元素类型':'筛选素材类型'} value={panel==='elements'?elementType:filter} onChange={event=>panel==='elements'?setElementType(event.target.value):setFilter(event.target.value as Filter)}>{(panel==='elements'?[['all','全部'],['text','文字'],['image','图片'],['video','视频'],['ai-image','AI 绘图'],['ai-video','AI 视频'],['tool','工具']]:[['all','全部'],['image','图片'],['video','视频']]).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><button aria-label="搜索画布内容" aria-expanded={searchOpen} onClick={()=>{setSearchOpen(value=>!value);setSearch('');}}><Search/></button></div>
        {searchOpen&&<label className="canvas-assets-search"><Search/><input autoFocus value={search} onChange={event=>setSearch(event.target.value)} placeholder={panel==='elements'?'搜索元素':'搜索素材编号'} aria-label={panel==='elements'?'搜索画布元素':'搜索画布素材'}/></label>}
        <div className="canvas-panel-list">{panel==='elements'?matchingNodes.map(node=><div className={'canvas-element-item'+(node.selected?' is-active':'')} key={node.id}><button className={'canvas-element-row'+(node.selected?' is-active':'')} aria-label={'定位并选中 '+node.data.title} onClick={()=>{focusNode(node.id);if(narrow)setPanel(undefined);}}><span><NodeTypeIcon data={node.data}/></span><strong>{node.data.title}</strong><LocateFixed/></button><button className="canvas-element-more" aria-label={node.data.title+'的更多选项'} onClick={event=>{setNodes(current=>current.map(item=>({...item,selected:item.id===node.id})));openContextMenu(event,true);}}><MoreHorizontal/></button></div>):shown.map(asset=><button key={asset.id} draggable onDragStart={event=>event.dataTransfer.setData('application/studio-asset',asset.id)} className="canvas-asset" onClick={()=>chooseAsset(asset)}><span className="canvas-asset-preview">{asset.type==='image'?<img src={previewUrl(asset,384)} alt="" loading="lazy" decoding="async"/>:<Film/>}</span><span><strong>{kindLabel[asset.type as CanvasKind]} #{shortId(asset.id)}</strong><small>{dateTime(asset.createdAt)}</small></span><Plus/></button>)}{!(panel==='elements'?matchingNodes.length:shown.length)&&<div className="canvas-assets-empty">{search?'没有匹配的内容':panel==='elements'?'还没有元素':'暂无素材'}</div>}</div>
        <div className="canvas-panel-bottom">{targetId||referenceTargetId?<><span>{referenceTargetId?'为生成节点添加参考':'为所选节点选择素材'}</span><button onClick={()=>{setTargetId(undefined);setReferenceTargetId(undefined);}}>取消</button></>:<span>共 {panel==='elements'?nodes.length:assets.length} {panel==='elements'?'个节点':'项素材'}</span>}{panel==='assets'&&<button onClick={()=>{setTargetId(undefined);uploadRef.current?.click();}}><UploadCloud/>上传图片</button>}</div>
      </aside></CanvasSidePanel>}
      {selected&&<SelectionOverlay key={selected.id} node={selected} count={selectedCount} sources={sources} status={status} busyId={busyId} prepare={prepare} appendResult={appendResult} focusNode={focusNode} duplicate={duplicateSelected} remove={removeSelected} close={()=>setNodes(current=>current.map(node=>node.selected?{...node,selected:false}:node))} editorOpen={editorOpen} toggleEditor={()=>{setEditorOpen(value=>!value);stageRef.current?.focus({preventScroll:true});}} nodes={nodes} canGroup={canGroup} grouped={!!selectedGroup} groupFrame={selectedGroup?groupBounds(selectedGroup,nodes):undefined} onGroup={groupSelected} onUngroup={()=>{if(selectedGroup)ungroup(selectedGroup.id);}} onLayout={layoutSelected} onFocus={focusSelection}/>}
      <div className="canvas-viewbar canvas-floating" aria-label="画布视图控制"><Popover><PopoverTrigger asChild><button className="canvas-icon-button" aria-label="画布背景色" title="画布背景色"><Circle style={{fill:background}}/></button></PopoverTrigger><PopoverContent className="canvas-background-picker" side="top" align="start">{canvasBackgrounds.map((color,index)=><button key={color} aria-label={['纯白背景','浅灰背景','雾蓝背景','暖米背景'][index]} aria-pressed={background===color} style={{background:color}} onClick={()=>updatePreferences({background:color})}>{background===color&&<Check/>}</button>)}</PopoverContent></Popover><IconButton label="画布元素" active={panel==='elements'} onClick={()=>setPanel(panel==='elements'?undefined:'elements')}><List/></IconButton><IconButton label="查看全部元素" onClick={()=>void fitView({padding:.25,maxZoom:1,duration:0})}><Maximize2/></IconButton><IconButton label="小地图" active={showMinimap} onClick={()=>updatePreferences({minimap:!showMinimap})}><MapIcon/></IconButton><IconButton label="显示连线" active={showEdges} onClick={()=>updatePreferences({edges:!showEdges})}><Link2/></IconButton><IconButton label="网格吸附" active={snap} onClick={()=>updatePreferences({snap:!snap})}><Grid3X3/></IconButton><IconButton label="性能模式" active={performance} onClick={()=>updatePreferences({performance:!performance})}><Zap/></IconButton><i/><ZoomControls/></div>
      {settings&&<div className="canvas-settings canvas-floating" role="dialog" aria-label="画布设置"><div className="canvas-panel-heading"><strong>工作台设置</strong><button aria-label="关闭画布设置" onClick={()=>setSettings(false)}><X/></button></div><fieldset className="canvas-operation-modes"><legend>画布操作模式</legend>{([['design','滚轮缩放','滚轮缩放；左键框选，空格或中键平移'],['trackpad','触控板平移','双指平移；Ctrl / ⌘ + 滚轮或捏合缩放'],['mouse','鼠标拖移','左键平移；Shift 框选，滚轮缩放']] as const).map(([value,title,description])=><label className={operation===value?'is-selected':''} key={value}><input type="radio" name="operation" value={value} checked={operation===value} onChange={()=>{updatePreferences({operation:value});setMode('select');}}/><span><strong>{title}</strong><small>{description}</small></span></label>)}</fieldset><fieldset className="canvas-toolbar-placement"><legend>主工具栏位置</legend>{(['left','bottom'] as const).map(value=><label key={value}><input type="radio" name="toolbar" value={value} checked={toolbar===value} onChange={()=>updatePreferences({toolbar:value})}/><span>{value==='left'?'左侧':'底部'}</span></label>)}</fieldset></div>}
      {contextMenu&&<div className="canvas-context-menu canvas-floating" role="menu" aria-label="画布操作" style={{left:contextMenu.x,top:contextMenu.y}}>
        {contextMenu.hasSelection&&<><button role="menuitem" onClick={()=>{duplicateSelected();setContextMenu(undefined);}}><Copy/>复制所选<kbd>⌘ D</kbd></button>{canGroup&&<button role="menuitem" onClick={()=>{groupSelected();setContextMenu(undefined);}}><Layers3/>创作成组<kbd>⌘ G</kbd></button>}{selectedGroup&&<button role="menuitem" onClick={()=>{ungroup(selectedGroup.id);setContextMenu(undefined);}}><Layers3/>取消分组</button>}<button role="menuitem" onClick={()=>{removeSelected();setContextMenu(undefined);}}><Trash2/>删除所选<kbd>⌫</kbd></button><hr/></>}
        <button role="menuitem" disabled={!history.current.canUndo} onClick={()=>{restore('undo');setContextMenu(undefined);}}><Undo2/>撤销<kbd>⌘ Z</kbd></button><button role="menuitem" disabled={!history.current.canRedo} onClick={()=>{restore('redo');setContextMenu(undefined);}}><Redo2/>重做<kbd>⌘ ⇧ Z</kbd></button><hr/><button role="menuitem" onClick={arrangeNodes}><LayoutGrid/>自动整理节点</button><button role="menuitem" onClick={()=>{void fitView({padding:.25,maxZoom:1,duration:0});setContextMenu(undefined);}}><Maximize2/>查看全部</button><button role="menuitem" onClick={()=>{const rect=stageRef.current!.getBoundingClientRect();openNodeMenu(undefined,rect.left+contextMenu.x,rect.top+contextMenu.y);setContextMenu(undefined);}}><Plus/>添加节点</button>
      </div>}
      {shortcuts&&<div className="canvas-shortcuts canvas-floating" role="dialog" aria-label="画布快捷键"><div className="canvas-panel-heading"><strong>快捷键</strong><button aria-label="关闭快捷键" onClick={()=>setShortcuts(false)}><X/></button></div>{[['创作成组','⌘ / Ctrl + G'],['平移','Space / 中键'],['文字 / 图片 / 视频','T / I / V'],['AI 绘图 / 视频','G / B'],['编辑节点','Enter'],['撤销 / 重做','⌘ / Ctrl + Z / ⇧Z'],['复制所选','⌘ / Ctrl + D'],['删除所选','Delete'],['缩放','滚轮（触控板模式加 Ctrl / ⌘）'],['平移画布','触控板 / 中键拖动']].map(([label,key])=><div key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</div>}
      {nodeMenu&&<NodePicker menu={nodeMenu} onChoose={chooseTool} onClose={()=>setNodeMenu(undefined)} onArrange={arrangeNodes} onUpload={()=>{setNodeMenu(undefined);setTargetId(undefined);uploadRef.current?.click();}} onDuplicate={selected?()=>{duplicateSelected();setNodeMenu(undefined);}:undefined}/>}
      {loaded&&!nodes.length&&<div className="canvas-empty-guide"><Layers3/><h2>从一个想法开始</h2><p>添加素材，让创意自由连接。</p><button onClick={()=>openNodeMenu()}><Plus/>添加第一个节点</button></div>}
      <input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event=>void uploadImage(event)}/>
    </div>
    <Modal open={!!preview} onClose={()=>{if(!busyId)setPreview(undefined);}} title="确认画布生成" description="确认费用后才会提交真实模型任务" wide>{preview&&<div className="canvas-plan"><div className="canvas-plan-summary"><span>模型<strong>{preview.plan.items[0]?.model.name}</strong></span><span>参考图<strong>{preview.plan.items[0]?.references.length||0} 张</strong></span><span>最高报价<strong>{preview.plan.quote?`${quoteRange(preview.plan.quote)} ${preview.plan.quote.unit}`:'不可用'}</strong></span></div><div className="canvas-plan-prompt"><small>将发送的提示词</small><p>{preview.plan.items[0]?.prompt}</p></div>{preview.plan.quote?.note&&<p className="canvas-plan-note">{preview.plan.quote.note}</p>}{preview.plan.quote&&!preview.plan.quote.affordable&&<p className="canvas-plan-error">当前可用余额不足，请充值或更换模型后重新预览。</p>}<div className="modal-actions"><Button variant="outline" disabled={!!busyId} onClick={()=>setPreview(undefined)}>返回编辑</Button><Button disabled={!!busyId||!preview.plan.quote?.affordable} onClick={()=>void confirmGeneration()}><Sparkles/>{busyId?'提交中…':'确认并生成'}</Button></div></div>}</Modal>
    <Modal open={!!boardDialog} onClose={()=>{if(!boardBusy)setBoardDialog(undefined);}} title={boardDialog==='create'?'新建画布':boardDialog==='rename'?'重命名画布':'删除画布'} description={boardDialog==='delete'?'此操作会删除当前画布中的节点、连线与分组。':'不同画布独立保存，素材库仍可共用。'}>
      <form className="canvas-board-dialog" onSubmit={event=>{event.preventDefault();void submitBoardDialog();}}>
        {boardDialog==='delete'?<p>确定删除“{currentBoard?.name}”？已生成的素材和任务记录会保留。</p>:<label>画布名称<input aria-label="画布名称" autoFocus maxLength={60} value={boardName} onChange={event=>setBoardName(event.target.value)} placeholder="例如：秋季新品方案"/></label>}
        <div className="modal-actions"><Button type="button" variant="outline" disabled={boardBusy} onClick={()=>setBoardDialog(undefined)}>取消</Button><Button type="submit" disabled={boardBusy||boardDialog!=='delete'&&!boardName.trim()}>{boardBusy?'处理中…':boardDialog==='delete'?'删除画布':'保存'}</Button></div>
      </form>
    </Modal>
  </div></actionContext.Provider></assetContext.Provider>;
});
