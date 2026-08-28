from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.config import settings
from app.models.common import object_id_to_str
from app.models.user import UserPublic


class VideoCreate(BaseModel):
    caption: str = Field("", max_length=2200)
    sound_name: str = Field("Original sound", max_length=100)
    video_base64: Optional[str] = None
    video_url: Optional[str] = None
    thumbnail_base64: Optional[str] = None
    thumbnail_url: Optional[str] = None

    @field_validator("video_base64")
    @classmethod
    def check_video_size(cls, v: Optional[str]) -> Optional[str]:
        if v and len(v) > settings.max_video_base64_chars:
            raise ValueError(
                f"Video is too large ({len(v)} base64 chars). "
                f"Max is {settings.max_video_base64_chars} — compress the clip and try again."
            )
        return v

    @model_validator(mode="after")
    def require_video_source(self) -> "VideoCreate":
        if not self.video_base64 and not self.video_url:
            raise ValueError("video_base64 or video_url is required")
        return self


class VideoBatchCreate(BaseModel):
    """Lets a client post several clips in one request instead of one call per video."""
    videos: List[VideoCreate] = Field(..., min_length=1, max_length=settings.max_videos_per_batch)


class VideoUpdate(BaseModel):
    caption: Optional[str] = Field(None, max_length=2200)
    sound_name: Optional[str] = Field(None, max_length=100)


class VideoInDB(BaseModel):
    owner_id: str
    caption: str = ""
    sound_name: str = "Original sound"
    video_base64: Optional[str] = None
    video_url: Optional[str] = None
    thumbnail_base64: Optional[str] = None
    thumbnail_url: Optional[str] = None
    likes_count: int = 0
    comments_count: int = 0
    shares_count: int = 0


class VideoPublic(BaseModel):
    id: str = Field(alias="_id")
    caption: str
    sound_name: str
    video_base64: Optional[str] = None
    video_url: Optional[str] = None
    thumbnail_base64: Optional[str] = None
    thumbnail_url: Optional[str] = None
    likes_count: int
    comments_count: int
    shares_count: int
    created_at: Any
    owner: UserPublic
    is_liked: bool = False
    # Lets the client show "edit / delete" controls without a second lookup.
    is_owner: bool = False

    @field_validator("id", mode="before")
    @classmethod
    def coerce_id(cls, v: Any) -> str:
        return object_id_to_str(v)

    model_config = {"populate_by_name": True}


class BatchUploadResponse(BaseModel):
    created: List[VideoPublic]
    failed: List[dict] = Field(
        default_factory=list,
        description="Entries that failed to save, with their index and error, so a "
        "partial batch failure doesn't silently drop clips.",
    )
