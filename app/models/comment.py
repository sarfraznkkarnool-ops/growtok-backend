from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.models.common import object_id_to_str
from app.models.user import UserPublic


class CommentCreate(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class CommentInDB(BaseModel):
    video_id: str
    user_id: str
    text: str
    likes_count: int = 0


class CommentPublic(BaseModel):
    id: str = Field(alias="_id")
    text: str
    likes_count: int
    created_at: Any
    user: UserPublic
    is_owner: bool = False

    @field_validator("id", mode="before")
    @classmethod
    def coerce_id(cls, v: Any) -> str:
        return object_id_to_str(v)

    model_config = {"populate_by_name": True}
