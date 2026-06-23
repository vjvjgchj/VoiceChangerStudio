param(
    [switch]$AutoStart
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $projectRoot ".mamba-root\envs\vcb-py310\python.exe"
$serverDir = Join-Path $projectRoot "server"
$url = "http://127.0.0.1:6006/local/"
$helloUrl = "http://127.0.0.1:6006/api/hello"
$serverLog = Join-Path $projectRoot "server.log"
$errorLog = Join-Path $projectRoot "server.err.log"
$modelDir = Join-Path $serverDir "model_dir"
$historyDir = Join-Path $serverDir "local_recordings"

function Test-VoiceChangerReady {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $helloUrl -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Get-VoiceChangerProcess {
    $listener = Get-NetTCPConnection -LocalPort 6006 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) {
        return $null
    }
    return Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
}

function Start-VoiceChanger {
    if (-not (Test-Path -LiteralPath $python)) {
        $installBat = Join-Path $projectRoot "install-env.bat"
        [System.Windows.Forms.MessageBox]::Show("Python CUDA environment was not found:`n$python`n`nRun install-env.bat first:`n$installBat", "Voice Changer", "OK", "Error") | Out-Null
        return
    }
    $script = Join-Path $projectRoot "launch_web.ps1"
    $launchArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
    Start-Process `
        -FilePath "powershell.exe" `
        -ArgumentList $launchArgs `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden | Out-Null
    $statusLabel.Text = "Starting server and opening console..."
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(47, 107, 79)
}

function Stop-VoiceChanger {
    $script = Join-Path $projectRoot "stop_windows.ps1"
    try {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script | Out-Null
        $statusLabel.Text = "Server stopped. Python memory has been released."
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(92, 101, 110)
    } catch {
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "Stop failed", "OK", "Error") | Out-Null
    }
}

function Open-PathIfExists([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
    Start-Process $path
}

function Update-Status {
    $process = Get-VoiceChangerProcess
    if (Test-VoiceChangerReady) {
        $memory = if ($process) { [math]::Round($process.WorkingSet64 / 1MB, 0) } else { 0 }
        $pidText = if ($process) { "PID $($process.Id)" } else { "Running" }
        $statusLabel.Text = "Server running - $pidText - ${memory}MB"
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(31, 91, 63)
        $startButton.Text = "Open Console"
        return
    }
    if ($process) {
        $statusLabel.Text = "Port 6006 is busy. Server may still be starting."
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(145, 96, 38)
        $startButton.Text = "Open Console"
        return
    }
    $statusLabel.Text = "Server is not running"
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(92, 101, 110)
    $startButton.Text = "Start and Open"
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "Voice Changer Local Launcher"
$form.StartPosition = "CenterScreen"
$form.ClientSize = New-Object System.Drawing.Size(520, 330)
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(245, 247, 248)
$form.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)

$title = New-Object System.Windows.Forms.Label
$title.Text = "Local Voice Changer"
$title.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 18, [System.Drawing.FontStyle]::Bold)
$title.Location = New-Object System.Drawing.Point(24, 22)
$title.Size = New-Object System.Drawing.Size(360, 36)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "Start, open, stop, and manage local files"
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(92, 101, 110)
$subtitle.Location = New-Object System.Drawing.Point(27, 62)
$subtitle.Size = New-Object System.Drawing.Size(360, 24)
$form.Controls.Add($subtitle)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = "Reading status..."
$statusLabel.Location = New-Object System.Drawing.Point(27, 98)
$statusLabel.Size = New-Object System.Drawing.Size(460, 24)
$form.Controls.Add($statusLabel)

$startButton = New-Object System.Windows.Forms.Button
$startButton.Location = New-Object System.Drawing.Point(28, 142)
$startButton.Size = New-Object System.Drawing.Size(220, 44)
$startButton.Text = "Start and Open"
$startButton.Add_Click({
    if (Test-VoiceChangerReady) {
        Start-Process $url
    } else {
        Start-VoiceChanger
    }
})
$form.Controls.Add($startButton)

$stopButton = New-Object System.Windows.Forms.Button
$stopButton.Location = New-Object System.Drawing.Point(270, 142)
$stopButton.Size = New-Object System.Drawing.Size(220, 44)
$stopButton.Text = "Stop Server"
$stopButton.Add_Click({ Stop-VoiceChanger; Update-Status })
$form.Controls.Add($stopButton)

$modelButton = New-Object System.Windows.Forms.Button
$modelButton.Location = New-Object System.Drawing.Point(28, 204)
$modelButton.Size = New-Object System.Drawing.Size(140, 38)
$modelButton.Text = "Models"
$modelButton.Add_Click({ Open-PathIfExists $modelDir })
$form.Controls.Add($modelButton)

$historyButton = New-Object System.Windows.Forms.Button
$historyButton.Location = New-Object System.Drawing.Point(188, 204)
$historyButton.Size = New-Object System.Drawing.Size(140, 38)
$historyButton.Text = "History"
$historyButton.Add_Click({ Open-PathIfExists $historyDir })
$form.Controls.Add($historyButton)

$logButton = New-Object System.Windows.Forms.Button
$logButton.Location = New-Object System.Drawing.Point(348, 204)
$logButton.Size = New-Object System.Drawing.Size(140, 38)
$logButton.Text = "Open Logs"
$logButton.Add_Click({
    if (Test-Path -LiteralPath $errorLog) {
        Start-Process notepad.exe $errorLog
    } elseif (Test-Path -LiteralPath $serverLog) {
        Start-Process notepad.exe $serverLog
    } else {
        [System.Windows.Forms.MessageBox]::Show("No log file exists yet.", "Voice Changer", "OK", "Information") | Out-Null
    }
})
$form.Controls.Add($logButton)

$hint = New-Object System.Windows.Forms.Label
$hint.Text = "Stopping the server releases Python memory. Start again when needed."
$hint.ForeColor = [System.Drawing.Color]::FromArgb(92, 101, 110)
$hint.Location = New-Object System.Drawing.Point(27, 268)
$hint.Size = New-Object System.Drawing.Size(460, 24)
$form.Controls.Add($hint)

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000
$timer.Add_Tick({ Update-Status })

$form.Add_Shown({
    Update-Status
    $timer.Start()
    if ($AutoStart) {
        Start-VoiceChanger
    }
})

$form.Add_FormClosed({ $timer.Stop() })

[void]$form.ShowDialog()
