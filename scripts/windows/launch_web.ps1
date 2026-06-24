$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
$python = Join-Path $projectRoot ".mamba-root\envs\vcb-py310\python.exe"
$serverDir = Join-Path $projectRoot "server"
$url = "http://127.0.0.1:6006/local/"
$helloUrl = "http://127.0.0.1:6006/api/hello"
$logsDir = Join-Path $projectRoot "logs"
$stdoutLog = Join-Path $logsDir "server.log"
$stderrLog = Join-Path $logsDir "server.err.log"

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

function Test-VoiceChangerReady {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $helloUrl -TimeoutSec 1
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Get-VoiceChangerListener {
    Get-NetTCPConnection -LocalPort 6006 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
}

if (Test-VoiceChangerReady) {
    Start-Process $url
    exit 0
}

if (-not (Test-Path -LiteralPath $python)) {
    throw "Python environment not found: $python. Run install-env.bat first."
}

Add-CudaDllSearchPath
if (-not (Test-Path -LiteralPath $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}

$listener = Get-VoiceChangerListener
if (-not $listener) {
    Remove-Item -LiteralPath $stdoutLog, $stderrLog -Force -ErrorAction SilentlyContinue
    Start-Process `
        -FilePath $python `
        -ArgumentList @("MMVCServerSIO.py", "-p", "6006", "--host", "127.0.0.1", "--logLevel", "info", "--noNativeClient", "--deferModelLoad") `
        -WorkingDirectory $serverDir `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog `
        -WindowStyle Hidden | Out-Null
}

$deadline = (Get-Date).AddMinutes(30)
while ((Get-Date) -lt $deadline) {
    if (Test-VoiceChangerReady) {
        Start-Process $url
        exit 0
    }
    Start-Sleep -Milliseconds 500
}

throw "Voice Changer did not become ready within 30 minutes. Check logs\server.err.log for details."
