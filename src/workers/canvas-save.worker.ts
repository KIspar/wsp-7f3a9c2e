import {canvasSaveContent,type CanvasSaveRequest,type CanvasSaveReply} from '../lib/canvas-save-protocol';
// Projection, JSON encoding, fetch and full-document response decoding stay off the UI thread.
let previousSignature:string|undefined;
self.onmessage=async(event:MessageEvent<CanvasSaveRequest>)=>{
  const {id,url,token,workspace,revision,graph}=event.data;
  let reply:CanvasSaveReply;
  try{
    const content=canvasSaveContent(graph),signature=JSON.stringify(content);
    if(signature===previousSignature){self.postMessage({id,revision} satisfies CanvasSaveReply);return;}
    const response=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json','X-Studio-Token':token,'X-Studio-Workspace':workspace},body:JSON.stringify({revision,...content})});
    const result=await response.json();
    if(!response.ok)reply={id,error:{message:result.message||'画布保存失败',status:response.status,code:result.code}};
    else if(!Number.isInteger(result.revision))reply={id,error:{message:'画布保存响应无效',status:0}};
    else{previousSignature=signature;reply={id,revision:result.revision};}
  }catch{reply={id,error:{message:'连接中断，画布修改尚未保存。请检查后台服务后重试。',status:0}};}
  self.postMessage(reply);
};
