# Build host only: Windows 11 x64 with Node 24+. End users never run this script.
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitProcess) { throw '需要 Windows x64 打包环境' }
function Checked { param([scriptblock]$Command); & $Command; if ($LASTEXITCODE -ne 0) { throw '打包命令失败' } }
Checked { npm ci }
Checked { npm run build }
$Stage = Join-Path $Root ('release/creative-studio-win-x64-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $Stage | Out-Null
foreach ($Name in @('dist','dist-server','skills','public','resources','extensions','apps/video-worker','scripts/portable-launch.mjs','package.json','package-lock.json')) {
 $Dest = Join-Path $Stage $Name
 New-Item -ItemType Directory -Force -Path (Split-Path $Dest) | Out-Null
 Copy-Item -Recurse -Path (Join-Path $Root $Name) -Destination $Dest
}
New-Item -ItemType Directory -Force -Path "$Stage/runtime/node","$Stage/runtime/python","$Stage/runtime/bin","$Stage/runtime/models","$Stage/licenses" | Out-Null
$NodeVersion = '24.14.0'
Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" -OutFile "$Stage/node.zip"
Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" -OutFile "$Stage/node-sha.txt"
$Expected = ((Get-Content "$Stage/node-sha.txt" | Select-String " node-v$NodeVersion-win-x64.zip$").ToString() -split '\s+')[0]
if ((Get-FileHash "$Stage/node.zip" -Algorithm SHA256).Hash.ToLower() -ne $Expected) { throw 'Node 下载校验失败' }
Expand-Archive "$Stage/node.zip" "$Stage/node-unpacked"
Copy-Item "$Stage/node-unpacked/node-v$NodeVersion-win-x64/node.exe" "$Stage/runtime/node/node.exe"
Copy-Item "$Stage/node-unpacked/node-v$NodeVersion-win-x64/LICENSE" "$Stage/licenses/Node-LICENSE.txt"
Invoke-WebRequest 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip' -OutFile "$Stage/python.zip"
Expand-Archive "$Stage/python.zip" "$Stage/runtime/python"
@('python311.zip','.','Lib/site-packages','import site') | Set-Content -Encoding ASCII "$Stage/runtime/python/python311._pth"
Invoke-WebRequest 'https://bootstrap.pypa.io/get-pip.py' -OutFile "$Stage/get-pip.py"
$Python = "$Stage/runtime/python/python.exe"
Checked { & $Python "$Stage/get-pip.py" --no-warn-script-location }
Checked { & $Python -m pip install --no-warn-script-location -r "$Stage/apps/video-worker/requirements.txt" -c "$Root/scripts/windows-python-constraints.txt" 'msvc-runtime==14.44.35112' 'colorama==0.4.6' 'pyreadline3==3.5.6' }
$env:STUDIO_PACKAGE_MODEL = "$Stage/runtime/models/whisper-base"
Checked { & $Python -c "import os; from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-base',revision='ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66',local_dir=os.environ['STUDIO_PACKAGE_MODEL'])" }
$Ffmpeg = & $Python -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'
Copy-Item $Ffmpeg "$Stage/runtime/bin/ffmpeg.exe"
Push-Location $Stage
Checked { npm ci --omit=dev }
Copy-Item 'node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe' 'runtime/bin/ffprobe.exe'
$env:STUDIO_FFMPEG = "$Stage/runtime/bin/ffmpeg.exe"
$env:STUDIO_FFPROBE = "$Stage/runtime/bin/ffprobe.exe"
$env:STUDIO_WHISPER_MODEL = "$Stage/runtime/models/whisper-base"
Checked { & $Python 'apps/video-worker/worker.py' doctor }
npm ls --omit=dev --all --json | Set-Content -Encoding UTF8 'licenses/node-dependencies.json'
Get-ChildItem 'node_modules' -Recurse -File | Where-Object { $_.Name -match '^(LICENSE|COPYING|NOTICE)' } | ForEach-Object { $Rel = $_.FullName.Substring($Stage.Length + 1); $Dest = Join-Path 'licenses' $Rel; New-Item -ItemType Directory -Force (Split-Path $Dest) | Out-Null; Copy-Item $_.FullName $Dest }
& $Python -m pip freeze | Set-Content -Encoding UTF8 'licenses/python-dependencies.txt'
Get-ChildItem 'runtime/python/Lib/site-packages' -Recurse -File | Where-Object { $_.Name -match '^(LICENSE|COPYING|NOTICE)' } | ForEach-Object { $Rel = $_.FullName.Substring($Stage.Length + 1); $Dest = Join-Path 'licenses' $Rel; New-Item -ItemType Directory -Force (Split-Path $Dest) | Out-Null; Copy-Item $_.FullName $Dest }
@('@echo off','chcp 65001 >nul','cd /d "%~dp0"','"runtime\node\node.exe" "scripts\portable-launch.mjs"','if errorlevel 1 pause') | Set-Content -Encoding ASCII '启动工作台.bat'
@('@echo off','chcp 65001 >nul','cd /d "%~dp0"','"runtime\node\node.exe" "scripts\portable-launch.mjs" --stop','if errorlevel 1 pause') | Set-Content -Encoding ASCII '停止工作台.bat'
@('@echo off','chcp 65001 >nul','cd /d "%~dp0"','"runtime\node\node.exe" "scripts\portable-launch.mjs" --check','pause') | Set-Content -Encoding ASCII '检查运行环境.bat'
Copy-Item '启动工作台.bat' 'run.bat'
@('文件夹版：双击启动工作台.bat。','运行仅需要本机浏览器和联网访问供应商接口。','数据与私有凭据保存在 data；不要把 private 目录发给别人。','使用停止工作台.bat安全停止。关闭浏览器不停止任务。','本地解析不收费，AI分析、图片及视频生成使用各自已配置密钥。') | Set-Content -Encoding UTF8 '使用说明.txt'
Remove-Item 'node.zip','node-sha.txt','python.zip','get-pip.py','node-unpacked' -Recurse
Get-ChildItem 'runtime','dist','dist-server','apps/video-worker' -Recurse -File | ForEach-Object { [PSCustomObject]@{file=$_.FullName.Substring($Stage.Length+1);sha256=(Get-FileHash $_.FullName -Algorithm SHA256).Hash;bytes=$_.Length} } | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 'licenses/build-manifest.json'
Pop-Location
Write-Host "构建完成：$Stage。仍须在无开发环境的 Windows 11 x64 上验收。"
