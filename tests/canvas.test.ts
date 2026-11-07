import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../apps/server/app';
import {createStore,type Store} from '../apps/server/store';

let dir:string,store:Store;
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-canvas-'));store=createStore(dir,process.cwd());});
afterEach(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});

describe('canvas document',()=>{
  it('saves connected nodes with revision checks and restores them after restart',async()=>{
    const app=await createApp(store,{worker:false});
    const source=crypto.randomUUID(),target=crypto.randomUUID(),edge=crypto.randomUUID();
    const payload={revision:0,nodes:[
      {id:source,kind:'text',title:'分镜',text:'先展示商品整体',x:0,y:20},
      {id:target,kind:'tool',toolId:'ai-image',title:'AI 绘图',text:'突出材质细节',x:420,y:20,width:450},
    ],edges:[{id:edge,source,target}],viewport:{x:100,y:-50,zoom:1.25}};
    try{
      expect((await app.inject('/api/canvas')).json()).toMatchObject({revision:0,nodes:[],edges:[]});
      expect((await app.inject({method:'PUT',url:'/api/canvas',payload})).statusCode).toBe(403);
      const headers={'x-studio-token':(await app.inject('/api/bootstrap')).json().token};
      const saved=await app.inject({method:'PUT',url:'/api/canvas',headers,payload});
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({...payload,revision:1});
      expect((await app.inject({method:'PUT',url:'/api/canvas',headers,payload})).statusCode).toBe(409);
      expect((await app.inject({method:'PUT',url:'/api/canvas',headers,payload:{...payload,revision:1,edges:[{...payload.edges[0],target:crypto.randomUUID()}]}})).statusCode).toBe(400);
      expect((await app.inject({method:'PUT',url:'/api/canvas',headers,payload:{...payload,revision:1,nodes:[{...payload.nodes[0],assetId:'missing'}],edges:[]}})).statusCode).toBe(400);
      expect((await app.inject({method:'PUT',url:'/api/canvas',headers,payload:{...payload,revision:1,nodes:[{...payload.nodes[0],width:5000}],edges:[]}})).statusCode).toBe(400);
      expect((await app.inject('/api/canvas')).json()).toMatchObject({...payload,revision:1});
    }finally{await app.close();}
    store.close();store=createStore(dir,process.cwd());
    const reopened=await createApp(store,{worker:false});
    try{expect((await reopened.inject('/api/canvas')).json()).toMatchObject({...payload,revision:1});}
    finally{await reopened.close();}
  });
  it('keeps boards independent, persists groups and protects existing main data',async()=>{
    const app=await createApp(store,{worker:false});
    const headers={'x-studio-token':(await app.inject('/api/bootstrap')).json().token,'x-studio-workspace':'campaign-one'};
    const nodeA=crypto.randomUUID(),nodeB=crypto.randomUUID(),groupId=crypto.randomUUID();
    const nodes=[{id:nodeA,kind:'text',title:'构思',text:'A',x:10,y:20},{id:nodeB,kind:'text',title:'分镜',text:'B',x:370,y:20}];
    const viewport={x:0,y:0,zoom:1};
    try{
      expect((await app.inject({url:'/api/canvas/boards',headers})).json().map((board:{id:string})=>board.id)).toEqual(['main']);
      expect((await app.inject({method:'PUT',url:'/api/canvas',headers,payload:{revision:0,nodes:[nodes[0]],edges:[],viewport}})).statusCode).toBe(200);
      const created=await app.inject({method:'POST',url:'/api/canvas/boards',headers,payload:{name:'秋季方案'}});
      expect(created.statusCode).toBe(200);
      const board=created.json();
      expect((await app.inject({url:'/api/canvas/boards',headers})).json()).toHaveLength(2);
      expect((await app.inject('/api/canvas/boards')).json()).toHaveLength(1);
      const payload={revision:0,nodes,edges:[],groups:[{id:groupId,title:'视觉方向',memberIds:[nodeA,nodeB]}],viewport};
      const saved=await app.inject({method:'PUT',url:'/api/canvas/'+board.id,headers,payload});
      expect(saved.statusCode).toBe(200);
      expect((await app.inject({url:'/api/canvas/'+board.id,headers})).json()).toMatchObject({...payload,revision:1});
      expect((await app.inject({url:'/api/canvas',headers})).json()).toMatchObject({revision:1,nodes:[nodes[0]],groups:[]});
      const bad=await app.inject({method:'PUT',url:'/api/canvas/'+board.id,headers,payload:{...payload,revision:1,groups:[{...payload.groups[0],memberIds:[nodeA,crypto.randomUUID()]}]}});
      expect(bad.statusCode).toBe(400);
      expect((await app.inject({url:'/api/canvas/'+board.id,headers})).json()).toMatchObject({revision:1,groups:payload.groups});
      expect((await app.inject({method:'PATCH',url:'/api/canvas/boards/'+board.id,headers,payload:{name:'新品方案'}})).json().name).toBe('新品方案');
      expect((await app.inject({method:'DELETE',url:'/api/canvas/boards/main',headers})).statusCode).toBe(400);
      expect((await app.inject({method:'DELETE',url:'/api/canvas/boards/'+board.id,headers})).statusCode).toBe(200);
      expect((await app.inject({url:'/api/canvas/'+board.id,headers})).statusCode).toBe(404);
      expect((await app.inject({url:'/api/canvas',headers})).json().nodes).toHaveLength(1);
    }finally{await app.close();}
  });
});
