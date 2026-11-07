import type {CanvasGroupRecord,CanvasNodeRecord} from '../../packages/canvas';
export type CanvasSaveGraph={
  nodes:{id:string;data:{kind:CanvasNodeRecord['kind'];title:string;text:string;assetId?:string;toolId?:string;modelId?:string;aspectRatio?:string;duration?:number};position:{x:number;y:number};style?:{width?:string|number};width?:number}[];
  edges:{id:string;source:string;target:string}[];
  groups:CanvasGroupRecord[];
  viewport:{x:number;y:number;zoom:number};
};
export type CanvasSaveRequest={id:number;url:string;token:string;workspace:string;revision:number;graph:CanvasSaveGraph};
export type CanvasSaveReply={id:number;revision?:number;error?:{message:string;status:number;code?:string}};
/** Kept in the worker so transient selection/measurement never enters stored documents. */
export function canvasSaveContent(graph:CanvasSaveGraph){
  return {
    nodes:graph.nodes.map(node=>({id:node.id,kind:node.data.kind,title:node.data.title.trim()||'未命名节点',text:node.data.text,assetId:node.data.assetId,toolId:node.data.toolId,modelId:node.data.modelId,aspectRatio:node.data.aspectRatio,duration:node.data.duration,x:node.position.x,y:node.position.y,width:typeof node.style?.width==='number'?node.style.width:node.width})),
    edges:graph.edges.map(({id,source,target})=>({id,source,target})),groups:graph.groups,viewport:graph.viewport,
  };
}
