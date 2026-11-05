import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('AI 创作工作台需要 Node.js 24 或更新版本。'); process.exit(1);
}
process.chdir(path.resolve(import.meta.dirname, '..'));
if (!fs.existsSync('dist-server/index.js') || !fs.existsSync('dist/index.html')) {
  console.error('请先运行 npm run build。'); process.exit(1);
}
async function available(port) {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}
let port = Number(process.env.PORT || 4310);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须为 1–65535。');
while (!(await available(port))) { if (port === 65535) throw new Error('未找到可用端口'); port++; }
const child = spawn(process.execPath, ['dist-server/index.js'], { env: { ...process.env, PORT: String(port) }, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
console.log(`浏览器访问：http://127.0.0.1:${port} · 关闭此窗口将停止后台任务`);
