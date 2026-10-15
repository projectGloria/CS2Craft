$workspacePath = Split-Path -Parent $PSScriptRoot
$installedPath = Join-Path $env:LOCALAPPDATA 'CS2 Craft\cs2-craft.exe'
$builtPath = Join-Path $workspacePath 'src-tauri\target\release\cs2-craft.exe'
if (Test-Path -LiteralPath $installedPath) {
    Start-Process -FilePath $installedPath
} elseif (Test-Path -LiteralPath $builtPath) {
    Start-Process -FilePath $builtPath -WorkingDirectory (Split-Path -Parent $builtPath)
} else {
    Write-Error 'Install CS2 Craft from the release folder first.'
}
