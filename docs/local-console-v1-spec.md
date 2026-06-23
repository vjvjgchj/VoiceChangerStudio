# Spec: Local Console V1

## Objective

VoiceChangerStudio is a local-only voice changer console. The V1 product surface is the static UI in `server/local_console/`; the old React demo and standalone recorder have been removed from the project tree and are not runtime dependencies.

## Runtime Shape

- Backend: Python FastAPI and Socket.IO service in `server/`
- UI: zero-build HTML/CSS/JS in `server/local_console/`
- Entry: `http://127.0.0.1:6006/local/`
- Root route: redirects to `/local/`
- Launcher: `一键启动并打开Web.bat`, `launch_web.ps1`, and `local_launcher.ps1`

## Boundaries

- Keep the app local-only by default.
- Keep model files and generated recordings out of Git.
- Do not reintroduce `/front`, `/trainer`, or `/recorder` as user-facing routes.
- Do not depend on `client/demo`, `client/lib`, or `recorder` for runtime assets.
- Keep the inference engine in `server/voice_changer/` unless a replacement is explicitly planned and verified.

## Verification

```powershell
.\.tools\node-v20.20.2-win-x64\node.exe --check .\server\local_console\app.js
.\.mamba-root\envs\vcb-py310\python.exe -m py_compile .\server\MMVCServerSIO.py .\server\restapi\MMVC_Rest.py .\server\sio\MMVC_SocketIOApp.py
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:6006/api/hello
Invoke-RestMethod http://127.0.0.1:6006/info
```

## Success Criteria

- Starting the launcher opens the new local console.
- `http://127.0.0.1:6006/` redirects to `/local/`.
- `/front`, `/trainer`, and `/recorder` do not serve the old UI.
- New UI can read `/info`, list models, show backend status, and start the realtime chain.
- Runtime does not require `client/` or `recorder/` to exist in the project root.
