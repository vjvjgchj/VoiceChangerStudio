$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $projectRoot ".mamba-root\envs\vcb-py310\python.exe"
$serverDir = Join-Path $projectRoot "server"

if (-not (Test-Path -LiteralPath $python)) {
    throw "Python environment not found: $python"
}

$existing = Get-NetTCPConnection -LocalPort 6006 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
    Write-Output "Voice Changer is already listening on http://localhost:6006/"
    exit 0
}

Set-Location -LiteralPath $serverDir
& $python "MMVCServerSIO.py" -p 6006 --host 127.0.0.1 --logLevel info
