# VoiceChangerStudio

VoiceChangerStudio 是一个只在本机运行的 Windows 实时变声控制台。项目保留必要的推理后端和新的本地 Web UI，目标是让普通用户可以双击启动、上传模型、调整参数，并在换电脑时更容易重新部署。

> 当前路线只面向 NVIDIA / CUDA。项目不提供 CPU 降级运行方案。

![VoiceChangerStudio local console](docs/assets/voicechangerstudio-local-console.png)

## 快速开始

第一次使用先安装项目私有 CUDA Python 环境：

```powershell
install-env.bat
```

启动本地控制台：

```powershell
start-web.bat
```

默认地址：

```text
http://127.0.0.1:6006/local/
```

也可以打开软件式启动器：

```powershell
launcher.bat
```

中文快捷方式放在：

```text
shortcuts/zh-CN/
```

## 目录结构

```text
server/                 推理后端、本地 API、实时 Socket.IO 链路和本地 Web UI
scripts/windows/        Windows 启动、停止、安装、检查和打包脚本
shortcuts/zh-CN/        中文双击快捷入口
docs/                   部署说明、结构审计和功能规格
signatures/             项目签名/校验元数据
requirements-*.txt      Python CUDA 运行依赖
```

根目录只保留常用入口：

```text
start-web.bat           启动后端并打开 Web UI
launcher.bat            打开本地启动器
install-env.bat         安装/修复私有 CUDA Python 环境
check-new-pc.bat        检查新电脑部署状态
check-and-start.bat     检查通过后启动
make-light-package.bat  生成轻量部署包
make-portable.bat       生成完整便携包
```

## 本地数据

这些目录属于本机运行数据，已被 Git 忽略，不会上传到 GitHub：

```text
.mamba-root/            项目私有 Python 环境
.tools/                 下载缓存和辅助工具
server/model_dir/       声音模型
server/pretrain/        预训练权重
server/tmp_dir/         临时文件
server/upload_dir/      上传文件
server/local_recordings/录音和文件转换记录
logs/                   本地日志
```

模型文件放入 `server/model_dir/`，或在 UI 的模型库中上传。常见模型文件包括 `.pth`、`.onnx`、`.index`、`.safetensors`。

## 换电脑部署

推荐生成轻量 CUDA 安装包：

```powershell
make-light-package.bat
```

新电脑解压后依次运行：

```powershell
install-env.bat
check-new-pc.bat
start-web.bat
```

如果想复制完整环境、预训练文件和模型，可以生成便携包：

```powershell
make-portable.bat
```

更详细说明见 [docs/new-pc-deployment.md](docs/new-pc-deployment.md)。

## 开发与验证

常用命令：

```powershell
npm run start
npm run stop
npm run check:new-pc
npm run package:light
npm run package:portable
```

本地接口检查：

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:6006/api/hello
Invoke-RestMethod http://127.0.0.1:6006/info
```

前端脚本语法检查：

```powershell
.\.tools\node-v20.20.2-win-x64\node.exe --check .\server\local_console\app.js
```

PowerShell 脚本语法检查：

```powershell
Get-ChildItem .\scripts\windows\*.ps1 | ForEach-Object {
    $null = [System.Management.Automation.PSParser]::Tokenize((Get-Content $_.FullName -Raw), [ref]$null)
}
```
