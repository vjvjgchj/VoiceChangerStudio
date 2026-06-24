$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
$python = Join-Path $projectRoot ".mamba-root\envs\vcb-py310\python.exe"
$serverDir = Join-Path $projectRoot "server"

function Add-CudaDllSearchPath {
    $envDir = Join-Path $projectRoot ".mamba-root\envs\vcb-py310"
    $paths = @(
        (Join-Path $envDir "Lib\site-packages\torch\lib"),
        (Join-Path $envDir "Library\bin"),
        (Join-Path $envDir "DLLs")
    )
    $pathsForPrepend = @($paths)
    [array]::Reverse($pathsForPrepend)
    foreach ($path in $pathsForPrepend) {
        if ((Test-Path -LiteralPath $path) -and ($env:PATH -notlike "*$path*")) {
            $env:PATH = "$path;$env:PATH"
        }
    }
    $env:PYTHONNOUSERSITE = "1"
}

if (-not (Test-Path -LiteralPath $python)) {
    throw "Python environment not found: $python. Run install-env.bat first."
}

Add-CudaDllSearchPath

$existing = Get-NetTCPConnection -LocalPort 6006 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
    Write-Output "Voice Changer is already listening on http://localhost:6006/"
    exit 0
}

Set-Location -LiteralPath $serverDir
& $python "MMVCServerSIO.py" -p 6006 --host 127.0.0.1 --logLevel info
