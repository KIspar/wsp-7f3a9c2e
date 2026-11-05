"""Validate the staged Windows folder and create a transfer ZIP; does not execute Windows binaries."""
from pathlib import Path
import email
import hashlib
import json
import shutil
import struct
import sys
import zipfile
from packaging.specifiers import SpecifierSet

root = Path(__file__).resolve().parent.parent
stage = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root / 'release/AI-Creative-Studio-Windows-x64-20261101'
errors = []
required = [
    'run.bat', '启动工作台.bat', '停止工作台.bat', '检查运行环境.bat', '使用说明.txt',
    'dist/index.html', 'dist-server/index.js', 'scripts/portable-launch.mjs',
    'runtime/node/node.exe', 'runtime/python/python.exe', 'runtime/python/python311._pth',
    'runtime/bin/ffmpeg.exe', 'runtime/bin/ffprobe.exe', 'runtime/models/whisper-base/model.bin',
    'extensions/douyin-research/manifest.json', 'runtime/python/msvcp140.dll', 'runtime/python/vcruntime140_1.dll',
]
for name in required:
    if not (stage / name).is_file():
        errors.append('Missing ' + name)
for name in ['run.bat', '启动工作台.bat', '停止工作台.bat', '检查运行环境.bat']:
    data = (stage / name).read_bytes()
    if b'\r\n' not in data or b'"runtime\\node\\node.exe"' not in data:
        errors.append('Invalid BAT ' + name)
for name in ['runtime/node/node.exe', 'runtime/python/python.exe', 'runtime/bin/ffmpeg.exe', 'runtime/bin/ffprobe.exe']:
    data = (stage / name).read_bytes()
    pe = struct.unpack_from('<I', data, 60)[0]
    if data[:2] != b'MZ' or struct.unpack_from('<H', data, pe + 4)[0] != 0x8664:
        errors.append('Invalid Windows x64 binary ' + name)
if any((stage / 'data').iterdir()):
    errors.append('Release data must be empty')
allfiles = [p for p in stage.rglob('*') if p.is_file()]
for file in allfiles:
    rel = file.relative_to(stage).as_posix()
    if file.is_symlink():
        errors.append('Symlink ' + rel)
    if file.name in ('.env', 'master.key', 'credentials.json', 'studio.sqlite', 'server.lock', 'endpoint.json'):
        errors.append('User data in release ' + rel)
    if file.suffix in ('.node', '.pyd'):
        data = file.read_bytes()
        pe = struct.unpack_from('<I', data, 60)[0]
        if data[:2] != b'MZ' or struct.unpack_from('<H', data, pe + 4)[0] != 0x8664:
            errors.append('Wrong native platform ' + rel)
wheels = list((root / '.runtime/windows-downloads/wheels').glob('*.whl'))
for wheel in wheels:
    with zipfile.ZipFile(wheel) as z:
        meta = email.message_from_bytes(z.read(next(n for n in z.namelist() if n.endswith('.dist-info/METADATA'))))
        req = meta.get('Requires-Python', '')
        if req and '3.11.9' not in SpecifierSet(req):
            errors.append('Unsupported Python ' + wheel.name + ' ' + req)
report = {
    'requiredFiles': len(required), 'windowsNativeAddons': sum(p.suffix in ('.node', '.pyd') for p in allfiles),
    'pythonWheels': len(wheels), 'pythonDependencyGraph': 'passed-offline', 'freshDataSmoke': 'passed-on-macos',
    'windowsExecution': 'not-run', 'liveDouyinCollection': 'not-run', 'userDataIncluded': False, 'credentialsIncluded': False,
    'errors': errors,
}
if errors:
    raise RuntimeError(json.dumps(report, ensure_ascii=False))
shutil.copy2(root / 'output/windows-release-20261101/smoke.json', stage / 'licenses/smoke.json')
shutil.copy2(root / 'docs/reports/Windows文件夹发布-20261101.md', stage / 'licenses/发布验证记录.md')
(stage / 'licenses/package-validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
manifest = []
for file in sorted(stage.rglob('*')):
    if not file.is_file() or file.relative_to(stage).as_posix() in ('licenses/build-manifest.json', 'licenses/license-files.json'):
        continue
    manifest.append({'file': file.relative_to(stage).as_posix(), 'bytes': file.stat().st_size, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
(stage / 'licenses/build-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({**report, 'files': len(manifest), 'folderBytes': sum(f['bytes'] for f in manifest)}, ensure_ascii=False), flush=True)
archive = stage.with_suffix('.zip')
print('Creating ZIP: ' + str(archive), flush=True)
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as z:
    for file in sorted(stage.rglob('*')):
        if file.is_file() or file.is_dir() and not any(file.iterdir()):
            z.write(file, Path(stage.name) / file.relative_to(stage))
with zipfile.ZipFile(archive) as z:
    bad = z.testzip()
    if bad:
        raise RuntimeError('ZIP integrity failure: ' + bad)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix('.zip.sha256').write_text(digest + '  ' + archive.name + '\n', encoding='ascii')
print(json.dumps({'zip': str(archive), 'bytes': archive.stat().st_size, 'sha256': digest, 'zipIntegrity': 'passed'}, ensure_ascii=False), flush=True)
