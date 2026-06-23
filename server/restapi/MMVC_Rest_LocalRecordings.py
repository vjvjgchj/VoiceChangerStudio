import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Form, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, JSONResponse

from const import LOCAL_RECORDINGS_DIR, TMP_DIR


INPUT_FILE_NAME = "input.wav"
OUTPUT_FILE_NAME = "output.wav"
METADATA_FILE_NAME = "metadata.json"
ID_PATTERN = re.compile(r"^[0-9A-Za-z_-]+$")


class MMVC_Rest_LocalRecordings:
    def __init__(self):
        self.router = APIRouter()
        self.base_dir = Path(LOCAL_RECORDINGS_DIR)
        self.base_dir.mkdir(parents=True, exist_ok=True)

        self.router.add_api_route("/api/local/recordings", self.list_recordings, methods=["GET"])
        self.router.add_api_route("/api/local/recordings", self.create_recording, methods=["POST"])
        self.router.add_api_route("/api/local/recordings/{recording_id}", self.update_recording, methods=["PATCH"])
        self.router.add_api_route("/api/local/recordings/{recording_id}", self.delete_recording, methods=["DELETE"])
        self.router.add_api_route("/api/local/recordings/{recording_id}/input.wav", self.get_input_file, methods=["GET"])
        self.router.add_api_route("/api/local/recordings/{recording_id}/output.wav", self.get_output_file, methods=["GET"])
        self.router.add_api_route("/api/local/recordings/{recording_id}/open-folder", self.open_folder, methods=["POST"])

    def _recording_dir(self, recording_id: str) -> Path:
        if not ID_PATTERN.match(recording_id):
            raise HTTPException(status_code=400, detail={"error": {"code": "INVALID_ID", "message": "Invalid recording id"}})
        path = (self.base_dir / recording_id).resolve()
        base = self.base_dir.resolve()
        try:
            path.relative_to(base)
        except ValueError:
            raise HTTPException(status_code=400, detail={"error": {"code": "INVALID_ID", "message": "Invalid recording id"}})
        return path

    def _metadata_path(self, recording_id: str) -> Path:
        return self._recording_dir(recording_id) / METADATA_FILE_NAME

    def _load_metadata(self, recording_id: str) -> dict:
        folder = self._recording_dir(recording_id)
        metadata_path = folder / METADATA_FILE_NAME
        if not folder.exists() or not metadata_path.exists():
            raise HTTPException(status_code=404, detail={"error": {"code": "NOT_FOUND", "message": "Recording not found"}})
        with metadata_path.open("r", encoding="utf-8") as f:
            metadata = json.load(f)
        return self._with_urls(metadata)

    def _save_metadata(self, metadata: dict) -> None:
        folder = self._recording_dir(metadata["id"])
        folder.mkdir(parents=True, exist_ok=True)
        metadata_path = folder / METADATA_FILE_NAME
        stored = {key: value for key, value in metadata.items() if key not in {"inputUrl", "outputUrl", "folderPath", "inputSize", "outputSize"}}
        with metadata_path.open("w", encoding="utf-8") as f:
            json.dump(stored, f, ensure_ascii=False, indent=2)

    def _with_urls(self, metadata: dict) -> dict:
        recording_id = metadata["id"]
        folder = self._recording_dir(recording_id)
        result = dict(metadata)
        result["inputUrl"] = f"/api/local/recordings/{recording_id}/input.wav"
        result["outputUrl"] = f"/api/local/recordings/{recording_id}/output.wav"
        result["folderPath"] = str(folder)
        result["inputSize"] = self._file_size(folder / INPUT_FILE_NAME)
        result["outputSize"] = self._file_size(folder / OUTPUT_FILE_NAME)
        return result

    def _file_size(self, path: Path) -> int:
        return path.stat().st_size if path.exists() else 0

    def _clean_text(self, value: Optional[str], fallback: str = "") -> str:
        return value.strip() if isinstance(value, str) else fallback

    def _wav_response(self, recording_id: str, file_name: str) -> FileResponse:
        folder = self._recording_dir(recording_id)
        path = folder / file_name
        if not path.exists():
            raise HTTPException(status_code=404, detail={"error": {"code": "FILE_NOT_FOUND", "message": "Recording file not found"}})
        return FileResponse(path=str(path), media_type="audio/wav")

    def list_recordings(self):
        records = []
        for child in self.base_dir.iterdir():
            if not child.is_dir():
                continue
            metadata_path = child / METADATA_FILE_NAME
            if not metadata_path.exists():
                continue
            try:
                with metadata_path.open("r", encoding="utf-8") as f:
                    records.append(self._with_urls(json.load(f)))
            except Exception:
                continue
        records.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
        return JSONResponse(content=jsonable_encoder({"data": records}))

    def create_recording(
        self,
        title: Optional[str] = Form(None),
        sourceType: str = Form("recording"),
        sourceName: Optional[str] = Form(None),
        modelName: Optional[str] = Form(None),
        tune: Optional[str] = Form(None),
    ):
        input_path = Path(TMP_DIR) / "in.wav"
        output_path = Path(TMP_DIR) / "out.wav"
        if not input_path.exists() or not output_path.exists():
            raise HTTPException(status_code=404, detail={"error": {"code": "TMP_RECORDING_NOT_FOUND", "message": "No tmp recording found"}})

        now = datetime.now().astimezone()
        recording_id = now.strftime("%Y%m%d-%H%M%S-%f")
        folder = self._recording_dir(recording_id)
        folder.mkdir(parents=True, exist_ok=False)

        shutil.copy2(input_path, folder / INPUT_FILE_NAME)
        shutil.copy2(output_path, folder / OUTPUT_FILE_NAME)

        clean_title = self._clean_text(title)
        metadata = {
            "id": recording_id,
            "title": clean_title or now.strftime("%Y-%m-%d %H:%M:%S"),
            "createdAt": now.isoformat(timespec="seconds"),
            "sourceType": self._clean_text(sourceType, "recording") or "recording",
            "sourceName": self._clean_text(sourceName),
            "modelName": self._clean_text(modelName),
            "tune": self._clean_text(tune),
        }
        self._save_metadata(metadata)
        return JSONResponse(content=jsonable_encoder(self._with_urls(metadata)), status_code=201)

    def update_recording(self, recording_id: str, title: str = Form(...)):
        metadata = self._load_metadata(recording_id)
        clean_title = self._clean_text(title)
        if not clean_title:
            raise HTTPException(status_code=422, detail={"error": {"code": "VALIDATION_ERROR", "message": "Title is required"}})
        metadata["title"] = clean_title[:120]
        self._save_metadata(metadata)
        return JSONResponse(content=jsonable_encoder(self._with_urls(metadata)))

    def delete_recording(self, recording_id: str):
        folder = self._recording_dir(recording_id)
        if folder.exists():
            shutil.rmtree(folder)
        return JSONResponse(content={"ok": True})

    def get_input_file(self, recording_id: str):
        return self._wav_response(recording_id, INPUT_FILE_NAME)

    def get_output_file(self, recording_id: str):
        return self._wav_response(recording_id, OUTPUT_FILE_NAME)

    def open_folder(self, recording_id: str):
        folder = self._recording_dir(recording_id)
        if not folder.exists():
            raise HTTPException(status_code=404, detail={"error": {"code": "NOT_FOUND", "message": "Recording not found"}})
        if sys.platform.startswith("win"):
            os.startfile(str(folder))  # type: ignore[attr-defined]
        elif sys.platform.startswith("darwin"):
            subprocess.Popen(["open", str(folder)])
        else:
            subprocess.Popen(["xdg-open", str(folder)])
        return JSONResponse(content={"ok": True})
