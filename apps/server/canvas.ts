import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import type {Asset} from '../../packages/contracts';
import {canvasSaveSchema,emptyCanvas,type CanvasBoard,type CanvasDocument} from '../../packages/canvas';
import type {Store} from './store';
import {fail} from './engine';

const boardInput=z.object({name:z.string().trim().min(1).max(60)});
const boardParams=z.object({boardId:z.union([z.literal('main'),z.string().uuid()])});
const mainBoard:CanvasBoard={id:'main',name:'主画布',createdAt:'',updatedAt:''};

export function registerCanvasRoutes(app:FastifyInstance,store:Store){
  const boards=()=>{
    const saved=store.list<CanvasBoard>('canvas-board');
    return [saved.find(board=>board.id==='main')??mainBoard,...saved.filter(board=>board.id!=='main').sort((a,b)=>a.createdAt.localeCompare(b.createdAt))];
  };
  const boardId=(value:unknown)=>boardParams.parse(value).boardId;
  const assertBoard=(id:string)=>{if(id!=='main'&&!store.get<CanvasBoard>('canvas-board',id))fail('画布不存在',404);};
  const getDocument=(id:string)=>{assertBoard(id);return store.get<CanvasDocument>('canvas',id)??emptyCanvas;};
  const saveDocument=(id:string,body:unknown)=>{
    const input=canvasSaveSchema.parse(body);
    return store.transaction(()=>{
      assertBoard(id);
      const previous=getDocument(id);
      if(previous.revision!==input.revision)fail('画布已在其他窗口更新，请刷新后继续编辑',409);
      for(const node of input.nodes){
        if(!node.assetId)continue;
        if(node.kind!=='image'&&node.kind!=='video')fail('此类节点不能绑定媒体素材',400);
        const asset=store.get<Asset>('asset',node.assetId);
        if(!asset||asset.type!==node.kind)fail('画布中有不可用的图片或视频素材',400);
      }
      const next:CanvasDocument={...input,revision:previous.revision+1,updatedAt:new Date().toISOString()};
      store.put('canvas',id,next);
      return next;
    });
  };

  app.get('/api/canvas/boards',async()=>boards());
  app.post('/api/canvas/boards',async request=>{
    const {name}=boardInput.parse(request.body);
    return store.transaction(()=>{
      if(boards().length>=30)fail('最多创建 30 个画布',400);
      const now=new Date().toISOString();
      const board:CanvasBoard={id:randomUUID(),name,createdAt:now,updatedAt:now};
      store.put('canvas-board',board.id,board);
      store.put('canvas',board.id,{...emptyCanvas});
      return board;
    });
  });
  app.patch<{Params:{boardId:string}}>('/api/canvas/boards/:boardId',async request=>{
    const id=boardId(request.params),{name}=boardInput.parse(request.body);
    return store.transaction(()=>{
      assertBoard(id);
      const previous=boards().find(board=>board.id===id)!;
      const board={...previous,name,updatedAt:new Date().toISOString()};
      store.put('canvas-board',id,board);
      return board;
    });
  });
  app.delete<{Params:{boardId:string}}>('/api/canvas/boards/:boardId',async request=>{
    const id=boardId(request.params);
    if(id==='main')fail('主画布不能删除',400);
    return store.transaction(()=>{
      assertBoard(id);
      store.remove('canvas',id);
      store.remove('canvas-board',id);
      return {deleted:id};
    });
  });
  app.get('/api/canvas',async()=>getDocument('main'));
  app.put('/api/canvas',async request=>saveDocument('main',request.body));
  app.get<{Params:{boardId:string}}>('/api/canvas/:boardId',async request=>getDocument(boardId(request.params)));
  app.put<{Params:{boardId:string}}>('/api/canvas/:boardId',async request=>saveDocument(boardId(request.params),request.body));
}
