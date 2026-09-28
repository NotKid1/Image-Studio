$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    & '.\.build_env\Scripts\python.exe' -m PyInstaller --noconfirm --windowed --onedir --name 'ImageStudio' --distpath 'build\release' --icon 'web\assets\app_icon_transparent.ico' --add-data 'web;web' --add-data 'maskplus.raw;.' --collect-all webview desktop.py
    if ($LASTEXITCODE -ne 0) { throw 'Image Studio build failed' }
    $releaseTarget = Join-Path $PSScriptRoot 'dist\ImageStudio'
    New-Item -ItemType Directory -Path $releaseTarget -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'build\release\ImageStudio') | Copy-Item -Destination $releaseTarget -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination (Join-Path $releaseTarget '使用说明.md')
} finally { Pop-Location }
