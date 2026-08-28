import os

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "GrowTok Backend"
    debug: bool = os.getenv("DEBUG", "false").lower() == "true"
    port: int = int(os.getenv("PORT", "8000"))

    # --- Auth ---
    # JWT_SECRET has no safe default in production: if it's missing we raise at
    # startup (see main.py) rather than silently signing tokens with a guessable
    # key. The fallback below only exists so `python -m app...` one-off scripts
    # and local tooling don't explode before .env is loaded.
    jwt_secret: str = os.getenv("JWT_SECRET", "")
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
    refresh_token_expire_days: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "30"))

    # --- Upload limits ---
    # Applies per video. Keeps a single bad request from ballooning memory/DB —
    # base64 inflates binary size by ~33%, so 40MB here is roughly a 30MB clip.
    max_video_base64_chars: int = int(os.getenv("MAX_VIDEO_BASE64_CHARS", str(40 * 1024 * 1024)))
    # Applies to the whole request body (matters most for batch upload).
    max_request_body_bytes: int = int(os.getenv("MAX_REQUEST_BODY_BYTES", str(150 * 1024 * 1024)))
    max_videos_per_batch: int = int(os.getenv("MAX_VIDEOS_PER_BATCH", "10"))

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
