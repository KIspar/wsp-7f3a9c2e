"""Combine published application and native runtime ZIPs without local data."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
parser.add_argument('--platform', choices=['win32-x64', 'darwin-x64', 'darwin-arm64', 'linux-x64'])
args = parser.parse_args()
app_path = args.directory / 'studio-app.zip'
platforms = [args.platform] if args.platform else ['win32-x64', 'darwin-x64', 'darwin-arm64', 'linux-x64']
for platform in platforms:
    target = args.directory / ('studio-full-' + platform + '.zip')
    seen = set()
    with zipfile.ZipFile(app_path) as app, zipfile.ZipFile(args.directory / ('studio-runtime-' + platform + '.zip')) as runtime, zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
        pkg = json.loads(app.read('package.json'))
        info = json.loads(runtime.read('.runtime/node/runtime.json'))
        if info['version'] != pkg['version'] or info['platform'] + '-' + info['arch'] != platform:
            raise ValueError('Application/runtime version or platform mismatch')
        lock = app.read('package-lock.json').decode('utf-8').replace('\r\n', '\n')
        expected = hashlib.sha256((lock + info['platform'] + '/' + info['arch'] + '/' + info['node'].lstrip('v').split('.')[0]).encode('utf-8')).hexdigest()
        if runtime.read('node_modules/.studio-launch-ready').decode('utf-8') != expected:
            raise ValueError('Application/runtime dependency fingerprint mismatch')
        for archive, is_runtime in [(app, False), (runtime, True)]:
            for entry in archive.infolist():
                name = entry.filename
                path = PurePosixPath(name)
                if path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name or name in seen:
                    raise ValueError('Invalid or duplicate ZIP entry: ' + name)
                if is_runtime and not name.startswith(('.runtime/node/', 'node_modules/')):
                    raise ValueError('Unexpected runtime entry: ' + name)
                if not is_runtime and path.parts[0] in ['data', '.env', '.runtime', 'node_modules']:
                    raise ValueError('Unexpected application entry: ' + name)
                seen.add(name)
                with archive.open(entry) as source, output.open(entry, 'w', force_zip64=True) as destination:
                    shutil.copyfileobj(source, destination, length=1024 * 1024)
        required = ['node_modules/.studio-launch-ready', '.runtime/node/node.exe' if platform.startswith('win32') else '.runtime/node/node', 'Windows-启动.bat', 'Mac-启动.command']
        if not all(name in seen for name in required):
            raise ValueError('Missing launcher or runtime')
    print(target.name, target.stat().st_size, 'bytes', flush=True)
