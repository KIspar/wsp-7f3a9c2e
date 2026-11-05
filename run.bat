@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title AI 创作工作台
if exist runtime\node\node.exe (
  runtime\node\node.exe scripts\portable-launch.mjs
  if errorlevel 1 pause
  exit /b
)
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 24 LTS 或更新版本：https://nodejs.org/
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 (
  echo 需要 Node.js 24 或更新版本，请升级后重试。
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci
  if errorlevel 1 goto :failed
)
call npm run build
if errorlevel 1 goto :failed
call npm start
if errorlevel 1 goto :failed
exit /b 0
:failed
echo 启动失败，请查看上方错误信息。
pause
exit /b 1
