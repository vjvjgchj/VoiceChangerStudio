# Spec: Local Console V1

## Objective
Build a local-only voice changer console on top of the existing backend. The first version keeps the current inference engine and original full React UI, while adding a clearer zero-build local control surface for daily use.

## Tech Stack
- Backend: existing Python FastAPI/Socket.IO service in `server/`
- Frontend: static HTML/CSS/JS in `server/local_console`
- Full UI fallback: existing React + TypeScript + webpack app in `client/demo`
- Runtime: local Windows launch through `launch_web.ps1` and `一键启动并打开Web.bat`

## Commands
- Start local app: `powershell -ExecutionPolicy Bypass -File "C:\Users\Administrator\Documents\New project 4\voice-changer-better\launch_web.ps1"`
- Local console does not require a frontend build
- Optional full UI build: `cd "C:\Users\Administrator\Documents\New project 4\voice-changer-better\client\demo" && npm run build:prod`
- Verify server: `Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:6006/api/hello"`

## Project Structure
- `server/local_console/`: zero-build local console page, styles, and browser logic
- `server/restapi/MMVC_Rest.py`: mounts `/local`
- `client/demo/`: original full UI retained for upload/edit/advanced workflows
- `server/`: unchanged backend engine and REST/Socket.IO APIs
- `docs/`: product and implementation notes

## Code Style
Use small browser functions around existing REST APIs. Keep DOM updates explicit and local.

```js
const updateSetting = async (key, val) => {
    const form = new FormData();
    form.append("key", key);
    form.append("val", String(val));
    await fetch("/update_settings", { method: "POST", body: form });
};
```

## Testing Strategy
- Build check with `npm run build:prod`
- Local runtime check at `http://localhost:6006/local/`
- Confirm `/api/hello` and `/info` still return successfully
- Manual checks: model switching, presets, parameter controls, sample download, full UI fallback link

## Boundaries
- Always: keep backend inference behavior compatible, preserve existing dialogs, use localhost by default
- Ask first: changing model file layout, replacing inference logic, adding a desktop packaging dependency
- Never: require a cloud account, expose the service publicly by default, remove advanced controls

## Success Criteria
- Local app opens to a clear console without losing access to old controls
- User can switch models, download sample models, tune pitch, adjust index, apply presets, and open the full UI for upload/edit/audio workflows
- Preset buttons can apply low-latency, balanced, high-quality, and noise-focused parameter groups
- Existing backend starts and serves the rebuilt frontend

## Open Questions
- Final project name and branding
- Whether V2 should become a packaged Tauri/Electron desktop app or stay browser-first
- Which model download sources should be bundled into the local model library
