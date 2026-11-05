import { useEffect, useRef, useState } from "react";
import { Expand, LoaderCircle, Pause, Play, RotateCw, Volume2, VolumeX } from "lucide-react";
import { Button } from "./ui/button";
import { FormSelect } from "./form-select";
import { Slider } from "./ui/slider";

const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
export function VideoPlayer({ src, autoPlay = true }: { src: string; autoPlay?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState("1");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(()=>{setLoading(true);setError("");setNotice("");setPlaying(false);setPosition(0);setDuration(0);},[src]);
  async function toggle() {
    if (!video.current) return;
    if (!video.current.paused) video.current.pause();
    else { try { await video.current.play(); } catch { setNotice("播放未能启动，请再次点击播放，或下载原文件查看。"); } }
  }
  return <div className="video-player flex w-full flex-col overflow-hidden rounded-md bg-foreground text-background" ref={container}>
    <div className="relative flex min-h-40 flex-1 items-center justify-center"><video ref={video} src={src} playsInline autoPlay={autoPlay} preload="metadata" onLoadStart={()=>{setLoading(true);setError("");}} onLoadedData={()=>setLoading(false)} onCanPlay={()=>setLoading(false)} onWaiting={()=>setLoading(true)} onSeeking={()=>setLoading(true)} onSeeked={()=>setLoading(false)} onPlaying={()=>setLoading(false)} onLoadedMetadata={e=>setDuration(Number.isFinite(e.currentTarget.duration)?e.currentTarget.duration:0)} onTimeUpdate={e=>setPosition(e.currentTarget.currentTime)} onPlay={()=>{setPlaying(true);setError("");setNotice("");}} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)} onError={()=>{setLoading(false);setPlaying(false);setError("视频暂时无法播放，可以重试或下载原文件。");}} />
      <button type="button" className="absolute inset-0 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" disabled={!!error} onClick={()=>void toggle()} aria-label={playing?"暂停视频":"播放视频"}>{!playing&&!loading&&!error && <span className="flex size-12 items-center justify-center rounded-full border border-background/30 bg-foreground/60"><Play /></span>}</button>
      {loading&&!error&&<div className="video-loading-feedback" role="status" aria-live="polite"><LoaderCircle className="spin"/><span>{duration?'视频缓冲中…':'正在载入视频…'}</span></div>}
      {error && <div className="video-error-feedback" role="alert"><p>{error}</p><Button variant="secondary" size="sm" onClick={()=>{setError("");setLoading(true);video.current?.load();}}><RotateCw/>重新加载视频</Button></div>}
    </div>
    {notice&&<p className="bg-card px-3 pt-2 text-sm text-card-foreground" role="status">{notice}</p>}
    <div className="flex items-center gap-2 bg-card px-3 py-2 text-card-foreground">
      <Button type="button" variant="ghost" size="icon-sm" aria-label={playing?"暂停":"播放"} disabled={!!error} onClick={()=>void toggle()}>{playing?<Pause />:<Play />}</Button>
      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{time(position)} / {time(duration)}</span>
      <Slider aria-label="播放进度" min={0} max={duration || 1} step={0.01} value={[Math.min(position,duration || 1)]} disabled={!duration} onValueChange={([next])=>{if(video.current){video.current.currentTime=next;setPosition(next);}}} />
      <Button type="button" variant="ghost" size="icon-sm" aria-label={muted?"取消静音":"静音"} onClick={()=>{if(video.current){video.current.muted=!muted;setMuted(!muted);}}}>{muted||volume===0?<VolumeX />:<Volume2 />}</Button>
      <Slider aria-label="音量" className="max-w-16" min={0} max={1} step={0.01} value={[muted?0:volume]} onValueChange={([next])=>{if(video.current){video.current.volume=next;video.current.muted=false;setVolume(next);setMuted(false);}}} />
      <FormSelect size="sm" className="w-20 shrink-0" aria-label="播放速度" value={speed} options={["0.5","0.75","1","1.25","1.5","2"].map(value=>({value,label:`${value}×`}))} onValueChange={next=>{setSpeed(next);if(video.current)video.current.playbackRate=Number(next);}} />
      <Button type="button" variant="ghost" size="icon-sm" aria-label="全屏播放" onClick={async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await container.current?.requestFullscreen();}catch{setNotice("当前浏览器无法进入全屏，可放大预览查看。");}}}><Expand /></Button>
    </div>
  </div>;
}
