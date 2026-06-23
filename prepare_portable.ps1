param(
    [string]$Destination,
    [switch]$WithoutModels,
    [switch]$WithoutPythonEnv,
    [switch]$WithoutPretrain,
    [switch]$IncludePackageCache,
    [switch]$Zip,
    [switch]$CleanDestination
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Destination) {
    $Destination = Join-Path (Split-Path -Parent $projectRoot) "VoiceChangerStudio-portable"
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
Write-Host "Preparing portable VoiceChangerStudio"
Write-Host "Source:      $projectRootFull"
Write-Host "Destination: $destinationFull"
Write-Host ""

$rootFiles = @(
    ".env.example",
    ".flake8",
    ".gitignore",
    "package.json",
    "README.md",
    "launch_web.ps1",
    "local_launcher.ps1",
    "prepare_portable.ps1",
    "setup_new_pc.ps1",
    "start_windows.ps1",
    "stop_windows.ps1",
    "start-web.bat",
    "launcher.bat",
    "check-new-pc.bat",
    "check-and-start.bat",
    "make-portable.bat",
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
        "stored_setting.json.bak-*"
    )

Invoke-RobocopyChecked -Source (Join-Path $projectRoot "docs") -Target (Join-Path $destinationFull "docs")
Invoke-RobocopyChecked -Source (Join-Path $projectRoot "signatures") -Target (Join-Path $destinationFull "signatures")

if (-not $WithoutPythonEnv) {
    Invoke-RobocopyChecked -Source (Join-Path $projectRoot ".mamba-root\envs") -Target (Join-Path $destinationFull ".mamba-root\envs")
    Invoke-RobocopyChecked -Source (Join-Path $projectRoot ".mamba-root\condabin") -Target (Join-Path $destinationFull ".mamba-root\condabin")
    Invoke-RobocopyChecked -Source (Join-Path $projectRoot ".mamba-root\Scripts") -Target (Join-Path $destinationFull ".mamba-root\Scripts")
    if ($IncludePackageCache) {
        Invoke-RobocopyChecked -Source (Join-Path $projectRoot ".mamba-root\pkgs") -Target (Join-Path $destinationFull ".mamba-root\pkgs")
    }
}

Invoke-RobocopyChecked `
    -Source (Join-Path $projectRoot ".tools") `
    -Target (Join-Path $destinationFull ".tools") `
    -ExtraArgs @("/XD", "micromamba-extract", "/XF", "*.zip", "*.tar.bz2")

if (-not $WithoutPretrain) {
    Invoke-RobocopyChecked -Source (Join-Path $projectRoot "server\pretrain") -Target (Join-Path $destinationFull "server\pretrain")
}

if (-not $WithoutModels) {
    Invoke-RobocopyChecked -Source (Join-Path $projectRoot "server\model_dir") -Target (Join-Path $destinationFull "server\model_dir")
} else {
    New-Item -ItemType Directory -Path (Join-Path $destinationFull "server\model_dir") -Force | Out-Null
}

$runtimeDirs = @(
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

$notePath = Join-Path $destinationFull "PORTABLE_DEPLOYMENT.txt"
@"
VoiceChangerStudio portable package

1. Copy this whole folder to the new Windows computer.
2. Double-click "check-new-pc.bat".
3. If the check is OK, double-click "start-web.bat".
4. Open http://127.0.0.1:6006/local/ if the browser does not open automatically.

If models were excluded, copy model files into server\model_dir or upload them in the local UI.
If Python was excluded, copy a package that includes .mamba-root or rebuild the Python environment.
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
Write-Host "Portable package is ready:"
Write-Host $destinationFull
Write-Host ""
Write-Host "Next step on the new computer:"
Write-Host "  1. Run check-new-pc.bat"
Write-Host "  2. Run start-web.bat"
