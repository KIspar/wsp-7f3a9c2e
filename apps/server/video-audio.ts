import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {fail} from './errors';
const require=createRequire(import.meta.url);
export async function probeAudio(file:string){
 const {stdout}=await promisify(execFile)(process.env.STUDIO_FFPROBE||(require('ffprobe-static') as {path:string}).path,['-v','error','-show_format','-show_streams','-of','json',file],{timeout:20000,maxBuffer:1024*1024});
 const d=JSON.parse(stdout),format=String(d.format?.format_name||'');const duration=Number(d.format?.duration);
 if(!d.streams?.some((s:{codec_type:string})=>s.codec_type==='audio')||d.streams.some((s:{codec_type:string})=>s.codec_type==='video')||!Number.isFinite(duration)||duration<=0||duration>600)fail('请上传真实 MP3、WAV 或 M4A 音频，时长不超过10分钟');
 if(format.includes('mp3'))return {extension:'.mp3',mime:'audio/mpeg'};
 if(format.includes('wav'))return {extension:'.wav',mime:'audio/wav'};
 if(format.includes('m4a')||format.includes('mp4'))return {extension:'.m4a',mime:'audio/mp4'};
 fail('仅接受 MP3、WAV、M4A 音频');
}
