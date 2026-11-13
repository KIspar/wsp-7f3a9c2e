// Native integration gate for the exact ZIP delivered to a new computer.
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';

const archive = path.resolve(process.argv[2] || `release/update/studio-full-${process.platform}-${process.arch}.zip`);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'Studio offline 中文 & test '));
const root = path.join(temporary, '工作台');
const windows = process.platform === 'win32';
const systemRoot = process.env.SystemRoot || 'C:\\Windows';
const powershell = path.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const cmd = path.join(systemRoot, 'System32/cmd.exe');
const cleanPath = windows ? [path.join(systemRoot, 'System32'), path.dirname(powershell)].join(path.delimiter) : '/usr/bin:/bin:/usr/sbin:/sbin';
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['path','npm_execpath','node_options','studio_data','studio_runtime_asset_dir','studio_open_browser','port'].includes(key.toLowerCase())));
const env = {...inherited, PATH: cleanPath, STUDIO_OPEN_BROWSER: '0', npm_config_offline: 'true'};
const marker = path.join(temporary, 'npm-attempted');
const sentinel = path.join(temporary, 'npm-cli.js');
let server;

function task(command, args, extra = {}) {
  const child = spawn(command, args, {cwd: temporary, env, ...extra, stdio: ['pipe','pipe','pipe']});
  child.stdin.on('error', () => {}); child.stdin.end('\r\n');
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const timer = setTimeout(() => child.kill(), 90000);
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); resolve({code, output}); });
  });
  return {child, done, output: () => output};
}
function setup(mode) {
  return windows
    ? task(powershell, ['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/bootstrap-windows.ps1'),'-Mode',mode])
    : task('/bin/sh', [path.join(root,'run.sh'),'--'+mode.toLowerCase()]);
}
try {
  const python = process.env.STUDIO_TEST_PYTHON || (windows ? 'python' : 'python3');
  const extract = task(python, ['-c', `
import json,pathlib,sys,zipfile
archive,root=sys.argv[1:]
with zipfile.ZipFile(archive) as z:
    names=z.namelist()
    assert not any(n.split('/')[0] in ('data','.env') for n in names), 'Local data in package'
    info=json.loads(z.read('.runtime/node/runtime.json'))
    pkg=json.loads(z.read('package.json'))
    assert info['version']==pkg['version']
    z.extractall(root)
    for entry in z.infolist():
        mode=(entry.external_attr>>16)&0o777
        if mode: (pathlib.Path(root)/entry.filename).chmod(mode)
`, archive, root], {env: process.env});
  const extracted = await extract.done; assert.equal(extracted.code, 0, extracted.output);
  const node = path.join(root, '.runtime/node', windows ? 'node.exe' : 'node');
  await fs.access(node);
  await fs.writeFile(sentinel, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'attempted'); process.exit(92);`);
  env.npm_execpath = sentinel;
  env.STUDIO_RUNTIME_ASSET_DIR = path.join(temporary, 'must-not-download');
  const installed = await setup('Setup').done; assert.equal(installed.code, 0, installed.output);
  delete env.STUDIO_RUNTIME_ASSET_DIR;
  const repaired = await setup('Repair').done; assert.equal(repaired.code, 0, repaired.output);
  assert.match(repaired.output, /无需联网重新下载/);
  await assert.rejects(fs.access(marker), 'Setup or repair attempted npm installation');
  // Port selection and /healthz are a backend startup integration check, not UI automation.
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  env.PORT = String(port);
  server = windows
    ? task(cmd, ['/d','/s','/c',`""${path.join(root,'Windows-启动.bat')}""`], {windowsVerbatimArguments: true})
    : task('/bin/sh', [path.join(root,'run.sh')]);
  let healthy = false;
  for (let attempt = 0; attempt < 100 && server.child.exitCode === null; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, {signal: AbortSignal.timeout(500)});
      if (response.ok) { healthy = true; break; }
    } catch { /* Wait for the spawned local service. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(healthy, 'Packaged service did not start: '+server.output());
  await assert.rejects(fs.access(marker), 'Startup attempted npm installation');
  console.log(`PASS complete ${process.platform}/${process.arch}: packaged Node, offline setup, offline repair, ${windows ? 'Windows BAT' : 'shell'} service startup, Chinese path, no npm install, no local data bundled`);
} finally {
  if (server && server.child.exitCode === null) {
    if (windows) await task(path.join(systemRoot,'System32/taskkill.exe'), ['/PID',String(server.child.pid),'/T','/F']).done;
    else {
      // Stop the supervised Node descendants before the parent shell exits.
      await task('/usr/bin/pkill', ['-TERM','-P',String(server.child.pid)]).done;
      server.child.kill('SIGTERM');
    }
    await server.done;
  }
  // Windows may retain file handles briefly while the process tree exits.
  await fs.rm(temporary, {recursive: true, force: true, maxRetries: 10, retryDelay: 200});
}
