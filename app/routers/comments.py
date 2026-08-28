from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status

from app.database import get_db
from app.models.comment import CommentCreate, CommentInDB, CommentPublic
from app.models.user import UserPublic
from app.security import get_current_user_id, get_optional_user_id

router = APIRouter()


async def _serialize_comment(doc: dict, viewer_id: Optional[str] = None) -> Optional[CommentPublic]:
    db = get_db()
    user = await db.users.find_one({"_id": ObjectId(doc["user_id"])})
    if not user:
        return None
    return CommentPublic(
        **doc,
        user=UserPublic(**user),
        is_owner=bool(viewer_id and viewer_id == doc["user_id"]),
    )


@router.get("/{video_id}/comments", response_model=list[CommentPublic])
async def get_comments(
    video_id: str, viewer_id: Optional[str] = Depends(get_optional_user_id)
) -> list[CommentPublic]:
    db = get_db()
    docs = await db.comments.find({"video_id": video_id}).sort("created_at", -1).to_list(500)
    results = [await _serialize_comment(d, viewer_id) for d in docs]
    return [r for r in results if r]


@router.post(
    "/{video_id}/comments", response_model=CommentPublic, status_code=status.HTTP_201_CREATED
)
async def add_comment(
    video_id: str, data: CommentCreate, user_id: str = Depends(get_current_user_id)
) -> CommentPublic:
    if not ObjectId.is_valid(video_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video not found")
    db = get_db()
    video = await db.videos.find_one({"_id": ObjectId(video_id)})
    if not video:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video not found")

    doc = CommentInDB(video_id=video_id, user_id=user_id, text=data.text).model_dump()
    doc["created_at"] = datetime.now(timezone.utc)
    result = await db.comments.insert_one(doc)
    doc["_id"] = result.inserted_id

    await db.videos.update_one({"_id": video["_id"]}, {"$inc": {"comments_count": 1}})
    return await _serialize_comment(doc, user_id)


@router.delete("/{video_id}/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    video_id: str, comment_id: str, user_id: str = Depends(get_current_user_id)
) -> None:
    """A comment can be removed by whoever wrote it, or by the video's owner
    moderating their own post — same "only touch what you own" rule as videos."""
    if not ObjectId.is_valid(comment_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comment not found")
    db = get_db()
    comment = await db.comments.find_one({"_id": ObjectId(comment_id), "video_id": video_id})
    if not comment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comment not found")

    video = await db.videos.find_one({"_id": ObjectId(video_id)}) if ObjectId.is_valid(video_id) else None
    is_comment_owner = comment["user_id"] == user_id
    is_video_owner = bool(video and video["owner_id"] == user_id)
    if not (is_comment_owner or is_video_owner):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't delete this comment")

    await db.comments.delete_one({"_id": comment["_id"]})
    await db.videos.update_one({"_id": ObjectId(video_id)}, {"$inc": {"comments_count": -1}})
