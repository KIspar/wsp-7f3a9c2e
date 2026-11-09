param([ValidateSet('Start','Setup','Repair')][string]$Mode = 'Start')
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $Root
$Node = Join-Path $Root '.runtime\node\node.exe'
$Stage = $null
$Lock = $null
$MovedNode = $false
$MovedModules = $false
$InstalledNode = $false
$InstalledModules = $false
$Committed = $false
function Test-Node([string]$File) {
  if (!(Test-Path -LiteralPath $File)) { return $false }
  try { & $File -e "process.exit(Number(process.versions.node.split('.')[0])>=24?0:1)" 2>$null; return $LASTEXITCODE -eq 0 } catch { return $false }
}
try {
  if ($Mode -eq 'Repair' -or !(Test-Node $Node)) {
    $Data = if ($env:STUDIO_DATA) { $env:STUDIO_DATA } else { Join-Path $Root 'data' }
    $ServerLock = Join-Path $Data 'server.lock'
    if (Test-Path -LiteralPath $ServerLock) {
      $ServerPid = (Get-Content -LiteralPath $ServerLock -Raw).Trim()
      if ($ServerPid -match '^\d+$' -and (Get-Process -Id ([int]$ServerPid) -ErrorAction SilentlyContinue)) { throw '工作台仍在运行。请先关闭启动窗口，再安装或修复环境。' }
    }
    $Runtime = Join-Path $Root '.runtime'
    [IO.Directory]::CreateDirectory($Runtime) | Out-Null
    $LockDir = Join-Path $Runtime 'setup.lock'
    if (Test-Path -LiteralPath $LockDir) {
      $OwnerFile = Join-Path $LockDir 'pid'
      $Owner = if (Test-Path -LiteralPath $OwnerFile) { (Get-Content -LiteralPath $OwnerFile -Raw).Trim() } else { '' }
      if ($Owner -notmatch '^\d+$' -or (Get-Process -Id ([int]$Owner) -ErrorAction SilentlyContinue)) { throw '另一个环境安装正在运行，请稍后重试。' }
      Remove-Item -LiteralPath $LockDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $LockDir -ErrorAction Stop | Out-Null
    $Lock = $LockDir
    [IO.File]::WriteAllText((Join-Path $Lock 'pid'), [string]$PID)
    $Stage = Join-Path $Runtime ('setup-' + [guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($Stage) | Out-Null
    $Version = (Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version
    if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw '程序版本信息不完整，请重新解压完整下载包。' }
    $Machine = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $Arch = switch ($Machine) { 'AMD64' { 'x64' } 'ARM64' { 'arm64' } default { throw '当前处理器暂不支持。' } }
    $Asset = "studio-runtime-win32-$Arch.zip"
    $Archive = Join-Path $Stage $Asset
    $Checksum = "$Archive.sha256"
    Write-Host '正在准备本机运行环境，无需手动安装软件。首次准备需要联网，请保留此窗口……'
    if ($env:STUDIO_RUNTIME_ASSET_DIR) {
      Copy-Item -LiteralPath (Join-Path $env:STUDIO_RUNTIME_ASSET_DIR $Asset) -Destination $Archive
      Copy-Item -LiteralPath (Join-Path $env:STUDIO_RUNTIME_ASSET_DIR "$Asset.sha256") -Destination $Checksum
    } else {
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $Url = "https://github.com/KIspar/wsp-7f3a9c2e/releases/download/v$Version/$Asset"
      $ProgressPreference = 'SilentlyContinue'
      Invoke-WebRequest -Uri $Url -OutFile $Archive -UseBasicParsing -TimeoutSec 900
      Invoke-WebRequest -Uri "$Url.sha256" -OutFile $Checksum -UseBasicParsing -TimeoutSec 60
    }
    $Expected = ((Get-Content -LiteralPath $Checksum -Raw).Trim() -split '\s+')[0]
    $Actual = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash
    if ($Expected -notmatch '^[a-fA-F0-9]{64}$' -or $Actual -ne $Expected) { throw '下载文件校验失败，已停止安装。请重新运行修复环境。' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $Zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
      foreach ($Entry in $Zip.Entries) {
        $Name = $Entry.FullName
        if (($Name -cnotlike '.runtime/node/*' -and $Name -cnotlike 'node_modules/*') -or $Name.Contains('\') -or $Name.Contains(':') -or $Name -match '(^|/)\.{1,2}(/|$)') { throw '环境包路径无效，已停止安装。' }
        if ((($Entry.ExternalAttributes -shr 16) -band 61440) -eq 40960) { throw '环境包禁止符号链接。' }
      }
    } finally { $Zip.Dispose() }
    $Files = Join-Path $Stage 'files'
    [IO.Compression.ZipFile]::ExtractToDirectory($Archive, $Files)
    $IncomingNode = Join-Path $Files '.runtime\node\node.exe'
    if (!(Test-Node $IncomingNode) -or !(Test-Path -LiteralPath (Join-Path $Files 'node_modules\.studio-launch-ready'))) { throw '运行环境不完整或与当前电脑不兼容，已保留原环境。' }
    $LiveNode = Join-Path $Root '.runtime\node'
    $LiveModules = Join-Path $Root 'node_modules'
    if (Test-Path -LiteralPath $LiveNode) { Move-Item -LiteralPath $LiveNode -Destination (Join-Path $Stage 'previous-node'); $MovedNode = $true }
    if (Test-Path -LiteralPath $LiveModules) { Move-Item -LiteralPath $LiveModules -Destination (Join-Path $Stage 'previous-modules'); $MovedModules = $true }
    Move-Item -LiteralPath (Join-Path $Files '.runtime\node') -Destination $LiveNode; $InstalledNode = $true
    Move-Item -LiteralPath (Join-Path $Files 'node_modules') -Destination $LiveModules; $InstalledModules = $true
    $env:PATH = "$(Join-Path $Root '.runtime\node');$env:PATH"
    & $Node scripts/launch.mjs --setup
    if ($LASTEXITCODE -ne 0) { throw '运行环境检查未通过，正在恢复原环境。' }
    $Committed = $true
    Write-Host '本机运行环境已准备好。'
  }
  if ($Stage -and $Committed) { Remove-Item -LiteralPath $Stage -Recurse -Force; $Stage = $null }
  if ($Lock) { Remove-Item -LiteralPath $Lock -Recurse -Force; $Lock = $null }
  $env:PATH = "$(Join-Path $Root '.runtime\node');$env:PATH"
  if ($Mode -eq 'Start') { & $Node scripts/launch.mjs } else { & $Node scripts/launch.mjs --setup }
  $Result = $LASTEXITCODE
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host '未更改你的作品、配置和 API 密钥。可稍后双击“修复环境”重试。'
  $Result = 1
} finally {
  if ($Stage -and !$Committed) {
    if ($InstalledNode) { Remove-Item -LiteralPath (Join-Path $Root '.runtime\node') -Recurse -Force }
    if ($InstalledModules) { Remove-Item -LiteralPath (Join-Path $Root 'node_modules') -Recurse -Force }
    if ($MovedNode) { Move-Item -LiteralPath (Join-Path $Stage 'previous-node') -Destination (Join-Path $Root '.runtime\node') }
    if ($MovedModules) { Move-Item -LiteralPath (Join-Path $Stage 'previous-modules') -Destination (Join-Path $Root 'node_modules') }
  }
  if ($Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue }
  if ($Lock) { Remove-Item -LiteralPath $Lock -Recurse -Force -ErrorAction SilentlyContinue }
}
exit $Result
