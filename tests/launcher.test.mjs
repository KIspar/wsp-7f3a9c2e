import {afterEach, describe, it, expect} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

const directories = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => fs.rm(dir, {recursive: true, force: true}))); });
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio launch & 中文 '));
  directories.push(dir);
  for (const name of ['scripts', 'dist', 'dist-server', '.runtime']) await fs.mkdir(path.join(dir, name));
  await fs.symlink(path.dirname(process.execPath), path.join(dir, '.runtime/node'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const name of ['run.bat', 'run.sh', 'Start.command', 'scripts/launch.mjs', 'scripts/bootstrap-posix.sh', 'scripts/bootstrap-windows.ps1']) {
    await fs.copyFile(path.join(import.meta.dirname, '..', name), path.join(dir, name));
  }
  await fs.writeFile(path.join(dir, 'package.json'), '{"type":"module"}');
  await fs.writeFile(path.join(dir, 'package-lock.json'), '{"version":"test"}');
  for (const name of ['dist/index.html', 'dist-server/index.js']) await fs.writeFile(path.join(dir, name), 'built');
  await fs.writeFile(path.join(dir, 'scripts/start.mjs'), `import {appendFileSync} from 'node:fs'; appendFileSync('started.txt', 'started\\n');`);
  await fs.writeFile(path.join(dir, 'npm-cli.js'), `
    import {promises as fs} from 'node:fs';
    await fs.appendFile('npm-calls.txt', JSON.stringify(process.argv.slice(2))+'\\n');
    if(process.env.LAUNCH_TEST_FAIL==='1')process.exit(31);
    await fs.mkdir('node_modules/fastify',{recursive:true});
    await fs.mkdir('node_modules/sharp',{recursive:true});
    for(const name of ['fastify','sharp'])await fs.writeFile('node_modules/'+name+'/package.json',JSON.stringify({type:'module',exports:'./index.js'}));
    await fs.writeFile('node_modules/fastify/index.js','export default function() {}');
    await fs.writeFile('node_modules/sharp/index.js','export default function() { return {png:()=>({toBuffer:async()=>Buffer.alloc(1)})} }');
  `);
  return dir;
}
function launch(dir, env = {}, mode = '--start') {
  const windows = process.platform === 'win32';
  // Windows environment keys are case-insensitive. Deduplicate npm's inherited
  // mixed-case npm_execpath before passing the fixture CLI to cmd.exe.
  const overrides = {npm_execpath: path.join(dir, 'npm-cli.js'), STUDIO_OPEN_BROWSER: '0', ...env};
  const overridden = new Set(Object.keys(overrides).map(key => key.toLowerCase()));
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !overridden.has(key.toLowerCase())));
  const useCmd = windows && mode === '--start';
  const child = spawn(windows ? (useCmd ? 'cmd.exe' : 'powershell.exe') : '/bin/sh', windows
    ? (useCmd ? ['/d', '/s', '/c', `""${path.join(dir, 'run.bat')}""`]
      : ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, 'scripts/bootstrap-windows.ps1'), '-Mode', mode === '--repair' ? 'Repair' : 'Setup'])
    : [path.join(dir, 'run.sh'), mode], {
    cwd: os.tmpdir(), windowsVerbatimArguments: useCmd,
    env: {...inherited, ...overrides},
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.on('error', () => {}); child.stdin.end('\r\n');
  return new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({code, output}));
  });
}
const calls = async dir => (await fs.readFile(path.join(dir, 'npm-calls.txt'), 'utf8')).trim().split('\n').map(JSON.parse);
describe('download package launcher', () => {
  it('checks and reuses a healthy environment during repair without network or npm', async () => {
    const dir = await fixture();
    expect(await launch(dir)).toMatchObject({code: 0});
    const result = await launch(dir, {LAUNCH_TEST_FAIL: '1', STUDIO_RUNTIME_ASSET_DIR: ''}, '--repair');
    expect(result).toMatchObject({code: 0});
    expect(result.output).toContain('无需联网重新下载');
    expect(await calls(dir)).toHaveLength(1);
  });
  it('reuses installed dependencies without a marker instead of reinstalling them', async () => {
    const dir = await fixture();
    expect(await launch(dir)).toMatchObject({code: 0});
    await fs.rm(path.join(dir, 'node_modules/.studio-launch-ready'));
    expect(await launch(dir, {LAUNCH_TEST_FAIL: '1'})).toMatchObject({code: 0});
    expect(await calls(dir)).toHaveLength(1);
  });
  it('keeps bundled dependencies reusable when lockfile line endings change across operating systems', async () => {
    const dir = await fixture();
    await fs.writeFile(path.join(dir, 'package-lock.json'), '{\n  "version": "test"\n}\n');
    expect(await launch(dir)).toMatchObject({code: 0});
    await fs.writeFile(path.join(dir, 'package-lock.json'), '{\r\n  "version": "test"\r\n}\r\n');
    expect(await launch(dir, {LAUNCH_TEST_FAIL: '1'})).toMatchObject({code: 0});
    expect(await calls(dir)).toHaveLength(1);
  });
  it('uses a compatible system Node when no private runtime was extracted', async () => {
    const dir = await fixture();
    await fs.rm(path.join(dir, '.runtime/node'));
    const result = await launch(dir, {PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH});
    expect(result).toMatchObject({code: 0});
    expect(await calls(dir)).toHaveLength(1);
  });
  it('launches from a folder containing spaces, symbols and Chinese; installs only once and refreshes changed or broken dependencies', async () => {
    const dir = await fixture();
    expect(await launch(dir)).toMatchObject({code: 0});
    expect(await calls(dir)).toEqual([['ci', '--omit=dev', '--no-audit', '--no-fund']]);
    expect(await launch(dir)).toMatchObject({code: 0});
    expect(await calls(dir)).toHaveLength(1);
    await fs.writeFile(path.join(dir, 'package-lock.json'), '{"version":"changed"}');
    expect(await launch(dir)).toMatchObject({code: 0});
    expect(await calls(dir)).toHaveLength(2);
    await fs.rm(path.join(dir, 'node_modules/sharp'), {recursive: true});
    expect(await launch(dir)).toMatchObject({code: 0});
    expect(await calls(dir)).toHaveLength(3);
    expect((await fs.readFile(path.join(dir, 'started.txt'), 'utf8')).trim().split('\n')).toHaveLength(4);
  }, 20000);
  it('keeps a failed first installation retryable and never starts an incomplete app', async () => {
    const dir = await fixture(), failed = await launch(dir, {LAUNCH_TEST_FAIL: '1'});
    expect(failed.code).toBe(1); expect(failed.output).toContain('依赖安装未完成');
    await expect(fs.access(path.join(dir, 'started.txt'))).rejects.toThrow();
    await expect(fs.access(path.join(dir, 'node_modules/.studio-launch-ready'))).rejects.toThrow();
    expect(await launch(dir)).toMatchObject({code: 0});
  }, 15000);
  it('reports an incomplete extraction before attempting dependency installation', async () => {
    const dir = await fixture(); await fs.rm(path.join(dir, 'dist/index.html'));
    const result = await launch(dir);
    expect(result.code).toBe(1); expect(result.output).toContain('完整解压');
    await expect(fs.access(path.join(dir, 'npm-calls.txt'))).rejects.toThrow();
  });
});
