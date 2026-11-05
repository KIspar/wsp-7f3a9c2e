import path from 'node:path';import fs from 'node:fs';import os from 'node:os';
import {createStore} from '../apps/server/store';import {createApp} from '../apps/server/app';
import type {CatalogProduct} from '../packages/catalog';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wear-ui-')),store=createStore(dir,process.cwd());
const p:CatalogProduct={id:'wear-qa-product',revision:1,site:'jp0663',sourceId:'qa',sourceUrl:'https://pc.jp0663.com/detail/qa',supplier:'',itemNumber:'QA',wholesaleCost:null,title:'服饰穿戴 · 界面验收商品',salePrice:null,sellingPoints:'',parameters:[],colors:[],sizes:[],skus:[],postTitle:'',postBody:'',archived:false,bindings:[],collectionStatus:'completed',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};store.put('catalog-product',p.id,p);
const app=await createApp(store,{worker:false});await app.listen({port:4474,host:'127.0.0.1'});console.log('隔离验收服务 http://127.0.0.1:4474');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>void app.close().then(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});process.exit(0);}));
