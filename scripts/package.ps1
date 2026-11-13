$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $repoRoot 'dist/manifest.json') -Raw | ConvertFrom-Json
$package = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne $package.version -or $manifest.id -ne 'project-gantt') {
    throw 'Built manifest does not match the plugin package'
}
$files = @('main.js', 'styles.css', 'manifest.json') | ForEach-Object { Join-Path $repoRoot "dist/$_" }
$archiveDirectory = Join-Path $repoRoot 'packages'
New-Item -ItemType Directory -Force -Path $archiveDirectory | Out-Null
$archive = Join-Path $archiveDirectory "project-gantt-$($manifest.version).zip"
Compress-Archive -LiteralPath $files -DestinationPath $archive -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
    $names = @($zip.Entries | ForEach-Object { $_.FullName } | Sort-Object)
    if (($names -join ',') -ne 'main.js,manifest.json,styles.css') { throw 'Unexpected plugin archive contents' }
} finally { $zip.Dispose() }
Write-Host "Plugin package: $archive"
