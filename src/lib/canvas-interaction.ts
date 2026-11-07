export type CanvasPreferences = {
  operation: 'design' | 'trackpad' | 'mouse';
  toolbar: 'left' | 'bottom';
  minimap: boolean;
  edges: boolean;
  snap: boolean;
  performance: boolean;
  background: string;
  panelWidth: number;
};
export const defaultCanvasPanelWidth = 280;
export function parseCanvasPanelWidth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(220, Math.min(440, value))) : defaultCanvasPanelWidth;
}
export function canvasPanelLimits(stageWidth: number) {
  const width = Number.isFinite(stageWidth) ? Math.max(0, stageWidth) : 1024;
  const max = Math.max(0, Math.min(440, width - Math.min(360, width * .55) - 8));
  return { min: Math.min(220, max), max };
}
export const canvasBackgrounds = ['#fdfdfd', '#f5f5f4', '#eef3f7', '#f3f0e8'] as const;
export const defaultCanvasPreferences: CanvasPreferences = {operation:'design',toolbar:'left',minimap:true,edges:true,snap:false,performance:false,background:'#fdfdfd',panelWidth:defaultCanvasPanelWidth};
export function parseCanvasPreferences(value: unknown): CanvasPreferences {
  if (!value || typeof value !== 'object') return {...defaultCanvasPreferences};
  const input = value as Partial<CanvasPreferences>;
  return {
    operation: ['design','trackpad','mouse'].includes(input.operation || '') ? input.operation! : 'design',
    toolbar: input.toolbar === 'bottom' ? 'bottom' : 'left',
    minimap: typeof input.minimap === 'boolean' ? input.minimap : true,
    edges: typeof input.edges === 'boolean' ? input.edges : true,
    snap: input.snap === true,
    performance: input.performance === true,
    background: canvasBackgrounds.includes(input.background as typeof canvasBackgrounds[number]) ? input.background! : '#fdfdfd',
    panelWidth: parseCanvasPanelWidth(input.panelWidth),
  };
}
/** Include the editor in a command's framing, while leaving fixed canvas controls clear. */
export function frameCanvasBounds(bounds:{x:number;y:number;width:number;height:number},size:{width:number;height:number},insets:{left:number;right:number;top:number;bottom:number}) {
  const width=Math.max(80,size.width-insets.left-insets.right),height=Math.max(80,size.height-insets.top-insets.bottom);
  const zoom=Math.max(.1,Math.min(1,width/bounds.width,height/bounds.height));
  return {x:insets.left+width/2-(bounds.x+bounds.width/2)*zoom,y:insets.top+height/2-(bounds.y+bounds.height/2)*zoom,zoom};
}
type LayoutNode = {id:string;position:{x:number;y:number};width?:number;measured?:{width?:number;height?:number};style?:{width?:unknown}};
export type SelectionLayout = 'left'|'center'|'right'|'top'|'middle'|'bottom'|'distribute-x'|'distribute-y'|'row'|'column'|'gap-x-80'|'gap-x-160'|'gap-y-80'|'gap-y-160';
export function layoutCanvasSelection<T extends LayoutNode>(nodes:T[],selectedIds:Set<string>,action:SelectionLayout):T[]{
  const selected=nodes.filter(node=>selectedIds.has(node.id));if(selected.length<2)return nodes;
  const width=(node:T)=>node.measured?.width||node.width||Number(node.style?.width)||320,height=(node:T)=>node.measured?.height||280;
  const left=Math.min(...selected.map(node=>node.position.x)),right=Math.max(...selected.map(node=>node.position.x+width(node))),top=Math.min(...selected.map(node=>node.position.y)),bottom=Math.max(...selected.map(node=>node.position.y+height(node)));
  const positions=new Map(selected.map(node=>[node.id,{...node.position}]));
  if(['left','center','right','top','middle','bottom'].includes(action))for(const node of selected){const p=positions.get(node.id)!;if(action==='left')p.x=left;if(action==='center')p.x=(left+right-width(node))/2;if(action==='right')p.x=right-width(node);if(action==='top')p.y=top;if(action==='middle')p.y=(top+bottom-height(node))/2;if(action==='bottom')p.y=bottom-height(node);}
  else {
    const horizontal=action==='row'||action.includes('-x'),axis=horizontal?'x':'y',extent=horizontal?width:height;
    const sorted=[...selected].sort((a,b)=>a.position[axis]-b.position[axis]);
    const distributed=action.startsWith('distribute');if(distributed&&selected.length<3)return nodes;
    const gap=distributed?((horizontal?right-left:bottom-top)-selected.reduce((sum,node)=>sum+extent(node),0))/(selected.length-1):action.endsWith('80')?80:160;
    let cursor=horizontal?left:top;
    for(const node of sorted){const p=positions.get(node.id)!;p[axis]=cursor;if(action==='row')p.y=top;if(action==='column')p.x=left;cursor+=extent(node)+gap;}
  }
  return nodes.map(node=>positions.has(node.id)?{...node,position:positions.get(node.id)!}:node);
}
/** Arrange dependency columns; a group remains one movable block and cycles remain finite. */
export function arrangeCanvasNodes<T extends LayoutNode>(nodes:T[], edges:{source:string;target:string}[], groups:{id:string;memberIds:string[]}[]):T[] {
  if (!nodes.length) return nodes;
  const membership=new Map(groups.flatMap(group=>group.memberIds.map(id=>[id,group.id] as const)));
  const units=new Map<string,T[]>();
  for(const node of nodes){const id=membership.get(node.id)||node.id;units.set(id,[...(units.get(id)||[]),node]);}
  const unitFor=new Map(nodes.map(node=>[node.id,membership.get(node.id)||node.id]));
  const incoming=new Map([...units.keys()].map(id=>[id,new Set<string>()]));
  const outgoing=new Map([...units.keys()].map(id=>[id,new Set<string>()]));
  for(const edge of edges){const from=unitFor.get(edge.source),to=unitFor.get(edge.target);if(from&&to&&from!==to){incoming.get(to)!.add(from);outgoing.get(from)!.add(to);}}
  const remaining=new Map([...incoming].map(([id,sources])=>[id,sources.size]));
  const levels=new Map([...units.keys()].map(id=>[id,0]));
  const queue=[...units.keys()].filter(id=>remaining.get(id)===0);
  for(let i=0;i<queue.length;i++)for(const target of outgoing.get(queue[i])!){levels.set(target,Math.max(levels.get(target)!,levels.get(queue[i])!+1));remaining.set(target,remaining.get(target)!-1);if(remaining.get(target)===0)queue.push(target);}
  const widthOf=(node:T)=>node.measured?.width||node.width||Number(node.style?.width)||320;
  const columns=new Map<number,string[]>();
  for(const id of units.keys()){const level=levels.get(id)!;columns.set(level,[...(columns.get(level)||[]),id]);}
  const positions=new Map<string,{x:number;y:number}>();
  let x=Math.min(...nodes.map(node=>node.position.x));
  const startY=Math.min(...nodes.map(node=>node.position.y));
  for(const [,ids] of [...columns].sort(([a],[b])=>a-b)){
    let y=startY,maxWidth=0;
    for(const id of ids){const members=units.get(id)!;for(const node of members){positions.set(node.id,{x,y});y+=(node.measured?.height||280)+100;maxWidth=Math.max(maxWidth,widthOf(node));}y+=48;}
    x+=maxWidth+180;
  }
  return nodes.map(node=>({...node,position:positions.get(node.id)!}));
}
