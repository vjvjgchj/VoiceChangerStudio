# New Computer Deployment

VoiceChangerStudio is designed to run locally. There are two deployment paths:

- Lightweight CUDA install package: small package, install the runtime on the new computer.
- Full portable package: large package, copy the already-built runtime from a working computer.

For this project, the recommended path is the lightweight CUDA package. CPU runtime is intentionally not installed because the real-time experience is too slow.

## Recommended: Lightweight CUDA Package

On the old computer:

```powershell
.\prepare_light_package.ps1
```

Or double-click:

```text
make-light-package.bat
```

Copy the generated folder, normally `E:\VoiceChangerStudio-light`, to the new computer.

On the new computer:

```text
install-env.bat
check-new-pc.bat
start-web.bat
```

The local console opens at:

```text
http://127.0.0.1:6006/local/
```

### New Computer Requirements

- Windows 10/11 64-bit.
- NVIDIA GPU with a current NVIDIA driver.
- Network access for the first install.
- At least 15 GB free disk space on the project drive for Python, PyTorch CUDA, ONNX Runtime GPU, and package caches.

The installer extracts a local portable Python runtime under:

```text
.mamba-root\envs\vcb-py310
```

It does not touch system Python, does not require Python to be in `PATH`, and can coexist with other Python versions already installed on the computer. Pip cache and install temp files are kept under the project `.tools` folder so the system temp drive is not used for large CUDA downloads.

Each copied project folder owns its own Python environment. PyTorch installed in another VoiceChangerStudio folder or in system Python is intentionally not reused. After one folder finishes installing, rerunning `install-env.bat` in that same folder skips package installation.

Running `install-env.bat` again is safe. It checks the existing CUDA runtime first and skips package installation when Python packages, key project imports, PyTorch CUDA, and ONNX Runtime `CUDAExecutionProvider` are already usable.

### What The Lightweight Package Includes

- Local launcher scripts and the static local UI.
- Backend inference source in `server/`.
- CUDA environment installer: `install_environment.ps1` / `install-env.bat`.
- Runtime requirements: `requirements-runtime-cuda118.txt`.
- New computer checker: `setup_new_pc.ps1` / `check-new-pc.bat`.

It intentionally does not include:

- `.mamba-root` Python environment.
- `server\pretrain` weights.
- `server\model_dir` voice models.
- runtime logs, temp files, uploads, recordings, cache files, and Git history.

Copy your models into `server\model_dir`, or upload them in the local UI. For pretrain files, copying `server\pretrain` from the old computer is fastest. The backend can also try to download some missing weights on first start if the new computer can reach the model hosts.

## Full Portable Package

Use this when you want fewer installation steps on the new computer and do not mind a much larger folder.

On the old computer:

```powershell
.\prepare_portable.ps1
```

Or double-click:

```text
make-portable.bat
```

The generated folder is normally:

```text
E:\VoiceChangerStudio-portable
```

The portable package includes:

- Local launcher scripts and the static local UI.
- Backend inference source in `server/`.
- Python runtime in `.mamba-root\envs\vcb-py310` unless `-WithoutPythonEnv` is used.
- Local tools in `.tools`.
- Pretrain files in `server\pretrain` unless `-WithoutPretrain` is used.
- Voice models in `server\model_dir` unless `-WithoutModels` is used.

Runtime logs, temp files, uploads, recordings, cache files, and Git history are not copied.

### Smaller Portable Options

```powershell
.\prepare_portable.ps1 -WithoutModels
.\prepare_portable.ps1 -WithoutPretrain
.\prepare_portable.ps1 -WithoutPythonEnv
```

If Python is excluded, run `install-env.bat` on the new computer.

For a larger package that also keeps the Micromamba package cache:

```powershell
.\prepare_portable.ps1 -IncludePackageCache
```

## New Computer Check

`setup_new_pc.ps1` checks:

- Required project files.
- Runtime folders.
- Python environment and critical package imports.
- CUDA availability through PyTorch.
- ONNX Runtime `CUDAExecutionProvider`.
- Audio device visibility.
- Local UI JavaScript syntax.
- Backend Python syntax.
- Important pretrain files.
- Voice model presence.
- Port `6006` availability.
- Disk free space.

To check and start in one step:

```powershell
.\setup_new_pc.ps1 -Start
```

Or double-click:

```text
check-and-start.bat
```

Chinese aliases are also kept for daily use: `打包便携版.bat`, `新电脑部署检查.bat`, `部署检查并启动.bat`, and `一键启动并打开Web.bat`.

For the lightweight route, the most important daily files are:

```text
make-light-package.bat
install-env.bat
check-new-pc.bat
start-web.bat
```
