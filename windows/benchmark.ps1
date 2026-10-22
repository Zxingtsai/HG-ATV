[CmdletBinding()]
param([string]$VideoPath)
. (Join-Path $PSScriptRoot 'common.ps1')
$settings = Read-Settings
if (!$VideoPath) { $VideoPath = Read-Host '输入本机真实视频的完整路径（用于测速）' }
$VideoPath = $VideoPath.Trim('"')
if (!(Test-Path -LiteralPath $VideoPath -PathType Leaf)) { throw '视频文件不存在，请指定本机真实视频文件。' }
$video = (Resolve-Path -LiteralPath $VideoPath).Path
New-Item -ItemType Directory -Path $settings.dataDirectory -Force | Out-Null
$benchmarkLock = $null
try { $benchmarkLock = [IO.File]::Open((Join-Path $settings.dataDirectory 'start.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
catch { throw '请先停止已运行的服务或另一场测速，再执行基准。' }
try {
    if ($null -ne (Get-OwnedServer $settings)) { throw '请先执行 stop.ps1 停止服务，避免播放与测速竞争资源。' }
    if (!(Test-Path -LiteralPath $settings.nodePath) -or !(Test-Path -LiteralPath $settings.ffmpegPath)) { throw '运行库缺失，请先运行 setup.ps1。' }
    $main = Join-Path $script:AppRoot 'server\src\main.mjs'
    if (!(Test-Path -LiteralPath $main)) { throw '找不到后端主程序。' }
    $env:HONGGUO_DATA_DIR = $settings.dataDirectory
    $env:HONGGUO_FFMPEG = $settings.ffmpegPath
    $env:HONGGUO_PORT = [string]$settings.port
    $env:HONGGUO_BIND = $settings.bind
    $env:HONGGUO_ENCODER = $settings.encoder
    $env:HONGGUO_PROFILE = $settings.profile
    Write-Host '使用本机视频进行真实短段转码测速，请等待结果。未通过测速前建议保持 720p。'
    & $settings.nodePath --use-env-proxy $main --benchmark $video
    if ($LASTEXITCODE -ne 0) { throw "测速未完成，退出代码 $LASTEXITCODE。请根据上方错误排查。" }
} finally { if ($null -ne $benchmarkLock) { $benchmarkLock.Dispose() } }
