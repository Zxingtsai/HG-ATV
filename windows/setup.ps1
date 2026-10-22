[CmdletBinding()]
param(
    [string]$RuntimeDirectory = 'runtime',
    [string]$DataDirectory = 'data',
    [ValidateRange(1024,65535)][int]$Port = 8751,
    [ValidateSet('auto','libx264','h264_qsv')][string]$Encoder = 'auto',
    [ValidateSet('720p','1080p')][string]$Profile = '720p'
)
. (Join-Path $PSScriptRoot 'common.ps1')
if ($env:OS -ne 'Windows_NT' -or ![Environment]::Is64BitOperatingSystem) { throw '需要 Windows x64。' }
if (Test-Path -LiteralPath $script:SettingsFile) {
    $existing = Read-Settings
    if ($null -ne (Get-OwnedServer $existing)) { throw '请先运行 stop.ps1 停止当前服务，再重新安装或更改配置。' }
}
$runtime = Resolve-AppPath $RuntimeDirectory
$data = Resolve-AppPath $DataDirectory
New-Item -ItemType Directory -Path $runtime,$data -Force | Out-Null
$lockPath = Join-Path $runtime 'setup.lock'
try { $lock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None') }
catch { throw '同一运行库目录已有安装进行中；请稍后再试。' }
$stage = Join-Path $runtime ('setup-' + [Guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    $nodeVersion = '24.19.0'
    $nodeName = "node-v$nodeVersion-win-x64"
    $nodeRoot = Join-Path $runtime $nodeName
    $node = Join-Path $nodeRoot 'node.exe'
    $ffRoot = Join-Path $runtime 'ffmpeg'
    $ffmpeg = Join-Path $ffRoot 'bin\ffmpeg.exe'
    $ffprobe = Join-Path $ffRoot 'bin\ffprobe.exe'
    $manifestPath = Join-Path $runtime 'downloads.manifest.json'
    $old = $null
    if (Test-Path -LiteralPath $manifestPath) { $old = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json }
    $nodeInfo = $null
    if ($null -ne $old -and (Test-Path -LiteralPath $node) -and $old.node.version -eq $nodeVersion) {
        if ((Get-Sha256 $node) -eq $old.node.executableSha256) { $nodeInfo = $old.node }
    }
    if ($null -eq $nodeInfo) {
        Write-Host "下载并校验 Node.js $nodeVersion（官方 Windows x64 ZIP）…"
        $nodeBase = "https://nodejs.org/dist/v$nodeVersion/"
        $sums = Join-Path $stage 'SHASUMS256.txt'
        Receive-HttpsFile ($nodeBase + 'SHASUMS256.txt') $sums
        $zipName = $nodeName + '.zip'
        $sumLine = @(Get-Content -LiteralPath $sums | Where-Object { $_ -match ('^[a-fA-F0-9]{64}\s+' + [regex]::Escape($zipName) + '$') })
        if ($sumLine.Count -ne 1) { throw '官方 SHASUMS256 未给出唯一 Node ZIP 校验值。' }
        $expected = ($sumLine[0] -split '\s+')[0].ToLowerInvariant()
        $zip = Join-Path $stage $zipName
        Receive-HttpsFile ($nodeBase + $zipName) $zip
        Assert-Hash $zip $expected
        Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $stage 'node') -Force
        $unpacked = Join-Path (Join-Path $stage 'node') $nodeName
        if (!(Test-Path -LiteralPath (Join-Path $unpacked 'node.exe'))) { throw 'Node ZIP 结构不符合预期。' }
        if (Test-Path -LiteralPath $nodeRoot) {
            if ($null -eq $old -or $old.node.version -ne $nodeVersion) { throw 'Node 目标目录已存在且无本项目安装记录；请选择新的空运行库目录。' }
            Remove-Item -LiteralPath $nodeRoot -Recurse -Force
        }
        Move-Item -LiteralPath $unpacked -Destination $nodeRoot
        $nodeInfo = [ordered]@{version=$nodeVersion;url=($nodeBase+$zipName);sha256Url=($nodeBase+'SHASUMS256.txt');archiveSha256=$expected;executableSha256=(Get-Sha256 $node);license='MIT and bundled dependency licenses; see node-v24.19.0-win-x64/LICENSE'}
    }
    $ffInfo = $null
    if ($null -ne $old -and (Test-Path -LiteralPath $ffmpeg) -and (Test-Path -LiteralPath $ffprobe)) {
        if ((Get-Sha256 $ffmpeg) -eq $old.ffmpeg.executableSha256 -and (Get-Sha256 $ffprobe) -eq $old.ffmpeg.ffprobeSha256) { $ffInfo = $old.ffmpeg }
    }
    if ($null -eq $ffInfo) {
        Write-Host '下载并校验 FFmpeg（Gyan release essentials，GPLv3）…'
        $ffUrl = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
        $sumFile = Join-Path $stage 'ffmpeg.sha256'
        $versionFile = Join-Path $stage 'ffmpeg.ver'
        Receive-HttpsFile ($ffUrl + '.sha256') $sumFile
        Receive-HttpsFile ($ffUrl + '.ver') $versionFile
        $expected = (Get-Content -LiteralPath $sumFile -Raw).Trim()
        if ($expected -notmatch '^[a-fA-F0-9]{64}$') { throw 'Gyan 官方 SHA-256 文件格式异常。' }
        $ffVersion = (Get-Content -LiteralPath $versionFile -Raw).Trim()
        if ($ffVersion -notmatch '^\d+\.\d+(\.\d+)?([-.][a-zA-Z0-9]+)*$') { throw 'Gyan 版本文件格式异常。' }
        $zip = Join-Path $stage 'ffmpeg.zip'
        Receive-HttpsFile $ffUrl $zip
        Assert-Hash $zip $expected
        Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $stage 'ffmpeg') -Force
        $roots = @(Get-ChildItem -LiteralPath (Join-Path $stage 'ffmpeg') -Directory)
        if ($roots.Count -ne 1 -or !(Test-Path -LiteralPath (Join-Path $roots[0].FullName 'bin\ffmpeg.exe')) -or !(Test-Path -LiteralPath (Join-Path $roots[0].FullName 'bin\ffprobe.exe'))) { throw 'FFmpeg ZIP 结构不符合预期。' }
        if (Test-Path -LiteralPath $ffRoot) {
            if ($null -eq $old) { throw 'FFmpeg 目标目录已存在且无本项目安装记录；请选择新的空运行库目录。' }
            Remove-Item -LiteralPath $ffRoot -Recurse -Force
        }
        Move-Item -LiteralPath $roots[0].FullName -Destination $ffRoot
        $versionOutput = & $ffmpeg -version
        if ($LASTEXITCODE -ne 0 -or $versionOutput[0] -notmatch ('^ffmpeg version ' + [regex]::Escape($ffVersion) + '(?:[-\s]|$)')) { throw 'FFmpeg 实际版本与官方 .ver 不一致；请稍后重新安装。' }
        $ffInfo = [ordered]@{version=$ffVersion;url=$ffUrl;sha256Url=($ffUrl+'.sha256');versionUrl=($ffUrl+'.ver');archiveSha256=$expected.ToLowerInvariant();executableSha256=(Get-Sha256 $ffmpeg);ffprobeSha256=(Get-Sha256 $ffprobe);license='GPLv3; see ffmpeg/LICENSE and README.txt';publisher='Gyan Windows builds; https://www.gyan.dev/ffmpeg/builds/'}
    }
    Write-JsonFile ([ordered]@{downloadedAtUtc=[DateTime]::UtcNow.ToString('o');node=$nodeInfo;ffmpeg=$ffInfo}) $manifestPath
    Write-JsonFile ([ordered]@{runtimeDirectory=$runtime;dataDirectory=$data;nodePath=$node;ffmpegPath=$ffmpeg;port=$Port;encoder=$Encoder;profile=$Profile;bind='0.0.0.0'}) $script:SettingsFile
    $env:HONGGUO_DATA_DIR = $data
    $env:HONGGUO_FFMPEG = $ffmpeg
    $prepare = Join-Path $script:AppRoot 'server\scripts\prepare-player.mjs'
    if (!(Test-Path -LiteralPath $prepare)) { throw '安装包缺少 server/scripts/prepare-player.mjs。' }
    Write-Host '准备官网公开播放器组件并核验固定 SHA-256…'
    & $node --use-env-proxy $prepare
    if ($LASTEXITCODE -ne 0) { throw '播放器组件准备失败；请检查网络后重新运行 setup.ps1。' }
    Write-Host "安装完成。运行 windows\start.ps1。配置：$script:SettingsFile"
} finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    if ($null -ne $lock) { $lock.Dispose() }
}
