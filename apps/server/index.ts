import path from "node:path";
import fs from "node:fs";
import { createStore } from "./store";
import { createApp } from "./app";

const root = path.resolve(process.env.STUDIO_ROOT || ".");
const dataDir = path.resolve(process.env.STUDIO_DATA || path.join(root, "data"));
fs.mkdirSync(dataDir, { recursive: true });
const lock = path.join(dataDir, "server.lock");
if (fs.existsSync(lock)) {
  const pid = Number(fs.readFileSync(lock, "utf8"));
  try {
    process.kill(pid, 0);
    throw new Error(`此数据目录已由进程 ${pid} 使用，请使用已运行的工作台。`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    fs.rmSync(lock);
  }
}
fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
const store = createStore(dataDir, root);
const app = await createApp(store);
let closing = false;
if(process.env.STUDIO_PORTABLE==='1')app.post('/api/local/shutdown',async(_request,reply)=>{reply.send({stopping:true});setTimeout(()=>void close().then(()=>process.exit(0)),100);});
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  store.close();
  fs.rmSync(lock, { force: true });
}
process.on("SIGINT", () => void close().then(() => process.exit(0)));
process.on("SIGTERM", () => void close().then(() => process.exit(0)));
try {
  const url = await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT || 4310) });
  console.log(`AI 创作工作台 API: ${url} · 真实媒体生成 / 商品采集 / AI 辅助按需调用`);
} catch (error) {
  await close();
  console.error(error);
  process.exit(1);
}
