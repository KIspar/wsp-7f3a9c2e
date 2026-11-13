#!/bin/sh
set -eu
cd -- "$(dirname -- "$0")/.."
studio_root=$(pwd -P)
studio_mode=${1:---start}
case "$studio_mode" in --start|--setup|--repair) ;; *) printf '%s\n' '启动选项无效。'; exit 1;; esac
case "$(uname -s)" in Darwin) studio_os=darwin;; Linux) studio_os=linux;; *) printf '%s\n' '当前系统暂不支持。'; exit 1;; esac
case "$(uname -m)" in arm64|aarch64) studio_arch=arm64;; x86_64|amd64) studio_arch=x64;; *) printf '%s\n' '当前处理器暂不支持。'; exit 1;; esac
if [ "$studio_os-$studio_arch" = linux-arm64 ]; then printf '%s\n' '当前安装包支持 Linux x64；Linux ARM 版暂未提供。'; exit 1; fi
studio_node="$studio_root/.runtime/node/node"
studio_stage=
studio_lock=
studio_moved_node=0
studio_moved_modules=0
studio_installed_node=0
studio_installed_modules=0
studio_committed=0
studio_fail() { printf '\n%s\n' "$1" '未更改你的作品、配置和 API 密钥。可稍后双击“修复环境”重试。' >&2; exit 1; }
studio_cleanup() {
  if [ "$studio_committed" -eq 0 ] && [ -n "$studio_stage" ]; then
    [ "$studio_installed_node" -eq 0 ] || rm -rf -- "$studio_root/.runtime/node"
    [ "$studio_installed_modules" -eq 0 ] || rm -rf -- "$studio_root/node_modules"
    [ "$studio_moved_node" -eq 0 ] || mv -- "$studio_stage/previous-node" "$studio_root/.runtime/node"
    [ "$studio_moved_modules" -eq 0 ] || mv -- "$studio_stage/previous-modules" "$studio_root/node_modules"
  fi
  [ -z "$studio_stage" ] || rm -rf -- "$studio_stage"
  [ -z "$studio_lock" ] || rm -rf -- "$studio_lock"
}
trap studio_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
studio_node_ready() { [ -x "$studio_node" ] && "$studio_node" -e 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:1)' >/dev/null 2>&1; }
studio_bundled_node=$studio_node
if ! studio_node_ready; then
  for studio_candidate in "$(command -v node 2>/dev/null || true)" /opt/homebrew/bin/node /usr/local/bin/node "${NVM_DIR:-${HOME:-}/.nvm}"/versions/node/*/bin/node; do
    [ -n "$studio_candidate" ] || continue
    studio_node=$studio_candidate
    if studio_node_ready; then break; fi
  done
  if ! studio_node_ready; then studio_node=$studio_bundled_node; fi
fi
studio_repair_needed=0
if [ "$studio_mode" = --repair ]; then
  if [ -n "${STUDIO_RUNTIME_ASSET_DIR:-}" ] || ! studio_node_ready || ! "$studio_node" scripts/launch.mjs --check-environment >/dev/null 2>&1; then
    studio_repair_needed=1
  else
    printf '%s\n' '本机运行环境检查通过，无需联网重新下载。'
  fi
fi

if [ "$studio_repair_needed" -eq 1 ] || ! studio_node_ready || { [ -n "${STUDIO_RUNTIME_ASSET_DIR:-}" ] && [ ! -x "$studio_bundled_node" ]; }; then
  studio_node=$studio_bundled_node
  studio_data=${STUDIO_DATA:-"$studio_root/data"}
  if [ -f "$studio_data/server.lock" ]; then
    studio_pid=$(cat "$studio_data/server.lock")
    case "$studio_pid" in ''|*[!0-9]*) ;; *) if kill -0 "$studio_pid" 2>/dev/null; then studio_fail '工作台仍在运行。请先关闭启动窗口，再安装或修复环境。'; fi;; esac
  fi
  command -v curl >/dev/null 2>&1 || studio_fail '系统缺少下载组件，无法准备环境。'
  command -v unzip >/dev/null 2>&1 || studio_fail '系统缺少解压组件，无法准备环境。'
  mkdir -p "$studio_root/.runtime"
  studio_lock_dir="$studio_root/.runtime/setup.lock"
  if ! mkdir "$studio_lock_dir" 2>/dev/null; then
    studio_owner=$(cat "$studio_lock_dir/pid" 2>/dev/null || true)
    case "$studio_owner" in ''|*[!0-9]*) studio_fail '另一个环境安装正在准备中，请稍后重试。';; esac
    if kill -0 "$studio_owner" 2>/dev/null; then studio_fail '另一个环境安装正在运行，请稍后重试。'; fi
    rm -rf -- "$studio_lock_dir"
    mkdir "$studio_lock_dir" || studio_fail '无法准备安装目录。'
  fi
  studio_lock=$studio_lock_dir
  printf '%s\n' "$$" > "$studio_lock/pid"
  studio_stage=$(mktemp -d "$studio_root/.runtime/setup.XXXXXXXX")
  studio_version=$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)".*/\1/p' package.json | head -n 1)
  [ -n "$studio_version" ] || studio_fail '程序版本信息不完整，请重新解压完整下载包。'
  studio_asset="studio-runtime-$studio_os-$studio_arch.zip"
  studio_archive="$studio_stage/$studio_asset"
  studio_checksum="$studio_archive.sha256"
  printf '%s\n' '正在准备本机运行环境，无需手动安装软件。首次准备需要联网，请保留此窗口……'
  if [ -n "${STUDIO_RUNTIME_ASSET_DIR:-}" ]; then
    cp -- "$STUDIO_RUNTIME_ASSET_DIR/$studio_asset" "$studio_archive"
    cp -- "$STUDIO_RUNTIME_ASSET_DIR/$studio_asset.sha256" "$studio_checksum"
  else
    studio_url="https://github.com/KIspar/wsp-7f3a9c2e/releases/download/v$studio_version/$studio_asset"
    curl --fail --location --retry 2 --connect-timeout 20 --max-time 900 --progress-bar "$studio_url" -o "$studio_archive" || studio_fail '无法从 GitHub 下载环境。可在能下载的电脑上取得对应系统的 studio-full 完整包，通过 U 盘传到本机，解压后启动。'
    curl --fail --location --retry 2 --connect-timeout 20 --max-time 60 --silent --show-error "$studio_url.sha256" -o "$studio_checksum" || studio_fail '无法取得环境校验文件，请稍后重试。'
  fi
  studio_expected=$(awk 'NR==1 {print $1}' "$studio_checksum" | tr 'A-F' 'a-f')
  if command -v shasum >/dev/null 2>&1; then studio_actual=$(shasum -a 256 "$studio_archive" | awk '{print $1}'); else studio_actual=$(sha256sum "$studio_archive" | awk '{print $1}'); fi
  [ "${#studio_expected}" -eq 64 ] && [ "$studio_actual" = "$studio_expected" ] || studio_fail '下载文件校验失败，已停止安装。请重新运行修复环境。'
  unzip -Z1 "$studio_archive" > "$studio_stage/entries"
  while IFS= read -r studio_entry; do
    case "$studio_entry" in .runtime/node/*|node_modules/*) ;; *) studio_fail '环境包包含不支持的文件，已停止安装。';; esac
    case "/$studio_entry/" in *'/../'*|*'/./'*|*'\'*|*':'*) studio_fail '环境包路径无效，已停止安装。';; esac
  done < "$studio_stage/entries"
  mkdir "$studio_stage/files"
  unzip -q "$studio_archive" -d "$studio_stage/files" || studio_fail '环境包解压失败，请重新运行修复环境。'
  studio_incoming="$studio_stage/files/.runtime/node/node"
  [ -f "$studio_incoming" ] && [ -f "$studio_stage/files/node_modules/.studio-launch-ready" ] || studio_fail '环境包不完整。'
  chmod u+x "$studio_incoming"
  "$studio_incoming" -e 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:1)' || studio_fail '运行环境与当前电脑不兼容，已保留原环境。'
  if [ -e "$studio_root/.runtime/node" ]; then mv -- "$studio_root/.runtime/node" "$studio_stage/previous-node"; studio_moved_node=1; fi
  if [ -e "$studio_root/node_modules" ]; then mv -- "$studio_root/node_modules" "$studio_stage/previous-modules"; studio_moved_modules=1; fi
  mv -- "$studio_stage/files/.runtime/node" "$studio_root/.runtime/node"; studio_installed_node=1
  mv -- "$studio_stage/files/node_modules" "$studio_root/node_modules"; studio_installed_modules=1
  PATH="$studio_root/.runtime/node:$PATH"; export PATH
  "$studio_node" scripts/launch.mjs --setup || studio_fail '运行环境检查未通过，正在恢复原环境。'
  studio_committed=1
  printf '%s\n' '本机运行环境已准备好。'
fi
studio_cleanup
studio_stage=; studio_lock=
trap - EXIT INT TERM
PATH="$(dirname -- "$studio_node"):$PATH"; export PATH
if [ "$studio_mode" = --start ]; then exec "$studio_node" scripts/launch.mjs; else exec "$studio_node" scripts/launch.mjs --setup; fi
