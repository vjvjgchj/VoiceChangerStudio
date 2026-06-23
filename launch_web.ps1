$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $projectRoot ".mamba-root\envs\vcb-py310\python.exe"
$serverDir = Join-Path $projectRoot "server"
$url = "http://127.0.0.1:6006/local/"
$helloUrl = "http://127.0.0.1:6006/api/hello"
$stdoutLog = Join-Path $projectRoot "server.log"
$stderrLog = Join-Path $projectRoot "server.err.log"

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
    throw "Python environment not found: $python"
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

throw "Voice Changer did not become ready within 30 minutes. Check server.err.log for details."
