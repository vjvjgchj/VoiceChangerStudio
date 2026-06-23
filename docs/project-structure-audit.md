# VoiceChangerStudio Project Structure Audit

Date: 2026-06-23
Location: `E:\VoiceChangerStudio`

## Current Goal

This project is being reshaped into a local-only voice changer studio:

- local launcher first
- new clear local web UI at `/local/`
- existing backend reused for full voice changing capability
- runtime data and model files kept local, outside Git
- original upstream files kept only while they are still useful for rollback or reference

## Git Baseline Policy

Git should track source code, local launcher scripts, UI files, and migration notes.

Git should not track:

- Python environment: `.mamba-root/`
- bundled tools: `.tools/`
- voice models: `server/model_dir/`
- pretrain weights: `server/pretrain/`
- upload, temp, logs, recordings
- generated frontend builds and `node_modules`
- local diagnostic snapshots such as `info_snapshot*.json` and `verify_*.png`

## Must Keep

These are required for the current local app:

- `server/`
  - Backend runtime source.
  - Keep `MMVCServerSIO.py`, `const.py`, `restapi/`, `sio/`, `voice_changer/`, `data/`, `downloader/`, and `requirements.txt`.
- `server/local_console/`
  - New local UI: `index.html`, `app.css`, `app.js`, `socket-lite.js`, `realtime-worklet.js`.
- `server/model_dir/`
  - User models and indexes. Required at runtime, but ignored by Git.
- `server/pretrain/`
  - Required model dependencies. Required at runtime, but ignored by Git.
- `.mamba-root/`
  - Local Python environment. Required at runtime, but ignored by Git.
- `.tools/`
  - Bundled Node and micromamba tools. Useful for local setup, ignored by Git.
- `launch_web.ps1`
  - Starts backend and opens `http://127.0.0.1:6006/local/`.
- `local_launcher.ps1`
  - Software-like launcher for start, stop, model folder, history, logs.
- `本地启动器.bat`
  - User-facing launcher entry.
- `一键启动并打开Web.bat`
  - User-facing one-click start/open entry.
- `stop_windows.ps1`
  - Needed by launcher and UI stop controls.
- `.gitignore`
  - Keeps runtime files out of Git.

## Keep For Now

These are not the future product surface, but should stay until cleanup is verified:

- `client/`
  - Old browser frontend/client library. Original `/front/` is no longer the target UI, but this may still contain reference behavior for real-time audio, settings, or API contracts.
- `recorder/`
  - Old standalone recorder UI. Keep as reference until local recording/history flow is stable.
- `docs/`
  - Contains current planning notes plus old docs. Split later into active docs and archived docs.
- `README*.md`, `LICENSE*`
  - Keep licensing and upstream context until final product packaging is decided.
- `server/model_dir_static/`
  - Empty placeholder/static model directory. Low risk; keep until server mounts are simplified.
- `signatures/`
  - Small upstream metadata; keep until final cleanup pass.

## Archive Candidates

These look unrelated to the local-only app and are good candidates for `_archive_original/` before deletion:

- `.github/`
  - CI workflows for upstream/deployment.
- `.vercel/`
  - Vercel deployment metadata.
- `docker/`
- `docker_folder/`
- `docker_trainer/`
- `docker_vcclient/`
- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`
- `auto_deploy.sh`
- `base.sh`
- `start_docker.sh`
- `start_web.sh`
- `start_anaconda.sh`
- `start_v0.1.sh`
- `start2.sh`
- `script/`
- `scripts/`
- `trainer/`
- `ANACONDA_SETUP.md`
- `LINUX_DEPLOYMENT_GUIDE.md`

Recommended process: move these into `_archive_original/` in one small commit, verify local startup and `/local/`, then delete the archive in a later commit only after the app remains stable.

## Do Not Delete Yet

Do not remove these until there is a verified replacement or explicit user confirmation:

- `server/voice_changer/`
- `server/restapi/`
- `server/sio/`
- `server/data/`
- `server/downloader/`
- `client/`
- `recorder/`
- original C drive project copy: `C:\Users\Administrator\Documents\New project 4\voice-changer-better`

## Current Size Notes

Largest runtime-only directories:

- `.mamba-root/`: about 7.4 GB, ignored
- `server/model_dir/`: about 2.5 GB, ignored
- `server/pretrain/`: about 1.6 GB, ignored
- `.tools/`: about 135 MB, ignored

Tracked baseline candidate:

- About 524 source/config files before adding this audit.
- Largest tracked candidates are old frontend PSD assets in `client/demo/public/settings/`.

## Verification Before Cleanup

Before each cleanup batch:

- `git status --short`
- `E:\VoiceChangerStudio\.tools\node-v20.20.2-win-x64\node.exe --check E:\VoiceChangerStudio\server\local_console\app.js`
- `Invoke-WebRequest -UseBasicParsing -Uri http://127.0.0.1:6006/api/hello`
- Browser check: `http://127.0.0.1:6006/local/`

Success criteria:

- top status shows `OK`
- current model renders
- model library renders installed models
- runtime panel shows backend PID and E drive paths
- no browser console errors
