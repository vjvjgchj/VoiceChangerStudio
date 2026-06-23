import socketio
from mods.log_control import VoiceChangaerLogger
from mods.origins import compute_local_origins, normalize_origins

from typing import Sequence, Optional
from sio.MMVC_SocketIOServer import MMVC_SocketIOServer
from voice_changer.VoiceChangerManager import VoiceChangerManager

logger = VoiceChangaerLogger.get_instance().getLogger()

class MMVC_SocketIOApp:
    _instance: socketio.ASGIApp | None = None

    @classmethod
    def get_instance(
        cls,
        app_fastapi,
        voiceChangerManager: VoiceChangerManager,
        allowedOrigins: Optional[Sequence[str]] = None,
        port: Optional[int] = None,
    ):
        if cls._instance is None:
            logger.info("[Voice Changer] MMVC_SocketIOApp initializing...")

            allowed_origins: set[str] = set()
            local_origins = compute_local_origins(port)
            allowed_origins.update(local_origins)
            if allowedOrigins is not None:
                normalized_origins = normalize_origins(allowedOrigins)
                allowed_origins.update(normalized_origins)
            sio = MMVC_SocketIOServer.get_instance(voiceChangerManager, list(allowed_origins))

            app_socketio = socketio.ASGIApp(
                sio,
                other_asgi_app=app_fastapi,
            )

            cls._instance = app_socketio
            logger.info("[Voice Changer] MMVC_SocketIOApp initializing... done.")
            return cls._instance

        return cls._instance
