[CmdletBinding()]
param([switch]$Remove)
. (Join-Path $PSScriptRoot 'common.ps1')
$settings = Read-Settings
$sha = [Security.Cryptography.SHA256]::Create()
try { $suffix = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($script:AppRoot)))).Replace('-','').Substring(0,12) }
finally { $sha.Dispose() }
$taskName = "HongguoTV-$suffix"
if ($Remove) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host '已移除此目录的登录启动任务。当前服务请另行运行 stop.ps1 停止。'
    return
}
$scriptPath = Join-Path $PSScriptRoot 'start.ps1'
$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $psExe -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scriptPath + '" -Headless') -WorkingDirectory $script:AppRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$options = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $options -Description '红果 TV 家庭局域网服务（当前用户登录后运行，无管理员权限）' -Force | Out-Null
Write-Host "已添加当前用户登录任务：$taskName。下次登录生效。"
Write-Host "配对码位于 $($settings.dataDirectory)\server-*.log；同一时间只能运行一个启动窗口/任务。"
