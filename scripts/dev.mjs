import { spawn } from "node:child_process";
import net from "node:net";

async function available(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

let port = Number(process.env.PORT || 4310);
while (!(await available(port))) port++;
const env = { ...process.env, PORT: String(port) };
const server = spawn(process.execPath, ["--import", "tsx", "apps/server/index.ts"], {
  env, stdio: "inherit",
});
// Vite reads the selected API port, including when the preferred port is occupied.
const web = spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
  env: { ...env, API_PORT: String(port) }, stdio: "inherit",
});
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  server.kill("SIGTERM");
  web.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500).unref();
}
server.on("exit", (code) => stop(code ?? 1));
web.on("exit", (code) => stop(code ?? 1));
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
