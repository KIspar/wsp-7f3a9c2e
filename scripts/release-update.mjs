import {promises as fs,createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
if(!/^\d+\.\d+\.\d+$/.test(pkg.version))throw Error('只发布 x.y.z 稳定版');
const tag=process.env.GITHUB_REF_NAME||'v'+pkg.version;if(tag!=='v'+pkg.version)throw Error('Git 标签与 package.json 版本不一致');
const output=path.join(root,'release/update');await fs.mkdir(output,{recursive:true});
const names=['dist','dist-server','public','skills','resources','extensions','apps/video-worker','scripts','updates','package.json','package-lock.json'];
const files=[];for(const name of names)try{await fs.access(path.join(root,name));files.push(name);}catch{}
const archive=path.join(output,'studio-app.tar.gz');
const tar=spawnSync('tar',['--format=ustar','-czf',archive,'--exclude=__pycache__','--exclude=*.pyc',...files],{cwd:root,stdio:'inherit'});if(tar.status!==0)throw Error('更新包生成失败');
const hash=createHash('sha256');for await(const chunk of createReadStream(archive))hash.update(chunk);
const manifest={schemaVersion:1,version:pkg.version,tag,publishedAt:new Date().toISOString(),minimumNode:24,notes:process.env.RELEASE_NOTES||'性能改进与功能更新',assets:{app:{name:'studio-app.tar.gz',sha256:hash.digest('hex'),size:(await fs.stat(archive)).size}}};
await fs.writeFile(path.join(output,'latest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Generated latest.json and studio-app.tar.gz for '+tag);
