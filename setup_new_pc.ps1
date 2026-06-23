param(
    [switch]$Start,
    [switch]$SkipImportCheck
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir = Join-Path $projectRoot "server"
$python = Join-Path $projectRoot ".mamba-root\envs\vcb-py310\python.exe"
$node = Join-Path $projectRoot ".tools\node-v20.20.2-win-x64\node.exe"
$launchScript = Join-Path $projectRoot "launch_web.ps1"
$installScript = Join-Path $projectRoot "install_environment.ps1"
$installBat = Join-Path $projectRoot "install-env.bat"

$checks = New-Object System.Collections.Generic.List[object]

function Add-Check([string]$Name, [string]$Status, [string]$Detail, [string]$Fix = "") {
    $checks.Add([pscustomobject]@{
        Name = $Name
        Status = $Status
        Detail = $Detail
        Fix = $Fix
    }) | Out-Null
}

function Ensure-Directory([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

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

function ConvertTo-CommandLineArgument([string]$Argument) {
    if ($null -eq $Argument) {
        return '""'
    }
    if ($Argument.Length -eq 0) {
        return '""'
    }
    if ($Argument -notmatch '[\s"]') {
        return $Argument
    }

    $result = '"'
    $slashes = 0
    foreach ($char in $Argument.ToCharArray()) {
        if ($char -eq '\') {
            $slashes += 1
        } elseif ($char -eq '"') {
            if ($slashes -gt 0) {
                $result += ('\' * ($slashes * 2))
                $slashes = 0
            }
            $result += '\"'
        } else {
            if ($slashes -gt 0) {
                $result += ('\' * $slashes)
                $slashes = 0
            }
            $result += $char
        }
    }

    if ($slashes -gt 0) {
        $result += ('\' * ($slashes * 2))
    }
    $result += '"'
    return $result
}

function Invoke-ProcessCapture {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory = $projectRoot,
        [int]$TimeoutSeconds = 60
    )

    try {
        $argumentText = ($Arguments | ForEach-Object { ConvertTo-CommandLineArgument ([string]$_) }) -join " "

        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = $FilePath
        $startInfo.Arguments = $argumentText
        $startInfo.WorkingDirectory = $WorkingDirectory
        $startInfo.UseShellExecute = $false
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        $startInfo.CreateNoWindow = $true

        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $startInfo
        [void]$process.Start()

        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            try {
                $process.Kill()
            } catch {
            }
            return [pscustomobject]@{
                ExitCode = 124
                Output = "Timed out after $TimeoutSeconds seconds."
            }
        }

        $stdoutText = [string]$process.StandardOutput.ReadToEnd()
        $stderrText = [string]$process.StandardError.ReadToEnd()
        $outputText = [string]::Concat($stdoutText, $stderrText).Trim()
        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Output = $outputText
        }
    } finally {
        if ($process) {
            $process.Dispose()
        }
    }
}

function Invoke-PythonSnippet {
    param(
        [string]$Code,
        [int]$TimeoutSeconds = 60
    )

    $tempBase = [System.IO.Path]::GetTempFileName()
    $tempScript = [System.IO.Path]::ChangeExtension($tempBase, ".py")
    try {
        Set-Content -LiteralPath $tempScript -Value $Code -Encoding UTF8
        return Invoke-ProcessCapture -FilePath $python -Arguments @($tempScript) -TimeoutSeconds $TimeoutSeconds
    } finally {
        Remove-Item -LiteralPath $tempBase, $tempScript -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Host "VoiceChangerStudio new computer check"
Write-Host "Project: $projectRoot"
Write-Host ""

$requiredFiles = @(
    "launch_web.ps1",
    "local_launcher.ps1",
    "server\MMVCServerSIO.py",
    "server\local_console\index.html",
    "server\local_console\app.js",
    "server\local_console\realtime-worklet.js"
)

$missingFiles = @()
foreach ($file in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $file))) {
        $missingFiles += $file
    }
}

if ($missingFiles.Count -eq 0) {
    Add-Check "Project files" "OK" "Required launcher, server, and local UI files are present."
} else {
    Add-Check "Project files" "FAIL" ("Missing: " + ($missingFiles -join ", ")) "Copy the full VoiceChangerStudio folder again."
}

$runtimeDirs = @(
    "server\model_dir",
    "server\pretrain",
    "server\tmp_dir",
    "server\upload_dir",
    "server\local_recordings",
    "server\logs",
    "logs",
    "tmp_dir",
    "upload_dir"
)

foreach ($dir in $runtimeDirs) {
    Ensure-Directory (Join-Path $projectRoot $dir)
}
Add-Check "Runtime folders" "OK" "Model, pretrain, upload, temp, log, and recording folders are present."

if (Test-Path -LiteralPath $python) {
    Add-Check "Python environment" "OK" $python

    Add-CudaDllSearchPath

    $versionResult = Invoke-PythonSnippet -Code "import sys`nprint(sys.version)" -TimeoutSeconds 15
    if ($versionResult.ExitCode -eq 0) {
        Add-Check "Python launch" "OK" ($versionResult.Output -replace "`r?`n", " ")
    } else {
        Add-Check "Python launch" "FAIL" $versionResult.Output "The copied Python environment is not usable on this computer."
    }

    if (-not $SkipImportCheck) {
        $importCode = @"
import importlib
mods = ["fastapi", "socketio", "numpy", "sounddevice", "onnxruntime", "torch", "torchaudio", "faiss", "librosa", "torchcrepe", "torchfcpe"]
failed = []
for mod in mods:
    try:
        importlib.import_module(mod)
    except Exception as exc:
        failed.append(f"{mod}: {exc}")
if failed:
    print("\n".join(failed))
    raise SystemExit(1)
print("critical imports ok")
"@
        $importResult = Invoke-PythonSnippet -Code $importCode -TimeoutSeconds 90
        if ($importResult.ExitCode -eq 0) {
            Add-Check "Python packages" "OK" $importResult.Output
        } else {
            Add-Check "Python packages" "FAIL" $importResult.Output "Run install-env.bat to rebuild the CUDA environment."
        }

        $cudaCode = @"
import torch
import onnxruntime as ort

print(f"torch={torch.__version__}, torch_cuda={torch.version.cuda}, cuda_available={torch.cuda.is_available()}")
if not torch.cuda.is_available():
    raise SystemExit("PyTorch cannot use CUDA.")
print(f"gpu={torch.cuda.get_device_name(0)}")
providers = ort.get_available_providers()
print("providers=" + ",".join(providers))
if "CUDAExecutionProvider" not in providers:
    raise SystemExit("ONNX Runtime CUDAExecutionProvider is missing.")
"@
        $cudaResult = Invoke-PythonSnippet -Code $cudaCode -TimeoutSeconds 60
        if ($cudaResult.ExitCode -eq 0) {
            Add-Check "CUDA runtime" "OK" ($cudaResult.Output -replace "`r?`n", " / ")
        } else {
            Add-Check "CUDA runtime" "FAIL" $cudaResult.Output "Install or update the NVIDIA driver, then run install-env.bat again."
        }

        $audioCode = @"
import sounddevice as sd
devices = sd.query_devices()
inputs = sum(1 for d in devices if d["max_input_channels"] > 0)
outputs = sum(1 for d in devices if d["max_output_channels"] > 0)
print(f"inputs={inputs}, outputs={outputs}")
"@
        $audioResult = Invoke-PythonSnippet -Code $audioCode -TimeoutSeconds 30
        if ($audioResult.ExitCode -eq 0) {
            Add-Check "Audio devices" "OK" $audioResult.Output
        } else {
            Add-Check "Audio devices" "WARN" $audioResult.Output "Check microphone permissions, audio drivers, and Windows input/output devices."
        }
    } else {
        Add-Check "Python packages" "WARN" "Import check skipped by -SkipImportCheck."
    }
} else {
    $fix = if (Test-Path -LiteralPath $installBat) { "Run install-env.bat to create the local CUDA Python environment." } elseif (Test-Path -LiteralPath $installScript) { "Run install_environment.ps1 to create the local CUDA Python environment." } else { "Copy a full portable package that includes .mamba-root, or restore install-env.bat." }
    Add-Check "Python environment" "FAIL" "Missing: $python" $fix
}

if (Test-Path -LiteralPath $node) {
    $nodeResult = Invoke-ProcessCapture -FilePath $node -Arguments @("--check", "server\local_console\app.js") -TimeoutSeconds 30
    if ($nodeResult.ExitCode -eq 0) {
        Add-Check "Local UI syntax" "OK" "app.js passed Node syntax check."
    } else {
        Add-Check "Local UI syntax" "FAIL" $nodeResult.Output "Restore server\local_console\app.js from a known-good copy."
    }
} else {
    Add-Check "Local UI syntax" "WARN" "Node was not found at $node. Runtime can still start, but syntax check is skipped."
}

if (Test-Path -LiteralPath $python) {
    $compileResult = Invoke-ProcessCapture `
        -FilePath $python `
        -Arguments @("-m", "py_compile", "server\MMVCServerSIO.py", "server\const.py", "server\restapi\MMVC_Rest.py", "server\sio\MMVC_SocketIOApp.py") `
        -TimeoutSeconds 60
    if ($compileResult.ExitCode -eq 0) {
        Add-Check "Backend syntax" "OK" "Key backend files compile."
    } else {
        Add-Check "Backend syntax" "FAIL" $compileResult.Output "Restore the changed backend files from a known-good copy."
    }
}

$pretrainDir = Join-Path $serverDir "pretrain"
$importantPretrains = @("hubert_base.pt", "content_vec_500.onnx", "rmvpe.onnx")
$missingPretrains = @()
foreach ($file in $importantPretrains) {
    if (-not (Test-Path -LiteralPath (Join-Path $pretrainDir $file))) {
        $missingPretrains += $file
    }
}
if ($missingPretrains.Count -eq 0) {
    Add-Check "Pretrain files" "OK" "Important pretrain files are present."
} else {
    Add-Check "Pretrain files" "WARN" ("Missing: " + ($missingPretrains -join ", ")) "Copy server\pretrain from the old computer or download the missing files."
}

$modelDir = Join-Path $serverDir "model_dir"
$modelFiles = @(Get-ChildItem -LiteralPath $modelDir -Recurse -File -Include *.pth, *.onnx, *.safetensors -ErrorAction SilentlyContinue)
if ($modelFiles.Count -gt 0) {
    Add-Check "Voice models" "OK" "$($modelFiles.Count) model file(s) found."
} else {
    Add-Check "Voice models" "WARN" "No .pth, .onnx, or .safetensors files found in server\model_dir." "Copy your models into server\model_dir or upload them in the local UI."
}

try {
    $listener = Get-NetTCPConnection -LocalPort 6006 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        $processPath = if ($process -and $process.Path) { $process.Path } else { "PID $($listener.OwningProcess)" }
        if ($processPath.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            Add-Check "Port 6006" "OK" "Already used by this project: $processPath"
        } else {
            Add-Check "Port 6006" "FAIL" "Port 6006 is occupied by $processPath" "Close that process or change the app port before starting."
        }
    } else {
        Add-Check "Port 6006" "OK" "Available."
    }
} catch {
    Add-Check "Port 6006" "WARN" $_.Exception.Message "If startup fails, check whether another app is using port 6006."
}

try {
    $driveName = ([System.IO.Path]::GetPathRoot($projectRoot)).Substring(0, 1)
    $drive = Get-PSDrive -Name $driveName -ErrorAction Stop
    $freeGb = [math]::Round($drive.Free / 1GB, 1)
    $minimumFreeGb = if (Test-Path -LiteralPath $python) { 5 } else { 15 }
    if ($freeGb -ge $minimumFreeGb) {
        Add-Check "Disk space" "OK" "$freeGb GB free on $driveName`:."
    } else {
        Add-Check "Disk space" "WARN" "$freeGb GB free on $driveName`:." "Keep at least $minimumFreeGb GB free. The CUDA environment install needs more space than daily use."
    }
} catch {
    Add-Check "Disk space" "WARN" $_.Exception.Message
}

Write-Host ""
$checks | Format-Table Status, Name, Detail -AutoSize

$failCount = @($checks | Where-Object { $_.Status -eq "FAIL" }).Count
$warnCount = @($checks | Where-Object { $_.Status -eq "WARN" }).Count

if ($failCount -gt 0) {
    Write-Host ""
    Write-Host "Fix required:" -ForegroundColor Red
    $checks | Where-Object { $_.Status -eq "FAIL" } | ForEach-Object {
        Write-Host "- $($_.Name): $($_.Fix)"
    }
    exit 1
}

Write-Host ""
if ($warnCount -gt 0) {
    Write-Host "Ready with warnings. The app can be started, but review the WARN lines above." -ForegroundColor Yellow
} else {
    Write-Host "Ready. This folder can run on this computer." -ForegroundColor Green
}

if ($Start) {
    Write-Host "Starting local console..."
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launchScript
}
