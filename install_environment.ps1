param(
    [switch]$Force,
    [switch]$SkipVerification
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$envDir = Join-Path $projectRoot ".mamba-root\envs\vcb-py310"
$python = Join-Path $envDir "python.exe"
$toolsDir = Join-Path $projectRoot ".tools"
$cacheDir = Join-Path $toolsDir "cache"
$requirements = Join-Path $projectRoot "requirements-runtime-cuda118.txt"
$setupCheck = Join-Path $projectRoot "setup_new_pc.ps1"
$pythonVersion = "3.10.11"
$pythonInstaller = Join-Path $cacheDir "python-$pythonVersion-amd64.exe"
$pythonUrl = "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-amd64.exe"
$minimumFreeGb = 15

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Invoke-Checked {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory = $projectRoot
    )

    Write-Host "> $FilePath $($Arguments -join ' ')"
    Push-Location -LiteralPath $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed with exit code $LASTEXITCODE`: $FilePath"
        }
    } finally {
        Pop-Location
    }
}

function Ensure-Directory([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Add-CudaDllSearchPath {
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

function Download-FileIfNeeded {
    param(
        [string]$Url,
        [string]$Path,
        [int64]$MinimumBytes
    )

    if ((Test-Path -LiteralPath $Path) -and ((Get-Item -LiteralPath $Path).Length -ge $MinimumBytes)) {
        Write-Host "Using cached file: $Path"
        return
    }

    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Force
    }

    Write-Host "Downloading: $Url"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Path

    if ((Get-Item -LiteralPath $Path).Length -lt $MinimumBytes) {
        throw "Downloaded file is too small: $Path"
    }
}

function Test-DiskSpace {
    try {
        $driveName = ([System.IO.Path]::GetPathRoot($projectRoot)).Substring(0, 1)
        $drive = Get-PSDrive -Name $driveName -ErrorAction Stop
        $freeGb = [math]::Round($drive.Free / 1GB, 1)
        Write-Host "Free space on $driveName`: $freeGb GB"
        if ($freeGb -lt $minimumFreeGb) {
            throw "At least $minimumFreeGb GB free space is required for the CUDA environment install."
        }
    } catch {
        throw "Disk space check failed: $($_.Exception.Message)"
    }
}

function Install-LocalPython {
    Ensure-Directory $cacheDir
    Download-FileIfNeeded -Url $pythonUrl -Path $pythonInstaller -MinimumBytes 20000000

    Ensure-Directory (Split-Path -Parent $envDir)
    Write-Step "Installing local Python $pythonVersion"
    $installArgs = @(
        "/quiet",
        "InstallAllUsers=0",
        "TargetDir=`"$envDir`"",
        "Include_pip=1",
        "Include_launcher=0",
        "Include_test=0",
        "Shortcuts=0",
        "PrependPath=0"
    )

    $process = Start-Process -FilePath $pythonInstaller -ArgumentList ($installArgs -join " ") -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "Python installer failed with exit code $($process.ExitCode)."
    }

    if (-not (Test-Path -LiteralPath $python)) {
        throw "Python install finished, but python.exe was not found: $python"
    }
}

function Test-NvidiaDriver {
    Write-Step "Checking NVIDIA driver"
    $nvidiaSmi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
    if (-not $nvidiaSmi) {
        Write-Warning "nvidia-smi.exe was not found. Continue installing, but CUDA verification will fail until the NVIDIA driver is installed."
        return
    }

    & $nvidiaSmi.Source | Select-Object -First 16
}

function Install-RuntimePackages {
    if (-not (Test-Path -LiteralPath $requirements)) {
        throw "Missing requirements file: $requirements"
    }

    Add-CudaDllSearchPath

    Write-Step "Upgrading pip tooling"
    Invoke-Checked -FilePath $python -Arguments @("-m", "ensurepip", "--upgrade")
    Invoke-Checked -FilePath $python -Arguments @("-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel")

    Write-Step "Installing PyTorch CUDA 11.8 runtime"
    Invoke-Checked -FilePath $python -Arguments @(
        "-m", "pip", "install",
        "torch==2.0.1+cu118",
        "torchaudio==2.0.2+cu118",
        "--extra-index-url", "https://download.pytorch.org/whl/cu118"
    )

    Write-Step "Installing VoiceChangerStudio runtime packages"
    Invoke-Checked -FilePath $python -Arguments @("-m", "pip", "install", "-r", $requirements)
}

function Verify-CudaRuntime {
    Add-CudaDllSearchPath

    $verifyCode = @"
import importlib
import sys

mods = [
    "fastapi",
    "socketio",
    "numpy",
    "sounddevice",
    "faiss",
    "librosa",
    "torchcrepe",
    "torchfcpe",
    "onnxruntime",
    "torch",
    "torchaudio",
]
failed = []
for mod in mods:
    try:
        importlib.import_module(mod)
    except Exception as exc:
        failed.append(f"{mod}: {exc}")
if failed:
    print("\n".join(failed))
    raise SystemExit(1)

import torch
import onnxruntime as ort

print(f"python={sys.version.split()[0]}")
print(f"torch={torch.__version__}, torch_cuda={torch.version.cuda}, cuda_available={torch.cuda.is_available()}")
if not torch.cuda.is_available():
    raise SystemExit("CUDA is not available to PyTorch. Install or update the NVIDIA driver, then rerun install-env.bat.")
print(f"gpu={torch.cuda.get_device_name(0)}")

providers = ort.get_available_providers()
print("onnxruntime_providers=" + ",".join(providers))
if "CUDAExecutionProvider" not in providers:
    raise SystemExit("ONNX Runtime CUDAExecutionProvider is not available. Check NVIDIA driver and CUDA DLL search path.")

print("cuda runtime ok")
"@

    $tempBase = [System.IO.Path]::GetTempFileName()
    $tempScript = [System.IO.Path]::ChangeExtension($tempBase, ".py")
    try {
        Set-Content -LiteralPath $tempScript -Value $verifyCode -Encoding UTF8
        Write-Step "Verifying CUDA runtime"
        Invoke-Checked -FilePath $python -Arguments @($tempScript)
    } finally {
        Remove-Item -LiteralPath $tempBase, $tempScript -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Host "VoiceChangerStudio CUDA environment installer"
Write-Host "Project: $projectRoot"
Write-Host "Python:  $python"
Write-Host ""
Write-Host "This installer uses the NVIDIA CUDA 11.8 route only. CPU runtime is intentionally not installed."

Test-DiskSpace
Test-NvidiaDriver

if ($Force -and (Test-Path -LiteralPath $envDir)) {
    Write-Step "Removing existing Python environment"
    $stopScript = Join-Path $projectRoot "stop_windows.ps1"
    if (Test-Path -LiteralPath $stopScript) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stopScript | Out-Host
    }
    Remove-Item -LiteralPath $envDir -Recurse -Force
}

if (-not (Test-Path -LiteralPath $python)) {
    Install-LocalPython
} else {
    Write-Step "Using existing local Python"
    & $python --version
}

Install-RuntimePackages

if (-not $SkipVerification) {
    Verify-CudaRuntime
}

Write-Step "Preparing runtime folders"
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

Write-Host ""
Write-Host "Environment install finished." -ForegroundColor Green
Write-Host "Next:"
Write-Host "  1. Put pretrain files in server\\pretrain if they are missing."
Write-Host "  2. Put voice models in server\\model_dir or upload them in the UI."
Write-Host "  3. Run check-new-pc.bat."
Write-Host "  4. Run start-web.bat."

if (Test-Path -LiteralPath $setupCheck) {
    Write-Host ""
    Write-Host "Running new computer check..."
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $setupCheck
}
