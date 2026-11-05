import path from 'node:path';
import {createStore} from '../apps/server/store';
import {createApp} from '../apps/server/app';
const store=createStore(path.resolve('output/catalog-live-20261029'),process.cwd());
const app=await createApp(store,{worker:false});
await app.listen({host:'127.0.0.1',port:4311});
console.log('推广工作台隔离验收：http://127.0.0.1:4311');
async function close(){await app.close();store.close();process.exit(0);}
process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close());
