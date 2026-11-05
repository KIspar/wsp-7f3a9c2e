"""Fixed local media operations. No provider credentials, arbitrary code, or URL inputs."""
import argparse
import importlib.metadata
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys


def emit(step, **extra):
    print(json.dumps({'step': step, **extra}, ensure_ascii=False), flush=True)


def ffmpeg():
    explicit = os.environ.get('STUDIO_FFMPEG')
    if explicit:
        return explicit
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def run(args):
    result = subprocess.run(args, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=1800)
    if result.returncode:
        raise RuntimeError(result.stderr[-1800:] or '本地媒体处理失败')
    return result.stdout


def probe(file):
    return json.loads(run([os.environ.get('STUDIO_FFPROBE', 'ffprobe'), '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(file)]))


def doctor():
    versions = {p: importlib.metadata.version(p) for p in ('claude-real-video', 'scenedetect', 'faster-whisper', 'imageio-ffmpeg')}
    import cv2
    import ctranslate2
    from faster_whisper import WhisperModel
    from scenedetect import detect, ContentDetector
    run([ffmpeg(), '-version'])
    run([os.environ.get('STUDIO_FFPROBE', 'ffprobe'), '-version'])
    model = Path(os.environ.get('STUDIO_WHISPER_MODEL', 'runtime/models/whisper-base'))
    if not (model / 'model.bin').is_file():
        raise RuntimeError('本地 Whisper 模型尚未安装，请运行环境准备工具')
    emit('本地视频环境可用', versions=versions, python=sys.version.split()[0])


def local_file(value):
    file = Path(value).resolve(strict=True)
    if not file.is_file():
        raise ValueError('本地输入文件不存在')
    return file


def frames(source, shots, out):
    output = []
    for i, shot in enumerate(shots):
        start, end = float(shot['start']), float(shot['end'])
        if not math.isfinite(start + end) or start < 0 or end <= start:
            raise ValueError('镜头时间不合法')
        paths = []
        # Stay inside the shot: the end boundary belongs to the next shot.
        times = [start, (start + end) / 2, max(start, end - min(.08, (end-start)/4))]
        for n, t in enumerate(times):
            target = out / ('shot-%02d-%d.jpg' % (i + 1, n))
            run([ffmpeg(), '-y', '-v', 'error', '-ss', str(t), '-i', str(source), '-frames:v', '1', '-vf', 'scale=1024:1024:force_original_aspect_ratio=decrease', str(target)])
            paths.append(str(target))
        output.append({**shot, 'frames': paths})
        emit('提取分镜证据帧', completed=i+1, total=len(shots))
    return output


def extract(data, out):
    from claude_real_video import process
    from scenedetect import detect, ContentDetector
    source = local_file(data['source'])
    meta = probe(source)
    duration = float(meta['format']['duration'])
    has_audio = any(s['codec_type'] == 'audio' for s in meta['streams'])
    emit('提取带时间戳关键帧')
    # crv shells out to ffmpeg/ffprobe by name: give it a private, fixed binary directory.
    bins = out / 'bin'
    bins.mkdir(exist_ok=True)
    for name, binary in [('ffmpeg', ffmpeg()), ('ffprobe', os.environ['STUDIO_FFPROBE'])]:
        alias = bins / (name + ('.exe' if os.name == 'nt' else ''))
        if not alias.exists():
            if os.name == 'nt':
                shutil.copy2(binary, alias)
            else:
                alias.symlink_to(Path(binary).resolve())
    os.environ['PATH'] = str(bins) + os.pathsep + os.environ.get('PATH', '')
    os.environ['CRV_NO_MEMORY'] = '1'
    process(str(source), str(out / 'crv'), do_transcribe=False, keep_audio=has_audio, max_frames=180)
    emit('检测镜头边界')
    scenes = detect(str(source), ContentDetector(threshold=27.0), start_in_scene=True)
    boundaries = sorted(set([0.0, duration] + [max(0.0, min(duration, float(s[0].get_seconds()))) for s in scenes]))
    shots = []
    for a, b in zip(boundaries, boundaries[1:]):
        if b-a < .001:
            continue
        count = max(1, math.ceil((b-a)/5))
        for n in range(count):
            shots.append({'start': round(a+(b-a)*n/count, 6), 'end': round(a+(b-a)*(n+1)/count, 6)})
    # Keep all detection results even if the generation limit is exceeded.
    # The user must explicitly merge or select a smaller range before any paid operation.
    segments, transcript = [], '未检测到语音'
    audio = None
    if has_audio:
        emit('保留原音轨与语音转写')
        audio = out / 'original-audio.m4a'
        run([ffmpeg(), '-y', '-v', 'error', '-i', str(source), '-vn', '-c:a', 'aac', '-b:a', '192k', str(audio)])
        model_path = Path(os.environ['STUDIO_WHISPER_MODEL'])
        if not (model_path / 'model.bin').is_file():
            raise RuntimeError('本地 Whisper 模型缺失；未调用云端转写')
        from faster_whisper import WhisperModel
        model = WhisperModel(str(model_path), device='cpu', compute_type='int8', local_files_only=True)
        result, _ = model.transcribe(str(source), language='zh', vad_filter=True, condition_on_previous_text=False)
        segments = [{'start': s.start, 'end': s.end, 'text': s.text} for s in result]
        transcript = '\n'.join('[%.2f–%.2f] %s' % (s['start'], s['end'], s['text']) for s in segments) or '未检测到语音'
    (out / 'transcript.json').write_text(json.dumps(segments, ensure_ascii=False, indent=2), encoding='utf-8')
    (out / 'transcript.txt').write_text(transcript, encoding='utf-8')
    for shot in shots:
        shot['transcript'] = ' '.join(s['text'] for s in segments if s['end'] > shot['start'] and s['start'] < shot['end'])
    # A large cut count is still inspectable and editable; generate frames after reducing it.
    extracted = frames(source, shots, out) if len(shots) <= 20 else [{**s, 'frames': []} for s in shots]
    return {'duration': duration, 'hasAudio': has_audio, 'audio': str(audio) if audio else None, 'transcript': transcript, 'transcriptSegments': segments, 'shots': extracted}


def compose(data, out):
    pieces = []
    width, height = data['size']
    fps = 30
    boundaries = [round(float(s['start']) * fps) for s in data['shots']] + [round(float(data['shots'][-1]['end']) * fps)]
    for i, shot in enumerate(data['shots']):
        source = local_file(shot['file'])
        target = out / ('piece-%02d.mp4' % i)
        count = boundaries[i+1] - boundaries[i]
        if count <= 0:
            raise ValueError('镜头不足一帧，请合并镜头后重试')
        required = count / fps
        actual = float(probe(source)['format']['duration'])
        if actual + .04 < required:
            raise ValueError('候选片段比保留时长短，请重新制作该镜头')
        vf = 'scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,setpts=PTS-STARTPTS' % (width,height,width,height)
        run([ffmpeg(), '-y', '-v', 'error', '-i', str(source), '-an', '-vf', vf, '-frames:v', str(count), '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', str(target)])
        pieces.append(target)
        emit('统一分镜格式', completed=i+1, total=len(data['shots']))
    listing = out / 'concat.txt'
    # All names are generated ASCII basenames in this folder, never user supplied concat syntax.
    listing.write_text('\n'.join("file '%s'" % p.name for p in pieces), encoding='utf-8')
    visual = out / 'visual.mp4'
    run([ffmpeg(), '-y', '-v', 'error', '-f', 'concat', '-safe', '1', '-i', str(listing), '-c', 'copy', str(visual)])
    target = out / 'composition.mp4'
    total = (boundaries[-1]-boundaries[0]) / fps
    if data.get('audio'):
        audio = local_file(data['audio'])
        audio_args = ['-ss', str(data['shots'][0]['start'])] if data.get('originalAudio') else []
        run([ffmpeg(), '-y', '-v', 'error', '-i', str(visual), *audio_args, '-i', str(audio), '-map', '0:v:0', '-map', '1:a:0', '-af', 'apad', '-t', str(total), '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-movflags', '+faststart', str(target)])
    else:
        run([ffmpeg(), '-y', '-v', 'error', '-i', str(visual), '-c', 'copy', '-movflags', '+faststart', str(target)])
    meta = probe(target)
    if abs(float(meta['format']['duration'])-total) > .1:
        raise ValueError('合成时长校验失败，未发布成片')
    return {'file': str(target), 'duration': float(meta['format']['duration'])}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['doctor','extract','compose','frames'])
    parser.add_argument('manifest', nargs='?')
    args = parser.parse_args()
    if args.action == 'doctor':
        doctor()
        return
    manifest = local_file(args.manifest)
    data = json.loads(manifest.read_text(encoding='utf-8'))
    out = manifest.parent
    if args.action == 'extract':
        result = extract(data, out)
    elif args.action == 'frames':
        result = {'shots': frames(local_file(data['source']), data['shots'], out)}
    else:
        result = compose(data, out)
    temp = out / 'result.json.tmp'
    temp.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(out / 'result.json')
    emit('本地处理完成')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        emit('本地处理失败', error=str(e))
        sys.exit(1)
