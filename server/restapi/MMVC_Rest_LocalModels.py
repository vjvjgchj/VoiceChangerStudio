import json
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from const import MAX_SLOT_NUM, STORED_SETTING_FILE
from voice_changer.VoiceChangerManager import VoiceChangerManager


class MMVC_Rest_LocalModels:
    def __init__(self, voiceChangerManager: VoiceChangerManager):
        self.voiceChangerManager = voiceChangerManager
        self.router = APIRouter()
        self.router.add_api_route("/api/local/models/{slot_index}", self.delete_model, methods=["DELETE"])

    def _slot_dir(self, slot_index: int) -> Path:
        if slot_index < 0 or slot_index >= MAX_SLOT_NUM:
            raise HTTPException(status_code=400, detail={"error": {"code": "INVALID_SLOT", "message": "Invalid model slot"}})
        base = Path(self.voiceChangerManager.params.model_dir).resolve()
        path = (base / str(slot_index)).resolve()
        try:
            path.relative_to(base)
        except ValueError:
            raise HTTPException(status_code=400, detail={"error": {"code": "INVALID_SLOT", "message": "Invalid model slot"}})
        return path

    def _unload_if_current(self, slot_index: int) -> None:
        if str(self.voiceChangerManager.settings.modelSlotIndex) != str(slot_index):
            return

        self.voiceChangerManager.settings.modelSlotIndex = -1
        self.voiceChangerManager.voiceChanger = None
        self.voiceChangerManager.modelLoadState = "released"
        self.voiceChangerManager.modelLoadError = ""
        if hasattr(self.voiceChangerManager, "voiceChangerModel"):
            delattr(self.voiceChangerManager, "voiceChangerModel")

        if "modelSlotIndex" in self.voiceChangerManager.stored_setting:
            del self.voiceChangerManager.stored_setting["modelSlotIndex"]
            with open(STORED_SETTING_FILE, "w", encoding="utf-8") as f:
                json.dump(self.voiceChangerManager.stored_setting, f)

    def delete_model(self, slot_index: int):
        slot_dir = self._slot_dir(slot_index)
        self._unload_if_current(slot_index)
        if slot_dir.exists():
            shutil.rmtree(slot_dir)
        slot_dir.mkdir(parents=True, exist_ok=True)
        self.voiceChangerManager.modelSlotManager.getAllSlotInfo(reload=True)
        return JSONResponse(content=jsonable_encoder(self.voiceChangerManager.get_info()))
