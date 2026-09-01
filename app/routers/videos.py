import httpx
from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, UploadFile, status

from app.database import get_db
from app.models.video import (
    BatchUploadResponse, VideoBatchCreate, VideoCreate, VideoInDB, VideoPublic, VideoUpdate,
)
from app.models.user import UserPublic
from app.security import get_current_user_id, get_optional_user_id

router = APIRouter()


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------

async def _serialize_video(video_doc: dict, viewer_id: Optional[str] = None) -> Optional[VideoPublic]:
    db = get_db()
    owner = await db.users.find_one({"_id": ObjectId(video_doc["owner_id"])})
    if not owner:
        return None

    is_liked = False
    if viewer_id:
        like = await db.likes.find_one({"user_id": viewer_id, "video_id": str(video_doc["_id"])})
        is_liked = like is not None

    is_following = False
    if viewer_id and viewer_id != video_doc["owner_id"]:
        f = await db.follows.find_one({"follower_id": viewer_id, "following_id": video_doc["owner_id"]})
        is_following = f is not None

    return VideoPublic(
        **video_doc,
        owner=UserPublic(**owner, is_following=is_following),
        is_liked=is_liked,
        is_owner=bool(viewer_id and viewer_id == video_doc["owner_id"]),
    )


async def _get_owned_video_or_403(video_id: str, user_id: str) -> dict:
    """
    Fetch a video and confirm the caller owns it — the core "manage your own
    content securely" check. 404 (not 403) when the video doesn't exist at all,
    so we don't leak which video IDs exist to someone probing at random; 403
    when it exists but belongs to someone else.
    """
    if not ObjectId.is_valid(video_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video not found")
    db = get_db()
    video = await db.videos.find_one({"_id": ObjectId(video_id)})
    if not video:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video not found")
    if video["owner_id"] != user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't own this video")
    return video


# ---------------------------------------------------------------------------
# Feed / read
# ---------------------------------------------------------------------------

@router.get("/feed", response_model=list[VideoPublic])
async def get_feed(
    skip: int = 0,
    limit: int = 10,
    viewer_id: Optional[str] = Depends(get_optional_user_id),
) -> list[VideoPublic]:
    limit = min(limit, 50)  # cap it — an unbounded limit is a cheap DoS lever
    db = get_db()
    docs = await db.videos.find().sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    results = [await _serialize_video(d, viewer_id) for d in docs]
    return [r for r in results if r]


@router.get("/me", response_model=list[VideoPublic])
async def get_my_videos(user_id: str = Depends(get_current_user_id)) -> list[VideoPublic]:
    """The authenticated user's own uploads — for a 'manage my content' screen."""
    db = get_db()
    docs = await db.videos.find({"owner_id": user_id}).sort("created_at", -1).to_list(500)
    results = [await _serialize_video(d, user_id) for d in docs]
    return [r for r in results if r]


@router.get("/{video_id}", response_model=VideoPublic)
async def get_video(video_id: str, viewer_id: Optional[str] = Depends(get_optional_user_id)) -> VideoPublic:
    if not ObjectId.is_valid(video_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video not found")
    db = get_db()
    doc = await db.videos.find_one({"_id": ObjectId(video_id)})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video not found")
    result = await _serialize_video(doc, viewer_id)
    if not result:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video not found")
    return result

CLOUDINARY_CLOUD_NAME = "c-46ceef3b679b"
CLOUDINARY_UPLOAD_PRESET = "growtok_upload"


@router.post("/upload")
async def upload_video_to_cloudinary(file: UploadFile = File(...)):
  url = (
      f"https://api.cloudinary.com/v1_1/{CLOUDINARY_CLOUD_NAME}/video/upload"
  )
  try:
    file_bytes = await file.read()
    data = {"upload_preset": CLOUDINARY_UPLOAD_PRESET}
    files = {"file": (file.filename, file_bytes, file.content_type)}

    async with httpx.AsyncClient() as client:
      response = await client.post(url, data=data, files=files)

    if response.status_code != 200:
      raise HTTPException(
          status_code=500, detail="Cloudinary upload fail ho gaya!"
      )

    result = response.json()
    return {
        "success": True,
        "video_url": result.get("secure_url"),
        "public_id": result.get("public_id"),
    }
  except Exception as e:
    raise HTTPException(status_code=500, detail=str(e))

# ---------------------------------------------------------------------------
# Upload (single + batch)
# ---------------------------------------------------------------------------

@router.post("", response_model=VideoPublic, status_code=status.HTTP_201_CREATED)
async def create_video(data: VideoCreate, user_id: str = Depends(get_current_user_id)) -> VideoPublic:
    db = get_db()
    doc = VideoInDB(owner_id=user_id, **data.model_dump()).model_dump()
    doc["created_at"] = datetime.now(timezone.utc)
    result = await db.videos.insert_one(doc)
    doc["_id"] = result.inserted_id
    return await _serialize_video(doc, user_id)


@router.post("/batch", response_model=BatchUploadResponse, status_code=status.HTTP_201_CREATED)
async def create_videos_batch(
    data: VideoBatchCreate, user_id: str = Depends(get_current_user_id)
) -> BatchUploadResponse:
    """
    Upload several clips in one call. Each clip is validated and inserted
    independently — one bad clip in the batch doesn't fail the whole request,
    it's reported back in `failed` alongside the ones that succeeded, so a
    client uploading 10 videos doesn't lose the other 9 over one bad file.
    """
    db = get_db()
    created: list[VideoPublic] = []
    failed: list[dict] = []

    for index, video_create in enumerate(data.videos):
        try:
            doc = VideoInDB(owner_id=user_id, **video_create.model_dump()).model_dump()
            doc["created_at"] = datetime.now(timezone.utc)
            result = await db.videos.insert_one(doc)
            doc["_id"] = result.inserted_id
            serialized = await _serialize_video(doc, user_id)
            if serialized:
                created.append(serialized)
        except Exception as exc:
            failed.append({"index": index, "error": str(exc)})

    return BatchUploadResponse(created=created, failed=failed)


# ---------------------------------------------------------------------------
# Manage own content (update / delete — ownership enforced)
# ---------------------------------------------------------------------------

@router.patch("/{video_id}", response_model=VideoPublic)
async def update_video(
    video_id: str, data: VideoUpdate, user_id: str = Depends(get_current_user_id)
) -> VideoPublic:
    video = await _get_owned_video_or_403(video_id, user_id)
    db = get_db()
    changes = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if changes:
        await db.videos.update_one({"_id": video["_id"]}, {"$set": changes})
    updated = await db.videos.find_one({"_id": video["_id"]})
    return await _serialize_video(updated, user_id)


@router.delete("/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_video(video_id: str, user_id: str = Depends(get_current_user_id)) -> None:
    video = await _get_owned_video_or_403(video_id, user_id)
    db = get_db()
    await db.videos.delete_one({"_id": video["_id"]})
    # Clean up everything that referenced it — orphaned likes/comments would
    # otherwise sit in the DB forever and can leak into other queries/counts.
    await db.likes.delete_many({"video_id": video_id})
    await db.comments.delete_many({"video_id": video_id})


# ---------------------------------------------------------------------------
# Likes / shares
# ---------------------------------------------------------------------------

@router.post("/{video_id}/like", status_code=status.HTTP_204_NO_CONTENT)
async def like_video(video_id: str, user_id: str = Depends(get_current_user_id)) -> None:
    if not ObjectId.is_valid(video_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video not found")
    db = get_db()
    video = await db.videos.find_one({"_id": ObjectId(video_id)})
    if not video:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video not found")

    try:
        await db.likes.insert_one({"user_id": user_id, "video_id": video_id})
    except Exception:
        return  # already liked — unique index makes this a safe no-op
    await db.videos.update_one({"_id": video["_id"]}, {"$inc": {"likes_count": 1}})
    await db.users.update_one({"_id": ObjectId(video["owner_id"])}, {"$inc": {"likes_count": 1}})


@router.delete("/{video_id}/like", status_code=status.HTTP_204_NO_CONTENT)
async def unlike_video(video_id: str, user_id: str = Depends(get_current_user_id)) -> None:
    if not ObjectId.is_valid(video_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video not found")
    db = get_db()
    video = await db.videos.find_one({"_id": ObjectId(video_id)})
    if not video:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video not found")

    result = await db.likes.delete_one({"user_id": user_id, "video_id": video_id})
    if result.deleted_count:
        await db.videos.update_one({"_id": video["_id"]}, {"$inc": {"likes_count": -1}})
        await db.users.update_one({"_id": ObjectId(video["owner_id"])}, {"$inc": {"likes_count": -1}})


@router.post("/{video_id}/share", status_code=status.HTTP_204_NO_CONTENT)
async def share_video(video_id: str) -> None:
    if not ObjectId.is_valid(video_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video not found")
    db = get_db()
    result = await db.videos.update_one({"_id": ObjectId(video_id)}, {"$inc": {"shares_count": 1}})
    if result.matched_count == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video not found")
