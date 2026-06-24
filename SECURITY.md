# Security Policy

VoiceChangerStudio 是本地运行项目，默认只监听 `127.0.0.1`。公开仓库不应包含模型、录音、日志、私有 Python 环境或任何访问令牌。

## 请不要提交

```text
.env
.mamba-root/
.tools/
server/model_dir/
server/pretrain/
server/upload_dir/
server/tmp_dir/
server/local_recordings/
logs/
*.log
*.key
*.pem
```

## 报告问题

如果发现安全问题，请先通过 GitHub issue 描述影响范围和复现步骤。不要在 issue 中贴出真实密钥、个人录音、私有模型或包含个人信息的日志。

## 本地使用建议

- 保持服务绑定在 `127.0.0.1`。
- 只从可信来源下载模型和预训练文件。
- 上传模型前确认文件来源可信。
- 公开分享仓库前运行 `git status --short` 并检查 `.gitignore` 是否仍覆盖本地数据目录。
