#Requires -RunAsAdministrator
[CmdletBinding()]
param([switch]$Remove)
. (Join-Path $PSScriptRoot 'common.ps1')
$settings = Read-Settings
$sha = [Security.Cryptography.SHA256]::Create()
try { $suffix = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($script:AppRoot)))).Replace('-','').Substring(0,12) }
finally { $sha.Dispose() }
$names = @("HongguoTV-$suffix-TCP", "HongguoTV-$suffix-UDP")
foreach ($name in $names) { Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule }
if ($Remove) { Write-Host '已移除此目录创建的两条防火墙规则。'; return }
New-NetFirewallRule -Name $names[0] -DisplayName '红果 TV：家庭局域网播放' -Direction Inbound -Action Allow -Profile Private -Protocol TCP -LocalPort $settings.port -RemoteAddress LocalSubnet -Program $settings.nodePath | Out-Null
New-NetFirewallRule -Name $names[1] -DisplayName '红果 TV：家庭局域网发现' -Direction Inbound -Action Allow -Profile Private -Protocol UDP -LocalPort 8752 -RemoteAddress LocalSubnet -Program $settings.nodePath | Out-Null
Write-Host '仅已放行 Private 网络的 LocalSubnet：TCP 服务端口、UDP 8752。'
