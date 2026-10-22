[CmdletBinding()]
param(
    [ValidateSet('auto','libx264','h264_qsv')][string]$Encoder,
    [ValidateSet('720p','1080p')][string]$Profile,
    [switch]$Headless
)
. (Join-Path $PSScriptRoot 'common.ps1')
$settings = Read-Settings
New-Item -ItemType Directory -Path $settings.dataDirectory -Force | Out-Null
$startLock = $null
try { $startLock = [IO.File]::Open((Join-Path $settings.dataDirectory 'start.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
catch { throw '此服务的启动窗口或登录任务已经在运行。' }
try {
    if ($null -ne (Get-OwnedServer $settings)) { throw '本项目服务已启动；请使用原窗口或先运行 stop.ps1。' }
    if (!(Test-Path -LiteralPath $settings.nodePath) -or !(Test-Path -LiteralPath $settings.ffmpegPath)) { throw '运行库缺失，请重新运行 setup.ps1。' }
    $main = Join-Path $script:AppRoot 'server\src\main.mjs'
    if (!(Test-Path -LiteralPath $main)) { throw '找不到 server/src/main.mjs。' }
    $env:HONGGUO_DATA_DIR = $settings.dataDirectory
    $env:HONGGUO_FFMPEG = $settings.ffmpegPath
    $env:HONGGUO_PORT = [string]$settings.port
    $env:HONGGUO_BIND = $settings.bind
    $env:HONGGUO_ENCODER = $settings.encoder
    $env:HONGGUO_PROFILE = $settings.profile
    if ($Encoder) { $env:HONGGUO_ENCODER = $Encoder }
    if ($Profile) { $env:HONGGUO_PROFILE = $Profile }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $outLog = Join-Path $settings.dataDirectory "server-$stamp.log"
    $errLog = Join-Path $settings.dataDirectory "server-$stamp.error.log"
    # ProcessStartInfo 风格的 Windows 参数引用；应用路径允许空格和中文。
    $arguments = '--use-env-proxy "' + $main + '"'
    $child = Start-Process -FilePath $settings.nodePath -ArgumentList $arguments -WorkingDirectory $script:AppRoot -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru
    $child.Refresh()
    if ($child.HasExited) { throw "服务启动失败，查看 $errLog" }
    $pidFile = Join-Path $settings.dataDirectory 'server.pid.json'
    Write-JsonFile ([ordered]@{processId=$child.Id;startTimeUtcTicks=$child.StartTime.ToUniversalTime().Ticks.ToString();nodePath=$settings.nodePath;mainPath=$main;ffmpegPath=$settings.ffmpegPath}) $pidFile
    Write-Host "红果 TV 家庭服务已启动；局域网端口 $($settings.port)，发现端口 UDP 8752。"
    Write-Host '配对码见下方输出；停止服务请另开 PowerShell 执行 windows\stop.ps1。'
    Write-Host "日志：$outLog"
    $readers = @()
    try {
        foreach ($path in @($outLog,$errLog)) {
            $stream = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
            $readers += New-Object IO.StreamReader($stream, (New-Object Text.UTF8Encoding($false)))
        }
        while ($true) {
            foreach ($reader in $readers) {
                while (!$reader.EndOfStream) { $line = $reader.ReadLine(); if (!$Headless) { Write-Host $line } }
            }
            $child.Refresh()
            if ($child.HasExited) { break }
            Start-Sleep -Milliseconds 200
        }
    } finally { foreach ($reader in $readers) { $reader.Dispose() } }
    $child.WaitForExit()
    if (Test-Path -LiteralPath $pidFile) {
        $record = Get-Content -LiteralPath $pidFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ([int]$record.processId -eq $child.Id) { Remove-Item -LiteralPath $pidFile -Force }
    }
    if ($child.ExitCode -ne 0) { throw "服务退出，代码 $($child.ExitCode)。请查看 $errLog" }
} finally { if ($null -ne $startLock) { $startLock.Dispose() } }
