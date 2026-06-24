$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
$envRoot = Join-Path $projectRoot ".mamba-root"

$processes = Get-Process python -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and $_.Path.StartsWith($envRoot, [System.StringComparison]::OrdinalIgnoreCase)
}

if (-not $processes) {
    Write-Output "No Voice Changer Python processes found."
    exit 0
}

foreach ($process in $processes) {
    Stop-Process -Id $process.Id -Force
    Write-Output "Stopped Voice Changer process $($process.Id)"
}
