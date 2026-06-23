param(
    [string]$Destination,
    [switch]$Zip,
    [switch]$CleanDestination
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Destination) {
    $Destination = Join-Path (Split-Path -Parent $projectRoot) "VoiceChangerStudio-light"
}

$projectRootFull = [System.IO.Path]::GetFullPath($projectRoot).TrimEnd("\")
$destinationFull = [System.IO.Path]::GetFullPath($Destination).TrimEnd("\")

if ($destinationFull.Equals($projectRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Destination cannot be the project directory."
}

if ($destinationFull.StartsWith($projectRootFull + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Destination cannot be inside the project directory. Choose a sibling folder or another drive."
}

function Invoke-RobocopyChecked {
    param(
        [string]$Source,
        [string]$Target,
        [string[]]$ExtraArgs = @()
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        Write-Host "Skip missing: $Source"
        return
    }

    New-Item -ItemType Directory -Path $Target -Force | Out-Null
    $args = @($Source, $Target, "/E", "/R:2", "/W:1", "/NFL", "/NDL", "/NP") + $ExtraArgs
    Write-Host "Copy: $Source -> $Target"
    & robocopy @args | Out-Host
    $code = $LASTEXITCODE
    if ($code -ge 8) {
        throw "Robocopy failed with exit code $code while copying $Source"
    }
}

function Copy-FileIfExists([string]$RelativePath) {
    $source = Join-Path $projectRoot $RelativePath
    if (Test-Path -LiteralPath $source) {
        $target = Join-Path $destinationFull $RelativePath
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $target -Force
    }
}

if ((Test-Path -LiteralPath $destinationFull) -and $CleanDestination) {
    $root = [System.IO.Path]::GetPathRoot($destinationFull).TrimEnd("\")
    if ($destinationFull.Length -le ($root.Length + 1)) {
        throw "Refusing to clean a drive root: $destinationFull"
    }
    Remove-Item -LiteralPath $destinationFull -Recurse -Force
}

New-Item -ItemType Directory -Path $destinationFull -Force | Out-Null

Write-Host ""
Write-Host "Preparing lightweight VoiceChangerStudio install package"
Write-Host "Source:      $projectRootFull"
Write-Host "Destination: $destinationFull"
Write-Host ""

$rootFiles = @(
    ".env.example",
    ".flake8",
    ".gitignore",
    "package.json",
    "README.md",
    "requirements-runtime-cuda118.txt",
    "install_environment.ps1",
    "prepare_light_package.ps1",
    "prepare_portable.ps1",
    "setup_new_pc.ps1",
    "launch_web.ps1",
    "local_launcher.ps1",
    "start_windows.ps1",
    "stop_windows.ps1",
    "install-env.bat",
    "make-light-package.bat",
    "start-web.bat",
    "launcher.bat",
    "check-new-pc.bat",
    "check-and-start.bat",
    "make-portable.bat",
    "安装运行环境.bat",
    "打包轻量安装包.bat",
    "一键启动并打开Web.bat",
    "本地启动器.bat",
    "新电脑部署检查.bat",
    "部署检查并启动.bat",
    "打包便携版.bat"
)

foreach ($file in $rootFiles) {
    Copy-FileIfExists $file
}

Get-ChildItem -LiteralPath $projectRoot -File -Filter "LICENSE*" -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $destinationFull $_.Name) -Force
}

Invoke-RobocopyChecked `
    -Source (Join-Path $projectRoot "server") `
    -Target (Join-Path $destinationFull "server") `
    -ExtraArgs @(
        "/XD",
        "model_dir",
        "pretrain",
        "tmp_dir",
        "upload_dir",
        "local_recordings",
        "logs",
        "__pycache__",
        ".vscode",
        "/XF",
        "*.pyc",
        "*.pyo",
        "*.wav",
        "vcclient.log",
        "stored_setting.json",
        "stored_setting.json.bak-*"
    )

Invoke-RobocopyChecked -Source (Join-Path $projectRoot "docs") -Target (Join-Path $destinationFull "docs")
Invoke-RobocopyChecked -Source (Join-Path $projectRoot "signatures") -Target (Join-Path $destinationFull "signatures")

$runtimeDirs = @(
    ".tools\cache",
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
    New-Item -ItemType Directory -Path (Join-Path $destinationFull $dir) -Force | Out-Null
}

$notePath = Join-Path $destinationFull "LIGHT_DEPLOYMENT.txt"
@"
VoiceChangerStudio lightweight CUDA install package

This package intentionally does not include:
- .mamba-root Python environment
- server\pretrain weights
- server\model_dir voice models
- .tools Node/Micromamba binaries

New computer flow:
1. Copy this whole folder to the new Windows computer.
2. Install or update the NVIDIA driver first.
3. Double-click install-env.bat.
4. Copy pretrain files into server\pretrain if the check reports them missing.
5. Copy voice models into server\model_dir or upload them in the local UI.
6. Double-click check-new-pc.bat.
7. Double-click start-web.bat.

This project does not install a CPU route. CUDA is required for the intended performance.
"@ | Set-Content -LiteralPath $notePath -Encoding UTF8

if ($Zip) {
    $zipPath = "$destinationFull.zip"
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }
    Write-Host "Compressing: $zipPath"
    Compress-Archive -LiteralPath $destinationFull -DestinationPath $zipPath -Force
}

Write-Host ""
Write-Host "Lightweight install package is ready:"
Write-Host $destinationFull
Write-Host ""
Write-Host "Next step on the new computer:"
Write-Host "  1. Run install-env.bat"
Write-Host "  2. Run check-new-pc.bat"
Write-Host "  3. Run start-web.bat"
