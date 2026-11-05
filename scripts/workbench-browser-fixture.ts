import {workbenchHarness} from '../tests/support/workbench-harness';
const fixture=await workbenchHarness(),app=await fixture.app();
fixture.analysis.start();fixture.service.startWorker();
console.log(await app.listen({host:'127.0.0.1',port:4381}));
console.log('提示词工作台隔离验收：临时数据库与确定性模型响应，不连接真实模型。');
let stopping=false;
async function stop(){if(stopping)return;stopping=true;await app.close();await fixture.close();process.exit(0);}
process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
