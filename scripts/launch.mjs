import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

async function exists(file) { return fs.access(file).then(() => true, () => false); }

export async function findNpm() {
  const bin = path.dirname(process.execPath);
  const candidates = [process.env.npm_execpath,
    path.join(bin, 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(bin, '../lib/node_modules/npm/bin/npm-cli.js')];
  if (process.platform !== 'win32') {
    for (const entry of (process.env.PATH || '').split(path.delimiter)) {
      try { candidates.push(await fs.realpath(path.join(entry, 'npm'))); } catch { /* Next PATH entry. */ }
    }
  }
  for (const file of candidates) if (file && path.basename(file) === 'npm-cli.js' && await exists(file)) return file;
  throw Error('运行组件不完整。请关闭工作台，再双击“修复环境”。');
}

function run(args, root, quiet = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {cwd: root, stdio: quiet ? 'ignore' : 'inherit'});
    const stop = signal => child.kill(signal);
    const interrupt = () => stop('SIGINT'), terminate = () => stop('SIGTERM');
    process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
    const cleanup = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', (code, signal) => {
      cleanup();
      if (signal) { const error = Error('启动已取消。'); error.cancelled = true; reject(error); }
      else if (code === 0) resolve();
      else reject(Error(`命令执行失败（${code}），请查看上方信息后重试。`));
    });
  });
}

export async function prepareLaunch(root) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw Error('运行组件版本不兼容，请双击“修复环境”。');
  for (const file of ['dist/index.html', 'dist-server/index.js', 'scripts/start.mjs', 'package-lock.json']) {
    if (!await exists(path.join(root, file))) throw Error(`程序包缺少 ${file}。请重新下载并完整解压 ZIP，再双击启动。`);
  }
  const fingerprint = createHash('sha256').update(await fs.readFile(path.join(root, 'package-lock.json')))
    .update(`${process.platform}/${process.arch}/${process.versions.node.split('.')[0]}`).digest('hex');
  const marker = path.join(root, 'node_modules/.studio-launch-ready');
  let ready = await fs.readFile(marker, 'utf8').then(value => value === fingerprint, () => false);
  if (ready) {
    try { await run(['--input-type=module', '-e', "await import('fastify'); await import('node:sqlite'); const {default:sharp}=await import('sharp'); await sharp({create:{width:1,height:1,channels:3,background:'#fff'}}).png().toBuffer();"], root, true); }
    catch (error) { if (error.cancelled) throw error; ready = false; }
  }
  if (!ready) {
    const data = path.resolve(root, process.env.STUDIO_DATA || 'data');
    const pid = await fs.readFile(path.join(data, 'server.lock'), 'utf8').then(value => Number(value.trim()), () => 0);
    if (Number.isInteger(pid) && pid > 0) {
      let running = true;
      try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') running = false; }
      if (running) throw Error('工作台仍在运行，请先关闭启动窗口，再准备或修复环境。');
    }
    console.log('首次启动或依赖发生变化，正在准备运行环境。需要联网，请保留此窗口。');
    try { await run([await findNpm(), 'ci', '--omit=dev', '--no-audit', '--no-fund'], root); }
    catch (error) { if (error.cancelled) throw error; throw Error(`${error.message}\n依赖安装未完成。请检查网络后重试，或双击“修复环境”。`); }
    await fs.writeFile(marker, fingerprint);
  }
  console.log('运行环境已就绪。');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = path.resolve(import.meta.dirname, '..');
    process.chdir(root);
    await prepareLaunch(root);
    if (process.argv.includes('--setup')) console.log('环境检查通过。现在可以双击启动工作台。');
    else {
      console.log('正在启动工作台，请保留此窗口……');
      process.env.STUDIO_OPEN_BROWSER ??= '1';
      await import(pathToFileURL(path.join(root, 'scripts/start.mjs')).href);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
