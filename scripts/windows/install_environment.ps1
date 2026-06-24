param(
    [switch]$Force,
    [switch]$SkipVerification
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
$envDir = Join-Path $projectRoot ".mamba-root\envs\vcb-py310"
$python = Join-Path $envDir "python.exe"
$toolsDir = Join-Path $projectRoot ".tools"
$cacheDir = Join-Path $toolsDir "cache"
$pipCacheDir = Join-Path $toolsDir "pip-cache"
$installTempDir = Join-Path $toolsDir "install-temp"
$requirements = Join-Path $projectRoot "requirements-runtime-cuda118.txt"
$setupCheck = Join-Path $projectRoot "scripts\windows\setup_new_pc.ps1"
$pythonVersion = "3.10.11"
$pythonPackage = Join-Path $cacheDir "python.$pythonVersion.nupkg"
$pythonPackageUrl = "https://www.nuget.org/api/v2/package/python/$pythonVersion"
$pythonPackageExtractDir = Join-Path $cacheDir "python-$pythonVersion-nuget"
$minimumFreeGb = 15
$runtimeProbeCode = @"
import importlib
import sys
import warnings

warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)

mods = [
    "OpenSSL",
    "dataclasses_json",
    "einops",
    "faiss",
    "fastapi",
    "gin",
    "librosa",
    "local_attention",
    "matplotlib",
    "multipart",
    "numpy",
    "onnxruntime",
    "onnxsim",
    "parselmouth",
    "psutil",
    "pyworld",
    "requests",
    "resampy",
    "safetensors",
    "scipy",
    "sklearn",
    "socketio",
    "sounddevice",
    "soundfile",
    "torch",
    "torchaudio",
    "torchcrepe",
    "torchfcpe",
    "tqdm",
    "transformers",
    "uvicorn",
    "websockets",
    "yaml",
]
failed = []
for mod in mods:
    try:
        importlib.import_module(mod)
    except Exception as exc:
        failed.append(f"{mod}: {exc}")

if not failed:
    try:
        from transformers import HubertModel, Wav2Vec2FeatureExtractor, Wav2Vec2ForCTC
    except Exception as exc:
        failed.append(f"transformers audio classes: {exc}")

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

function Remove-DirectoryInsideProject([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $projectFullPath = [System.IO.Path]::GetFullPath($projectRoot).TrimEnd('\')
    $targetFullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
    if (-not $targetFullPath.StartsWith($projectFullPath + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a directory outside this project: $targetFullPath"
    }

    Remove-Item -LiteralPath $Path -Recurse -Force
}

function Use-LocalInstallScratch {
    Ensure-Directory $cacheDir
    Ensure-Directory $pipCacheDir
    Ensure-Directory $installTempDir

    $env:TEMP = $installTempDir
    $env:TMP = $installTempDir
    $env:PIP_CACHE_DIR = $pipCacheDir
    $env:PIP_DISABLE_PIP_VERSION_CHECK = "1"
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
    Use-LocalInstallScratch
    Ensure-Directory $cacheDir
    Download-FileIfNeeded -Url $pythonPackageUrl -Path $pythonPackage -MinimumBytes 10000000

    Ensure-Directory (Split-Path -Parent $envDir)
    Write-Step "Installing local Python $pythonVersion"
    Write-Host "Using portable NuGet Python package. No system Python or PATH changes are required."

    Remove-DirectoryInsideProject $envDir
    Remove-DirectoryInsideProject $pythonPackageExtractDir

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($pythonPackage, $pythonPackageExtractDir)

    $pythonToolsDir = Join-Path $pythonPackageExtractDir "tools"
    if (-not (Test-Path -LiteralPath (Join-Path $pythonToolsDir "python.exe"))) {
        throw "Python package did not contain tools\python.exe: $pythonPackage"
    }

    Ensure-Directory $envDir
    Get-ChildItem -LiteralPath $pythonToolsDir -Force | Copy-Item -Destination $envDir -Recurse -Force

    if (-not (Test-Path -LiteralPath $python)) {
        throw "Python extraction finished, but python.exe was not found: $python"
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

    Use-LocalInstallScratch
    Add-CudaDllSearchPath

    Write-Host "Using isolated project Python: $python"
    Write-Host "Pip cache: $pipCacheDir"
    Write-Host "Install temp: $installTempDir"

    Write-Step "Preparing pip tooling"
    Invoke-Checked -FilePath $python -Arguments @("-m", "ensurepip", "--upgrade")
    Invoke-Checked -FilePath $python -Arguments @("-m", "pip", "install", "--no-warn-script-location", "--upgrade", "pip", "wheel")
    Invoke-Checked -FilePath $python -Arguments @("-m", "pip", "install", "--no-warn-script-location", "setuptools<81")

    Write-Step "Installing PyTorch CUDA 11.8 runtime"
    Write-Host "PyTorch is installed inside this project folder only. Other Python installations on this computer are not reused."
    Invoke-Checked -FilePath $python -Arguments @(
        "-m", "pip", "install",
        "--no-warn-script-location",
        "torch==2.0.1+cu118",
        "torchaudio==2.0.2+cu118",
        "--extra-index-url", "https://download.pytorch.org/whl/cu118"
    )

    Write-Step "Installing VoiceChangerStudio runtime packages"
    Invoke-Checked -FilePath $python -Arguments @("-m", "pip", "install", "--no-warn-script-location", "-r", $requirements)
}

function Invoke-CudaRuntimeProbe {
    Add-CudaDllSearchPath

    $tempBase = [System.IO.Path]::GetTempFileName()
    $tempScript = [System.IO.Path]::ChangeExtension($tempBase, ".py")
    try {
        Set-Content -LiteralPath $tempScript -Value $runtimeProbeCode -Encoding UTF8
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $output = & $python $tempScript 2>&1
        return [pscustomobject]@{
            ExitCode = $LASTEXITCODE
            Output = ($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
        }
    } finally {
        if ($previousErrorActionPreference) {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        Remove-Item -LiteralPath $tempBase, $tempScript -Force -ErrorAction SilentlyContinue
    }
}

function Test-ExistingCudaRuntime {
    if (-not (Test-Path -LiteralPath $python)) {
        return $false
    }

    Write-Step "Checking existing CUDA environment"
    $probe = Invoke-CudaRuntimeProbe
    if ($probe.ExitCode -eq 0) {
        Write-Host $probe.Output
        Write-Host "Existing CUDA environment is ready. Skipping package installation." -ForegroundColor Green
        return $true
    }

    Write-Warning "Existing environment is incomplete or broken. The installer will repair it."
    if ($probe.Output) {
        Write-Host $probe.Output
    }
    return $false
}

function Verify-CudaRuntime {
    Write-Step "Verifying CUDA runtime"
    $probe = Invoke-CudaRuntimeProbe
    if ($probe.Output) {
        Write-Host $probe.Output
    }
    if ($probe.ExitCode -ne 0) {
        throw "CUDA runtime verification failed."
    }
}

Write-Host ""
Write-Host "VoiceChangerStudio CUDA environment installer"
Write-Host "Project: $projectRoot"
Write-Host "Python:  $python"
Write-Host ""
Write-Host "This installer uses the NVIDIA CUDA 11.8 route only. CPU runtime is intentionally not installed."

Use-LocalInstallScratch
Test-DiskSpace
Test-NvidiaDriver

if ($Force -and (Test-Path -LiteralPath $envDir)) {
    Write-Step "Removing existing Python environment"
    $stopScript = Join-Path $projectRoot "scripts\windows\stop_windows.ps1"
    if (Test-Path -LiteralPath $stopScript) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stopScript | Out-Host
    }
    Remove-Item -LiteralPath $envDir -Recurse -Force
}

$environmentReady = $false

if (-not (Test-Path -LiteralPath $python)) {
    Install-LocalPython
} else {
    Write-Step "Using existing local Python"
    & $python --version
    if (-not $Force) {
        $environmentReady = Test-ExistingCudaRuntime
    }
}

if (-not $environmentReady) {
    Install-RuntimePackages
    if (-not $SkipVerification) {
        Verify-CudaRuntime
    }
} elseif (-not $SkipVerification) {
    Write-Step "Environment check"
    Write-Host "Dependency check already passed before install. No reinstall was needed." -ForegroundColor Green
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
