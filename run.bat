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
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap-windows.ps1" -Mode Start
if errorlevel 1 goto :failed
exit /b 0
:failed
echo.
echo 启动未完成。请检查网络，或双击 Windows-修复环境.bat 后重试。
pause
exit /b 1
