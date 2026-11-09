import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';

const source = path.resolve(import.meta.dirname, '..');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio runtime & 中文 '));
const assets = path.join(source, 'release/runtime');
const name = `studio-runtime-${process.platform}-${process.arch}.zip`;
async function run(mode, directory = assets) {
  const windows = process.platform === 'win32';
  const child = spawn(windows ? 'powershell.exe' : '/bin/sh', windows
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/bootstrap-windows.ps1'), '-Mode', mode]
    : [path.join(root, 'run.sh'), '--' + mode.toLowerCase()], {
    cwd: os.tmpdir(), env: {...process.env, STUDIO_RUNTIME_ASSET_DIR: directory, STUDIO_OPEN_BROWSER: '0'},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const timer = setTimeout(() => child.kill(), 180000);
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  return await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); resolve({code, output}); });
  });
}
try {
  for (const dir of ['scripts', 'dist', 'dist-server', 'data']) await fs.mkdir(path.join(root, dir));
  for (const file of ['package.json', 'package-lock.json', 'run.sh', 'scripts/launch.mjs', 'scripts/bootstrap-posix.sh', 'scripts/bootstrap-windows.ps1']) await fs.copyFile(path.join(source, file), path.join(root, file));
  await fs.writeFile(path.join(root, 'scripts/start.mjs'), "throw Error('Setup must not start the server');");
  await fs.writeFile(path.join(root, 'dist/index.html'), 'built'); await fs.writeFile(path.join(root, 'dist-server/index.js'), 'built');
  await fs.writeFile(path.join(root, 'data/keep.txt'), 'local data stays here');
  const setup = await run('Setup'); assert.equal(setup.code, 0, setup.output);
  const runtimeFile = path.join(root, '.runtime/node/runtime.json');
  const before = await fs.stat(runtimeFile);
  const again = await run('Setup'); assert.equal(again.code, 0, again.output);
  assert.equal((await fs.stat(runtimeFile)).mtimeMs, before.mtimeMs, 'Normal startup should reuse the environment');
  await fs.rm(path.join(root, 'node_modules/sharp'), {recursive: true});
  const repair = await run('Repair'); assert.equal(repair.code, 0, repair.output);
  await fs.access(path.join(root, 'node_modules/sharp/package.json'));
  await fs.writeFile(path.join(root, 'data/server.lock'), String(process.pid));
  const active = await run('Repair'); assert.equal(active.code, 1, active.output); assert.match(active.output, /仍在运行/);
  await fs.rm(path.join(root, 'data/server.lock'));
  const invalidAssets = path.join(root, 'invalid-assets'); await fs.mkdir(invalidAssets);
  await fs.copyFile(path.join(assets, name), path.join(invalidAssets, name));
  await fs.writeFile(path.join(invalidAssets, name + '.sha256'), '0'.repeat(64));
  const invalid = await run('Repair', invalidAssets); assert.equal(invalid.code, 1, invalid.output); assert.match(invalid.output, /校验失败/);
  await fs.access(runtimeFile); await fs.access(path.join(root, 'node_modules/sharp/package.json'));
  assert.equal(await fs.readFile(path.join(root, 'data/keep.txt'), 'utf8'), 'local data stays here');
  console.log(`PASS ${process.platform}/${process.arch}: no preinstalled private runtime, setup, reuse, repair, active-service protection, checksum rejection, data preservation`);
} finally { await fs.rm(root, {recursive: true, force: true}); }
