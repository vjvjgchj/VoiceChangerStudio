# Contributing

欢迎提交改进。这个项目目前优先保证 Windows 本地运行、NVIDIA CUDA 路线和清晰的本地 UI。

## 提交前检查

请确认不要提交这些本地文件：

```text
.mamba-root/
.tools/
server/model_dir/
server/pretrain/
server/tmp_dir/
server/upload_dir/
server/local_recordings/
logs/
*.log
```

常用检查命令：

```powershell
git status --short
npm run check:new-pc
.\.tools\node-v20.20.2-win-x64\node.exe --check .\server\local_console\app.js
```

如果改了 PowerShell 脚本，可以运行：

```powershell
Get-ChildItem .\scripts\windows\*.ps1 | ForEach-Object {
    $null = [System.Management.Automation.PSParser]::Tokenize((Get-Content $_.FullName -Raw), [ref]$null)
}
```

## 目录约定

- `server/` 放后端、API、实时链路和本地 Web UI。
- `scripts/windows/` 放 Windows 自动化脚本。
- `shortcuts/zh-CN/` 放中文快捷入口。
- `docs/` 放部署说明、结构说明和规格文档。
- 根目录只保留 README、许可证、常用 `.bat` 入口和项目配置。

## 设计边界

- 保持本地运行，不默认暴露公网服务。
- 不提交用户模型、预训练权重、录音、转换结果、日志或私有环境。
- 当前不维护 CPU 路线。
- 新功能应优先接入新的本地控制台，而不是恢复旧前端或旧 recorder。
