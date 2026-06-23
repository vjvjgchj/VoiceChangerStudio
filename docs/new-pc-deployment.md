# New Computer Deployment

VoiceChangerStudio is designed to run locally. The easiest migration path is a portable folder copied from a working computer.

## Recommended Flow

On the old computer:

```powershell
.\prepare_portable.ps1
```

Or double-click:

```text
make-portable.bat
```

Copy the generated folder, normally `E:\VoiceChangerStudio-portable`, to the new computer.

On the new computer:

```text
check-new-pc.bat
start-web.bat
```

The local console opens at:

```text
http://127.0.0.1:6006/local/
```

## What The Portable Package Includes

- Local launcher scripts and the static local UI.
- Backend inference source in `server/`.
- Python runtime in `.mamba-root\envs\vcb-py310` unless `-WithoutPythonEnv` is used.
- Local tools in `.tools`.
- Pretrain files in `server\pretrain` unless `-WithoutPretrain` is used.
- Voice models in `server\model_dir` unless `-WithoutModels` is used.

Runtime logs, temp files, uploads, recordings, cache files, and Git history are not copied.

## Smaller Package Options

```powershell
.\prepare_portable.ps1 -WithoutModels
.\prepare_portable.ps1 -WithoutPretrain
.\prepare_portable.ps1 -WithoutPythonEnv
```

Use these only when you plan to copy those missing parts separately.

For a larger package that also keeps the Micromamba package cache:

```powershell
.\prepare_portable.ps1 -IncludePackageCache
```

## New Computer Check

`setup_new_pc.ps1` checks:

- Required project files.
- Runtime folders.
- Python environment and critical package imports.
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
