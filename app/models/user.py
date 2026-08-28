from typing import Any, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.models.common import object_id_to_str


class UserSignup(BaseModel):
    email: EmailStr
    username: str = Field(min_length=3, max_length=24, pattern=r"^[a-zA-Z0-9_.]+$")
    password: str = Field(min_length=8, max_length=72)  # bcrypt ignores bytes past 72
    display_name: Optional[str] = Field(None, max_length=50)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserUpdate(BaseModel):
    display_name: Optional[str] = Field(None, max_length=50)
    bio: Optional[str] = Field(None, max_length=150)
    avatar_base64: Optional[str] = None


class UserInDB(BaseModel):
    """Internal representation — never returned directly from an endpoint."""
    email: EmailStr
    username: str
    display_name: str
    password_hash: str
    bio: str = ""
    avatar_base64: Optional[str] = None
    followers_count: int = 0
    following_count: int = 0
    likes_count: int = 0


class UserPublic(BaseModel):
    id: str = Field(alias="_id")
    username: str
    display_name: str
    bio: str = ""
    avatar_base64: Optional[str] = None
    followers_count: int = 0
    following_count: int = 0
    likes_count: int = 0
    is_following: bool = False

    @field_validator("id", mode="before")
    @classmethod
    def coerce_id(cls, v: Any) -> str:
        return object_id_to_str(v)

    model_config = {"populate_by_name": True}


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserPublic


class RefreshRequest(BaseModel):
    refresh_token: str
