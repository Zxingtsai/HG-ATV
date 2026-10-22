[CmdletBinding()]
param()
. (Join-Path $PSScriptRoot 'common.ps1')
$settings = Read-Settings
$server = Get-OwnedServer $settings
if ($null -eq $server) { Write-Host '本项目服务当前未运行。'; return }
# 仅记录已核验父进程下、创建时间不早于父进程、可执行路径匹配的直接 FFmpeg 子进程。
# 不使用 taskkill /IM、通配进程名或全局 ffmpeg/node 终止。
$children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($server.Id)" | Where-Object {
    $_.ExecutablePath -eq $settings.ffmpegPath -and $_.CreationDate.ToUniversalTime() -ge $server.StartTime.ToUniversalTime()
} | ForEach-Object { [PSCustomObject]@{processId=$_.ProcessId;created=$_.CreationDate;path=$_.ExecutablePath} })
# 再核验一次父进程，防止读取后 PID 被系统复用。
$verified = Get-OwnedServer $settings
if ($null -eq $verified) { Write-Host '服务已退出。'; return }
Stop-Process -InputObject $verified -Force
foreach ($entry in $children) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($entry.processId)" -ErrorAction SilentlyContinue
    if ($null -ne $process -and $process.ExecutablePath -eq $entry.path -and $process.CreationDate -eq $entry.created) {
        Stop-Process -Id ([int]$entry.processId) -Force -ErrorAction SilentlyContinue
    }
}
$pidFile = Join-Path $settings.dataDirectory 'server.pid.json'
if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force }
Write-Host '已停止本项目服务及其已核验的 FFmpeg 子进程。'
