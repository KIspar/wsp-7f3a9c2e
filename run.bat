@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Workspace
if exist runtime\node\node.exe (
  runtime\node\node.exe scripts\portable-launch.mjs
  if errorlevel 1 goto :failed
  exit /b 0
)
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 24 或更新版本（包含 npm）：https://nodejs.org/
  goto :failed
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 (
  echo 需要 Node.js 24 或更新版本，请升级后重试：https://nodejs.org/
  goto :failed
)
node scripts\launch.mjs
if errorlevel 1 goto :failed
exit /b 0
:failed
echo.
echo 启动未完成，请保留上方错误信息。检查环境后可再次双击 run.bat。
pause
exit /b 1
