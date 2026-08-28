from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status

from app.database import get_db
from app.models.user import UserPublic, UserUpdate
from app.security import get_current_user_id, get_optional_user_id

router = APIRouter()


async def _serialize_user(user_doc: dict, viewer_id: Optional[str] = None) -> UserPublic:
    is_following = False
    if viewer_id and viewer_id != str(user_doc["_id"]):
        db = get_db()
        follow = await db.follows.find_one(
            {"follower_id": viewer_id, "following_id": str(user_doc["_id"])}
        )
        is_following = follow is not None
    return UserPublic(**user_doc, is_following=is_following)


@router.get("/{username}", response_model=UserPublic)
async def get_user(username: str, viewer_id: Optional[str] = Depends(get_optional_user_id)) -> UserPublic:
    db = get_db()
    user = await db.users.find_one({"username": username})
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return await _serialize_user(user, viewer_id)


@router.put("/me", response_model=UserPublic)
async def update_me(data: UserUpdate, user_id: str = Depends(get_current_user_id)) -> UserPublic:
    db = get_db()
    changes = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if changes:
        await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": changes})
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    return await _serialize_user(user)


@router.post("/{username}/follow", status_code=status.HTTP_204_NO_CONTENT)
async def follow_user(username: str, user_id: str = Depends(get_current_user_id)) -> None:
    db = get_db()
    target = await db.users.find_one({"username": username})
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    target_id = str(target["_id"])
    if target_id == user_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot follow yourself")

    try:
        await db.follows.insert_one({"follower_id": user_id, "following_id": target_id})
    except Exception:
        return  # already following — unique index makes this a safe no-op
    await db.users.update_one({"_id": target["_id"]}, {"$inc": {"followers_count": 1}})
    await db.users.update_one({"_id": ObjectId(user_id)}, {"$inc": {"following_count": 1}})


@router.delete("/{username}/follow", status_code=status.HTTP_204_NO_CONTENT)
async def unfollow_user(username: str, user_id: str = Depends(get_current_user_id)) -> None:
    db = get_db()
    target = await db.users.find_one({"username": username})
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    target_id = str(target["_id"])

    result = await db.follows.delete_one({"follower_id": user_id, "following_id": target_id})
    if result.deleted_count:
        await db.users.update_one({"_id": target["_id"]}, {"$inc": {"followers_count": -1}})
        await db.users.update_one({"_id": ObjectId(user_id)}, {"$inc": {"following_count": -1}})
