/** Local-only disposable application with controlled provider responses. Never reads data/. */
import fs from 'node:fs';
import path from 'node:path';
import {researchHarness} from '../tests/support/research-harness';

const output=path.resolve(process.env.RESEARCH_TEST_OUTPUT||'output/research-flow');
fs.mkdirSync(output,{recursive:true});
const h=await researchHarness({workers:true});
const address=await h.app.listen({port:Number(process.env.RESEARCH_TEST_PORT||0),host:'127.0.0.1'});
const info={url:address,productId:h.product.id,uploads:h.ids.slice(1,4).map(id=>path.join(h.dir,'media',id+'.png')),dir:h.dir};
fs.writeFileSync(path.join(output,'fixture.json'),JSON.stringify(info,null,2));
console.log(JSON.stringify({ready:true,...info}));
let closing=false;
async function shutdown(){if(closing)return;closing=true;fs.writeFileSync(path.join(output,'provider-calls.json'),JSON.stringify(h.calls.map(c=>({kind:c.kind,method:c.method,url:c.url})),null,2));await h.close();process.exit(0);}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
