Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$script:AppRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script:SettingsFile = Join-Path $PSScriptRoot 'local.settings.json'

function Write-JsonFile($Value, [string]$Path) {
    $json = $Value | ConvertTo-Json -Depth 12
    [IO.File]::WriteAllText($Path, $json, (New-Object System.Text.UTF8Encoding($false)))
}
function Read-Settings {
    if (!(Test-Path -LiteralPath $script:SettingsFile)) { throw '请先运行 windows\setup.ps1。' }
    return Get-Content -LiteralPath $script:SettingsFile -Raw -Encoding UTF8 | ConvertFrom-Json
}
function Resolve-AppPath([string]$Path) {
    if ([IO.Path]::IsPathRooted($Path)) { return [IO.Path]::GetFullPath($Path) }
    return [IO.Path]::GetFullPath((Join-Path $script:AppRoot $Path))
}
function Get-Sha256([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Receive-HttpsFile([string]$Uri, [string]$Destination) {
    if (!(($Uri -as [Uri]).Scheme -eq 'https')) { throw '下载地址必须使用 HTTPS。' }
    # Windows PowerShell 5.1 默认不总是启用 TLS 1.2；保留证书校验。
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $part = $Destination + '.part'
    try {
        $request = @{ Uri=$Uri; OutFile=$part; UseBasicParsing=$true; TimeoutSec=600 }
        # Windows PowerShell 5.1 不自动读取 HTTPS_PROXY；显式继承而不改系统代理。
        $proxy = $env:HTTPS_PROXY
        if (!$proxy) { $proxy = $env:HTTP_PROXY }
        $bypass = $false
        $downloadHost = ([Uri]$Uri).DnsSafeHost
        if ($env:NO_PROXY) {
            foreach ($entry in ($env:NO_PROXY -split ',')) {
                $domain = $entry.Trim().TrimStart('.')
                if ($domain -eq '*' -or $downloadHost -eq $domain -or ($domain -and $downloadHost.EndsWith('.' + $domain, [StringComparison]::OrdinalIgnoreCase))) { $bypass = $true }
            }
        }
        if ($proxy -and !$bypass) { $request.Proxy = $proxy }
        Invoke-WebRequest @request
        Move-Item -LiteralPath $part -Destination $Destination -Force
    } finally { if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force } }
}
function Assert-Hash([string]$Path, [string]$Expected) {
    if ($Expected -notmatch '^[a-fA-F0-9]{64}$' -or (Get-Sha256 $Path) -ne $Expected.ToLowerInvariant()) {
        throw "SHA-256 校验失败：$Path。已停止，未执行下载的程序。"
    }
}
function Get-OwnedServer($Settings) {
    $pidFile = Join-Path $Settings.dataDirectory 'server.pid.json'
    if (!(Test-Path -LiteralPath $pidFile)) { return $null }
    $record = Get-Content -LiteralPath $pidFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $running = Get-Process -Id ([int]$record.processId) -ErrorAction SilentlyContinue
    if ($null -eq $running) { Remove-Item -LiteralPath $pidFile -Force; return $null }
    $expectedMain = Join-Path $script:AppRoot 'server\src\main.mjs'
    $actual = Get-CimInstance Win32_Process -Filter "ProcessId = $($record.processId)"
    if ($record.nodePath -ne $Settings.nodePath -or $record.mainPath -ne $expectedMain -or
        $running.Path -ne $Settings.nodePath -or
        $running.StartTime.ToUniversalTime().Ticks.ToString() -ne [string]$record.startTimeUtcTicks -or
        !$actual.CommandLine -or !$actual.CommandLine.Contains($expectedMain)) {
        throw 'PID 记录与进程路径、命令行或启动时间不符。为避免关闭其他程序，已拒绝操作。'
    }
    return $running
}
