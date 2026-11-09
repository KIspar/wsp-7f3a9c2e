@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap-windows.ps1" -Mode Setup
set "STUDIO_RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %STUDIO_RESULT%
