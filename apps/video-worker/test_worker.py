"""Real local FFmpeg integration. Authored fixtures, never provider acceptance evidence."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('worker', Path(__file__).with_name('worker.py'))
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)


class LocalVideoTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def clip(self, name, seconds, color='red', sound=None):
        target = self.root / name
        args = [w.ffmpeg(), '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=%s:s=160x240:r=30:d=%s' % (color, seconds)]
        if sound:
            args += ['-f', 'lavfi', '-i', 'sine=frequency=%s:duration=%s' % (sound, seconds)]
        w.run(args + ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-t', str(seconds), str(target)])
        return target

    def folder(self, name):
        p = self.root / name
        p.mkdir()
        return p

    def test_extract_silent_long_shot_retains_complete_range(self):
        source = self.clip('long.mp4', 16)
        result = w.extract({'source': str(source)}, self.folder('extract'))
        self.assertFalse(result['hasAudio'])
        self.assertEqual(result['transcript'], '未检测到语音')
        self.assertEqual(result['shots'][0]['start'], 0)
        self.assertAlmostEqual(result['shots'][-1]['end'], 16, places=2)
        self.assertTrue(all(s['end']-s['start'] <= 5 for s in result['shots']))
        self.assertTrue(all(len(s['frames']) == 3 for s in result['shots']))

    def test_repeated_scene_has_two_distinct_timestamps(self):
        parts = [self.clip('a.mp4', 1, 'red'), self.clip('b.mp4', 1, 'blue'), self.clip('c.mp4', 1, 'red')]
        listing = self.root / 'concat.txt'
        listing.write_text('\n'.join("file '%s'" % p.name for p in parts))
        source = self.root / 'sequence.mp4'
        w.run([w.ffmpeg(), '-v', 'error', '-y', '-f', 'concat', '-safe', '1', '-i', str(listing), '-c', 'copy', str(source)])
        result = w.extract({'source': str(source)}, self.folder('extract'))
        self.assertGreaterEqual(len(result['shots']), 3)
        self.assertTrue(any(abs(s['start']-2) < .05 for s in result['shots']))
        self.assertAlmostEqual(result['shots'][-1]['end'], 3, places=2)

    def test_composition_uses_original_audio_discards_clip_audio_and_trims_excess(self):
        generated = self.clip('generated.mp4', 2, sound=1200)
        original = self.clip('original.mp4', 3, sound=400)
        result = w.compose({'size': [160,240], 'shots': [{'file': str(generated),'start': .2,'end': 1.43},{'file': str(generated),'start':1.43,'end':2.61}], 'audio':str(original), 'originalAudio':True}, self.folder('compose'))
        meta = w.probe(result['file'])
        self.assertLess(abs(float(meta['format']['duration'])-2.41), .1)
        streams = meta['streams']
        self.assertEqual([s['codec_name'] for s in streams], ['h264','aac'])
        # Frequency proves source audio was used rather than generated clip audio.
        raw = self.root/'audio.raw'
        w.run([w.ffmpeg(),'-v','error','-y','-i',result['file'],'-vn','-f','f32le','-ac','1','-ar','8000',str(raw)])
        import numpy as np
        x = np.fromfile(raw, dtype=np.float32)
        freq = np.fft.rfftfreq(len(x), 1/8000)[np.argmax(abs(np.fft.rfft(x)))]
        self.assertLess(abs(freq-400), 5)

    def test_replacement_audio_padded_and_silent_output_has_no_generated_sound(self):
        generated = self.clip('generated.mp4', 2, sound=1200)
        replacement = self.clip('replacement.mp4', .4, sound=600)
        data = {'size':[160,240],'shots':[{'file':str(generated),'start':0,'end':1.8}]}
        result=w.compose({**data,'audio':str(replacement),'originalAudio':False},self.folder('replace'))
        self.assertLess(abs(float(w.probe(result['file'])['format']['duration'])-1.8),.1)
        result=w.compose(data,self.folder('silent'))
        self.assertEqual(len(w.probe(result['file'])['streams']),1)

    def test_short_candidate_fails_without_publishing(self):
        generated = self.clip('short.mp4', .5)
        with self.assertRaisesRegex(ValueError, '比保留时长短'):
            w.compose({'size':[160,240],'shots':[{'file':str(generated),'start':0,'end':2}]}, self.folder('compose'))


if __name__ == '__main__':
    unittest.main()
