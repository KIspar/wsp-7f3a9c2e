#!/bin/sh
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' '找不到 Node.js。请先安装 Node.js 24 或更新版本：https://nodejs.org/'
  exit 1
fi
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' || {
  printf '%s\n' '需要 Node.js 24 或更新版本，请升级后重试：https://nodejs.org/'
  exit 1
}
exec node scripts/launch.mjs
