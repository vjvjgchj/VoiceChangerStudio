# VoiceChangerStudio

本项目是一个仅在本机运行的实时变声控制台。它保留必要的变声推理后端，前端入口改为 `server/local_console/`；旧 React demo、旧 recorder、Docker、训练和部署脚本已从当前项目中移除，不参与本地运行。

## 启动

双击：

```powershell
一键启动并打开Web.bat
```

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
