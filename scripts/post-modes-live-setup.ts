/** Isolated acceptance uses the same already-authorized provider keys; no credentials are printed or exported. */
import fs from 'node:fs';import path from 'node:path';
import {createStore} from '../apps/server/store';import {credentialVault} from '../apps/server/credentials';
import type {AnalysisModel} from '../packages/analysis';import type {CatalogProduct} from '../packages/catalog';import type {Asset} from '../packages/contracts';
const root=process.cwd(),live=createStore(path.resolve('data'),root),source=createStore(path.resolve('output/catalog-live-20261029'),root),dest=createStore(path.resolve('output/post-modes-live-20261029'),root);
try{
 const id='product-post-modes-live-20261029';if(dest.get('catalog-product',id))throw Error('Isolated acceptance already exists; use saved receipts, never reseed paid jobs');
 const p=source.list<CatalogProduct>('catalog-product')[0];const product={...structuredClone(p),id,revision:1,postTitle:'',postBody:''};
 for(const a of source.list<Asset>('asset').filter(a=>product.bindings.some(b=>b.assetId===a.id))){const file=path.basename(a.url);fs.copyFileSync(path.join(source.dataDir,'media',file),path.join(dest.dataDir,'media',file));dest.put('asset',a.id,a);}
 dest.put('catalog-product',id,product);
 const from=credentialVault(live.dataDir),to=credentialVault(dest.dataDir);
 for(const model of live.models()){dest.put('model',model.id,model);const version=from.current(model.id);if(version)to.set(model.id,from.get(model.id,version));}
 for(const m of live.list<AnalysisModel>('analysis-model')){const version=from.current(m.id);if(!version)continue;const nextVersion=to.set(m.id,from.get(m.id,version));const next={...m,vision:{...m.vision,credentialVersion:nextVersion}};dest.put('analysis-model',m.id,next);}
 dest.put('analysis-settings','global',live.get('analysis-settings','global'));
 console.log(JSON.stringify({dataDir:dest.dataDir,productId:id,title:product.title,mainImages:product.bindings.filter(b=>b.kind==='main').slice(0,4).map(b=>b.assetId),credentialImport:'encrypted; same validated key bytes, new local encryption version'}));
}finally{live.close();source.close();dest.close();}
