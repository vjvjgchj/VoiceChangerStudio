# VoiceChangerStudio

本项目是一个仅在本机运行的实时变声控制台。它保留必要的变声推理后端，前端入口改为 `server/local_console/`；旧 React demo、旧 recorder、Docker、训练和部署脚本已从当前项目中移除，不参与本地运行。

## 启动

双击：

```powershell
start-web.bat
```

中文入口也保留：`一键启动并打开Web.bat`。

或使用软件入口：

```powershell
launcher.bat
```

中文入口也保留：`本地启动器.bat`。

或在 PowerShell 中执行：

```powershell
.\launch_web.ps1
```

默认地址：

```text
http://127.0.0.1:6006/local/
```

根地址 `http://127.0.0.1:6006/` 会自动进入新控制台。

## 当前结构

```text
server/
  local_console/       本地新界面
  restapi/             本地 API
  sio/                 实时 Socket.IO 链路
  voice_changer/       变声推理核心
  model_dir/           本地模型目录，已被 git 忽略
.mamba-root/           本地 Python 环境，已被 git 忽略
.tools/                本地辅助工具，已被 git 忽略
```

旧项目杂物的临时备份位于项目外：`E:\VoiceChangerStudio_original_archive_20260623`。当前项目运行不依赖它。

## 模型

把 `.pth`、`.onnx`、`.index` 等模型文件放入 `server/model_dir/`，或在新界面的模型库中上传。模型文件属于本地数据，不提交到 git。

## 换电脑部署

推荐做轻量 CUDA 安装包：包里放项目源码、启动器、检查器、安装器和预训练文件；新电脑现场解压项目专用 Python CUDA 环境，不复制旧电脑的大 `.mamba-root`。

旧电脑双击：

```powershell
make-light-package.bat
```

或执行：

```powershell
.\prepare_light_package.ps1
```

把生成的 `VoiceChangerStudio-light` 文件夹复制到新电脑后：

```powershell
install-env.bat
check-new-pc.bat
start-web.bat
```

这条路线只支持 NVIDIA / CUDA 11.8，不做 CPU 降级。新电脑需要安装 NVIDIA 驱动，并建议在项目所在盘预留至少 15 GB 空间给 Python、PyTorch 和运行依赖。安装器使用项目目录里的便携 Python 和本地 pip 缓存，不使用系统 Python，也不会影响电脑上已有的其他 Python 版本。每个复制出来的项目文件夹都有独立环境；同一文件夹安装完成后再次运行会跳过安装。

重复运行 `install-env.bat` 时会先检测现有 CUDA 环境；依赖、项目关键导入、PyTorch CUDA 和 ONNX CUDA provider 都可用时会跳过安装。

如果你想最快迁移，也可以在旧电脑打包完整便携版：

```powershell
.\prepare_portable.ps1
```

或双击：

```powershell
make-portable.bat
```

完整便携版会复制 `.mamba-root`、预训练权重和模型，体积更大，但新电脑安装步骤更少。把生成的 `VoiceChangerStudio-portable` 文件夹复制到新电脑后，先运行：

```powershell
check-new-pc.bat
```

检查通过后双击 `start-web.bat`。中文入口也保留：`打包轻量安装包.bat`、`安装运行环境.bat`、`打包便携版.bat`、`新电脑部署检查.bat`、`一键启动并打开Web.bat`。详细说明见 `docs/new-pc-deployment.md`。

## 验证

常用检查：

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:6006/api/hello
Invoke-RestMethod http://127.0.0.1:6006/info
```

前端脚本语法检查：

```powershell
.\.tools\node-v20.20.2-win-x64\node.exe --check .\server\local_console\app.js
```
