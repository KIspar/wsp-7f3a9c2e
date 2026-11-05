import type {Model} from './contracts';

export const token01ModelIds=['minimax-h3-fast','minimax-h3'] as const;
export const token01Origin='https://www.token01.net';
export const isToken01Model=(id:string)=>token01ModelIds.some(value=>value===id);
export type Token01PriceTier={resolution:string;basePrice:number;price:number;offPeakPrice?:number;specialPrice:boolean};
export type Token01GroupChoice={group:string;ratio:number;resolutions:string[];prices:Token01PriceTier[];inputImagePrice?:number;freeInputImages:number;offPeakWindows:{start:string;end:string;tz?:string}[];notes:string[]};
export type Token01GroupProfile={group:string;configured:boolean;status:'idle'|'ready'|'error';modelIds:string[];checkedAt?:string;error?:string};
export type Token01KeyProfile={id:string;name:string;group?:string;status:'idle'|'ready'|'error';modelNames:string[];modelIds:string[];checkedAt?:string;error?:string};
export type Token01RoutingConfig={models:{id:string;name:string;groups:Token01GroupChoice[]}[];profiles:Token01GroupProfile[];catalogError?:string;fetchedAt?:string};
export const token01Models:Model[]=token01ModelIds.map(id=>({
  id,name:id==='minimax-h3-fast'?'MiniMax-H3-Fast':'MiniMax-H3',
  upstreamId:id==='minimax-h3-fast'?'MiniMax-H3-Fast':'MiniMax-H3',
  category:'video',provider:'token01',revision:1,enabled:true,maxReferences:9,
  aspectRatios:id==='minimax-h3-fast'?['9:16','16:9','1:1']:['9:16','16:9','1:1','4:3','3:4','21:9'],durations:Array.from({length:12},(_,i)=>i+4),points:null,
  parameters:{
    resolution:{label:'视频画质',type:'select',default:'768p',options:id==='minimax-h3-fast'?['480p','768p','1080p']:['768p','2k']},
    referenceMode:{label:'图片用途',type:'select',default:'reference',options:['reference','first-frame','first-last-frame']},
  },
}));
