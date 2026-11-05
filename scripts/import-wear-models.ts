/** Public system portraits only; no account cookies, user collections or paid endpoints. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const root=process.cwd(),endpoint='https://webapi.designkit.cn/v1/hackathon/get_init_data';
const data=JSON.parse(execFileSync('curl',['--noproxy','*','--fail','--silent','--show-error','--max-time','30',endpoint],{maxBuffer:4*1024*1024}).toString());
if(data.code!==0||!Array.isArray(data.data?.model_list))throw new Error('公开模特目录读取失败');
await fs.mkdir(path.join(root,'public/wear-models'),{recursive:true});
const models=[];
for(const [index,item] of data.data.model_list.entries()){
 const url=new URL(item.url);if(url.protocol!=='https:'||url.hostname!=='xiuxiu-pro-new.meitudata.com')throw new Error('未经确认的资源域名');
 const id='wear-model-'+createHash('sha256').update(url.href).digest('hex').slice(0,16),filename=id+'.webp',dest=path.join(root,'public/wear-models',filename);
 try{await fs.access(dest);}catch{
  const buffer=execFileSync('curl',['--noproxy','*','--fail','--silent','--show-error','--max-time','60',url.href],{maxBuffer:20*1024*1024});
  await sharp(buffer,{limitInputPixels:40000000}).rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).webp({quality:92}).toFile(dest);
 }
 const content=await fs.readFile(dest),meta=await sharp(content).metadata();
 models.push({id,name:`模特 ${String(index+1).padStart(2,'0')}`,filename,sourceUrl:url.href,hash:createHash('sha256').update(content).digest('hex'),bytes:content.length,width:meta.width,height:meta.height});
 process.stdout.write(`已验证 ${index+1}/${data.data.model_list.length}\n`);
}
await fs.mkdir(path.join(root,'resources'),{recursive:true});
await fs.writeFile(path.join(root,'resources/wear-models.json'),JSON.stringify({version:1,source:endpoint,scenes:data.data.scene,models},null,2)+'\n');
console.log(`已导入 ${models.length} 位公开模特`);
