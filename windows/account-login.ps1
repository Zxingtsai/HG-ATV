[CmdletBinding()]
param()
. (Join-Path $PSScriptRoot 'common.ps1')
$settings = Read-Settings
if ($null -eq (Get-OwnedServer $settings)) { throw '请先运行 windows\start.cmd，保持服务运行。' }
$base = 'http://127.0.0.1:' + [string]$settings.port
try { $health = Invoke-RestMethod -Uri ($base + '/health') -Method Get -TimeoutSec 5 }
catch { throw '服务尚未就绪，请查看 start 窗口后重试。' }
if ($health.version -eq '0.1.0') { throw '当前仍是旧服务端。请先停止服务，安装账号预览更新，再重新启动。' }
Write-Host '正在打开本机账号页面；请用红果 App 扫码并在手机上确认。'
Start-Process -FilePath ($base + '/account')
