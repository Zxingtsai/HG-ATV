[CmdletBinding()]
param(
    [string]$ApkPath = 'client/dist/hongguo-tv.apk',
    [string]$OutputDirectory = 'dist',
    [string]$Version = '0.1.0'
)
. (Join-Path $PSScriptRoot 'common.ps1')
if ($Version -notmatch '^[0-9A-Za-z][0-9A-Za-z._-]*$') { throw '版本号只能包含字母、数字、点、下划线和短横线。' }
$apk = Resolve-AppPath $ApkPath
if (!(Test-Path -LiteralPath $apk -PathType Leaf)) { throw "请先构建真实 Android TV APK，并通过 -ApkPath 指定：$apk" }
$output = Resolve-AppPath $OutputDirectory
New-Item -ItemType Directory -Path $output -Force | Out-Null
$stage = Join-Path ([IO.Path]::GetTempPath()) ('hongguo-package-' + [Guid]::NewGuid().ToString('N'))
$bundleName = "hongguo-tv-$Version"
$bundle = Join-Path $stage $bundleName
try {
    New-Item -ItemType Directory -Path $bundle -Force | Out-Null
    $server = Join-Path $bundle 'server'
    New-Item -ItemType Directory -Path $server -Force | Out-Null
    foreach ($entry in @('package.json','package-lock.json','src','scripts','public','assets')) {
        $source = Join-Path (Join-Path $script:AppRoot 'server') $entry
        if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $server -Recurse -Force }
    }
    if (!(Test-Path -LiteralPath (Join-Path $server 'src\main.mjs')) -or !(Test-Path -LiteralPath (Join-Path $server 'scripts\prepare-player.mjs'))) { throw '后端源码尚未完整。' }
    $win = Join-Path $bundle 'windows'
    New-Item -ItemType Directory -Path $win -Force | Out-Null
    Get-ChildItem -LiteralPath $PSScriptRoot -File | Where-Object { $_.Extension -in '.ps1','.cmd','.md' } | Copy-Item -Destination $win -Force
    $docs = Join-Path $script:AppRoot 'docs'
    if (Test-Path -LiteralPath $docs) { Copy-Item -LiteralPath $docs -Destination $bundle -Recurse -Force }
    foreach ($entry in @('README.md','README.zh-CN.md','LICENSE','NOTICE')) {
        $source = Join-Path $script:AppRoot $entry
        if (Test-Path -LiteralPath $source -PathType Leaf) { Copy-Item -LiteralPath $source -Destination $bundle -Force }
    }
    $clientDist = Join-Path $bundle 'client\dist'
    New-Item -ItemType Directory -Path $clientDist -Force | Out-Null
    Copy-Item -LiteralPath $apk -Destination (Join-Path $clientDist 'hongguo-tv.apk')
    $hashes = @(Get-ChildItem -LiteralPath $bundle -File -Recurse | Sort-Object FullName | ForEach-Object {
        [ordered]@{path=$_.FullName.Substring($bundle.Length+1).Replace('\','/');sha256=(Get-Sha256 $_.FullName)}
    })
    Write-JsonFile ([ordered]@{version=$Version;createdAtUtc=[DateTime]::UtcNow.ToString('o');files=$hashes}) (Join-Path $bundle 'SHA256.json')
    $zip = Join-Path $output ($bundleName + '.zip')
    if (Test-Path -LiteralPath $zip) { throw "输出已存在，请另选版本或输出目录：$zip" }
    Compress-Archive -LiteralPath $bundle -DestinationPath $zip -CompressionLevel Optimal
    [IO.File]::WriteAllText(($zip+'.sha256'), ((Get-Sha256 $zip) + '  ' + [IO.Path]::GetFileName($zip) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
    Write-Host "已生成：$zip"
} finally { if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force } }
