// Development setup only; release folder already contains these dependencies.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');process.chdir(root);const win=process.platform==='win32';
function run(cmd,args){const r=spawnSync(cmd,args,{stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw Error('环境准备失败：'+cmd);}
const folder='.runtime/video',python=path.join(folder,win?'Scripts/python.exe':'bin/python');
if(!fs.existsSync(python))run(win?'python':'python3',['-m','venv',folder]);
run(python,['-m','pip','install','-r','apps/video-worker/requirements.txt']);
fs.mkdirSync('.runtime/models',{recursive:true});
run(python,['-c',"from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-base',revision='ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66',local_dir='.runtime/models/whisper-base')"]);
console.log('本地环境准备完成。重启服务后检查视频环境；此脚本无需在文件夹版运行。');
