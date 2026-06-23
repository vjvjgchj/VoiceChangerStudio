import gc
import importlib.util
import json
import os
import socket
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from const import STORED_SETTING_FILE, TMP_DIR, UPLOAD_DIR
from voice_changer.VoiceChangerManager import VoiceChangerManager
from voice_changer.utils.VoiceChangerParams import VoiceChangerParams


class MMVC_Rest_LocalSystem:
    def __init__(self, voiceChangerManager: VoiceChangerManager, voiceChangerParams: VoiceChangerParams, port: int | None):
        self.voiceChangerManager = voiceChangerManager
        self.voiceChangerParams = voiceChangerParams
        self.port = port or 6006
        self.server_root = Path(__file__).resolve().parents[1]
        self.project_root = Path(__file__).resolve().parents[2]
        self.router = APIRouter(prefix="/api/local/system")
        self.router.add_api_route("/status", self.get_status, methods=["GET"])
        self.router.add_api_route("/checks", self.get_checks, methods=["GET"])
        self.router.add_api_route("/release-audio", self.release_audio, methods=["POST"])
        self.router.add_api_route("/release-model", self.release_model, methods=["POST"])
        self.router.add_api_route("/stop", self.stop_backend, methods=["POST"])
        self.router.add_api_route("/restart", self.restart_backend, methods=["POST"])

    def _current_model(self) -> dict[str, Any]:
        slot_index = self.voiceChangerManager.settings.modelSlotIndex
        slot = None
        if isinstance(slot_index, int) and slot_index >= 0:
            try:
                slot = self.voiceChangerManager.modelSlotManager.get_slot_info(slot_index)
            except Exception:
                slot = None
        return {
            "isLoaded": self.voiceChangerManager.voiceChanger is not None,
            "slotIndex": slot_index,
            "name": getattr(slot, "name", None),
            "voiceChangerType": getattr(slot, "voiceChangerType", None),
            "modelType": getattr(slot, "modelType", None),
        }

    def _memory_for_current_process(self) -> dict[str, int | None]:
        try:
            import psutil  # type: ignore

            info = psutil.Process(os.getpid()).memory_info()
            return {
                "workingSetBytes": getattr(info, "rss", None),
                "privateBytes": getattr(info, "private", None) or getattr(info, "vms", None),
            }
        except Exception:
            pass

        if os.name == "nt":
            try:
                import ctypes
                from ctypes import wintypes

                class PROCESS_MEMORY_COUNTERS_EX(ctypes.Structure):
                    _fields_ = [
                        ("cb", wintypes.DWORD),
                        ("PageFaultCount", wintypes.DWORD),
                        ("PeakWorkingSetSize", ctypes.c_size_t),
                        ("WorkingSetSize", ctypes.c_size_t),
                        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                        ("PagefileUsage", ctypes.c_size_t),
                        ("PeakPagefileUsage", ctypes.c_size_t),
                        ("PrivateUsage", ctypes.c_size_t),
                    ]

                counters = PROCESS_MEMORY_COUNTERS_EX()
                counters.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS_EX)
                process = ctypes.windll.kernel32.GetCurrentProcess()
                psapi = ctypes.WinDLL("Psapi.dll")
                psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESS_MEMORY_COUNTERS_EX), wintypes.DWORD]
                psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
                ok = psapi.GetProcessMemoryInfo(process, ctypes.byref(counters), counters.cb)
                if ok:
                    return {
                        "workingSetBytes": int(counters.WorkingSetSize),
                        "privateBytes": int(counters.PrivateUsage),
                    }
            except Exception:
                pass

        return {"workingSetBytes": None, "privateBytes": None}

    def _related_python_processes(self) -> list[dict[str, Any]]:
        try:
            import psutil  # type: ignore
        except Exception:
            return []

        env_root = (self.project_root / ".mamba-root").resolve()
        processes = []
        for proc in psutil.process_iter(["pid", "name", "exe", "memory_info"]):
            try:
                exe = proc.info.get("exe") or ""
                if not exe:
                    continue
                exe_path = Path(exe).resolve()
                try:
                    exe_path.relative_to(env_root)
                except ValueError:
                    continue
                memory = proc.info.get("memory_info")
                processes.append(
                    {
                        "pid": proc.info.get("pid"),
                        "name": proc.info.get("name"),
                        "exe": str(exe_path),
                        "workingSetBytes": getattr(memory, "rss", None),
                        "privateBytes": getattr(memory, "private", None) or getattr(memory, "vms", None),
                    }
                )
            except Exception:
                continue
        return sorted(processes, key=lambda item: item.get("workingSetBytes") or 0, reverse=True)

    def _port_status(self) -> dict[str, Any]:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.settimeout(0.2)
            result = sock.connect_ex(("127.0.0.1", int(self.port)))
            return {
                "host": "127.0.0.1",
                "port": int(self.port),
                "isListening": result == 0,
                "detail": "当前后端正在监听" if result == 0 else "端口未监听",
            }
        finally:
            sock.close()

    def _dependency_check(self) -> dict[str, Any]:
        modules = ["fastapi", "socketio", "numpy", "torch", "onnxruntime"]
        missing = [name for name in modules if importlib.util.find_spec(name) is None]
        return {
            "ok": len(missing) == 0,
            "detail": "依赖完整" if not missing else f"缺少：{', '.join(missing)}",
            "missing": missing,
        }

    def _installed_model_count(self) -> int:
        try:
            return len([slot for slot in self.voiceChangerManager.modelSlotManager.getAllSlotInfo(reload=True) if getattr(slot, "modelFile", None)])
        except Exception:
            return 0

    def get_status(self):
        info = self.voiceChangerManager.get_info()
        selected_gpu = next((gpu for gpu in info.get("gpus", []) if gpu.get("id") == info.get("gpu")), None)
        payload = {
            "status": "OK",
            "backend": {
                "isRunning": True,
                "pid": os.getpid(),
                "parentPid": os.getppid(),
                "host": "127.0.0.1",
                "port": int(self.port),
                "memory": self._memory_for_current_process(),
                "relatedPythonProcesses": self._related_python_processes(),
            },
            "runtime": {
                "pythonPath": sys.executable,
                "pythonVersion": sys.version.split()[0],
                "cwd": str(Path.cwd()),
            },
            "model": self._current_model(),
            "device": {
                "mode": "CPU" if info.get("gpu") == -1 else "GPU",
                "gpu": selected_gpu,
            },
            "audio": {
                "recordIO": info.get("recordIO", 0),
                "performance": info.get("performance", []),
                "serverReadChunkSize": info.get("serverReadChunkSize"),
            },
            "paths": {
                "projectRoot": str(self.project_root),
                "serverRoot": str(self.server_root),
                "modelDir": str((self.server_root / self.voiceChangerParams.model_dir).resolve()),
                "tmpDir": str((self.server_root / TMP_DIR).resolve()),
                "uploadDir": str((self.server_root / UPLOAD_DIR).resolve()),
            },
        }
        return JSONResponse(content=jsonable_encoder(payload))

    def get_checks(self):
        python_ok = Path(sys.executable).exists()
        dependency = self._dependency_check()
        model_dir = (self.server_root / self.voiceChangerParams.model_dir).resolve()
        port = self._port_status()
        launch_script = self.project_root / "launch_web.ps1"
        stop_script = self.project_root / "stop_windows.ps1"
        checks = [
            {
                "id": "python",
                "label": "Python 环境",
                "ok": python_ok,
                "detail": sys.executable if python_ok else "未找到当前 Python",
            },
            {
                "id": "dependencies",
                "label": "依赖完整性",
                "ok": dependency["ok"],
                "detail": dependency["detail"],
            },
            {
                "id": "modelDir",
                "label": "模型目录",
                "ok": model_dir.exists(),
                "detail": f"{model_dir} / {self._installed_model_count()} 个模型",
            },
            {
                "id": "port",
                "label": "端口占用",
                "ok": port["isListening"],
                "detail": f"{port['host']}:{port['port']} / {port['detail']}",
            },
            {
                "id": "scripts",
                "label": "启动脚本",
                "ok": launch_script.exists() and stop_script.exists(),
                "detail": "启动/停止脚本存在" if launch_script.exists() and stop_script.exists() else "缺少启动或停止脚本",
            },
        ]
        payload = {
            "status": "OK" if all(check["ok"] for check in checks) else "WARN",
            "checks": checks,
        }
        return JSONResponse(content=jsonable_encoder(payload))

    def _write_stored_settings(self) -> None:
        with open(STORED_SETTING_FILE, "w", encoding="utf-8") as file:
            json.dump(self.voiceChangerManager.stored_setting, file, ensure_ascii=False)

    def _release_audio(self) -> None:
        try:
            self.voiceChangerManager.update_settings("recordIO", 0)
        except Exception:
            pass

    def release_audio(self):
        self._release_audio()
        return JSONResponse(content=jsonable_encoder({"status": "OK", "message": "音频录制链路已释放"}))

    def release_model(self):
        self._release_audio()
        self.voiceChangerManager.settings.modelSlotIndex = -1
        self.voiceChangerManager.voiceChanger = None
        self.voiceChangerManager.modelLoadState = "released"
        self.voiceChangerManager.modelLoadError = ""
        if hasattr(self.voiceChangerManager, "voiceChangerModel"):
            delattr(self.voiceChangerManager, "voiceChangerModel")
        if "modelSlotIndex" in self.voiceChangerManager.stored_setting:
            del self.voiceChangerManager.stored_setting["modelSlotIndex"]
            self._write_stored_settings()
        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass
        return JSONResponse(content=jsonable_encoder(self.voiceChangerManager.get_info()))

    def _ps_quote(self, path: Path) -> str:
        return "'" + str(path).replace("'", "''") + "'"

    def _run_powershell_later(self, command: str) -> None:
        def runner() -> None:
            popen_kwargs: dict[str, Any] = {}
            if os.name == "nt":
                popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
            subprocess.Popen(
                ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
                cwd=str(self.project_root),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                **popen_kwargs,
            )

        threading.Timer(0.6, runner).start()

    def stop_backend(self):
        stop_script = self.project_root / "stop_windows.ps1"
        self._run_powershell_later(f"Start-Sleep -Milliseconds 600; & {self._ps_quote(stop_script)}")
        return JSONResponse(content=jsonable_encoder({"status": "stopping", "message": "正在停止本地后端"}))

    def restart_backend(self):
        stop_script = self.project_root / "stop_windows.ps1"
        launch_script = self.project_root / "launch_web.ps1"
        command = f"Start-Sleep -Milliseconds 600; & {self._ps_quote(stop_script)}; Start-Sleep -Seconds 2; & {self._ps_quote(launch_script)}"
        self._run_powershell_later(command)
        return JSONResponse(content=jsonable_encoder({"status": "restarting", "message": "正在重启本地后端"}))
