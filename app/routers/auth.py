import jwt as pyjwt
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from pymongo.errors import DuplicateKeyError

from app.config import settings
from app.database import get_db
from app.models.user import (
    RefreshRequest, TokenResponse, UserInDB, UserLogin, UserPublic, UserSignup,
)
from app.security import (
    create_access_token, enforce_login_rate_limit, get_current_user_id,
    hash_password, issue_refresh_token, revoke_all_refresh_tokens_for_user,
    revoke_refresh_token, rotate_refresh_token, verify_password,
)

router = APIRouter()


@router.post(
    "/signup",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(enforce_login_rate_limit)],
)
async def signup(data: UserSignup) -> TokenResponse:
    db = get_db()
    user_doc = UserInDB(
        email=data.email,
        username=data.username,
        display_name=data.display_name or data.username,
        password_hash=hash_password(data.password),
    ).model_dump()

    try:
        result = await db.users.insert_one(user_doc)
    except DuplicateKeyError:
        # The unique indexes on email/username (see database.py) are the real
        # guard against races; this pre-check just gives a clearer message.
        existing_email = await db.users.find_one({"email": data.email})
        field = "Email" if existing_email else "Username"
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{field} already in use")

    user_id = str(result.inserted_id)
    access = create_access_token(user_id)
    refresh = await issue_refresh_token(user_id)
    user_doc["_id"] = result.inserted_id
    return TokenResponse(
        access_token=access, refresh_token=refresh, user=UserPublic(**user_doc)
    )


@router.post("/login", response_model=TokenResponse, dependencies=[Depends(enforce_login_rate_limit)])
async def login(data: UserLogin) -> TokenResponse:
    db = get_db()
    user = await db.users.find_one({"email": data.email})

    # Same error for "no such user" and "wrong password" — don't leak which
    # part was wrong, that's an account-enumeration vector.
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")

    user_id = str(user["_id"])
    access = create_access_token(user_id)
    refresh = await issue_refresh_token(user_id)
    return TokenResponse(access_token=access, refresh_token=refresh, user=UserPublic(**user))


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(data: RefreshRequest) -> TokenResponse:
    """
    Exchange a refresh token for a new access + refresh token pair. The old
    refresh token is consumed (rotation) — reusing it afterward is treated as
    theft and revokes the whole session family (see security.py).
    """
    access, new_refresh = await rotate_refresh_token(data.refresh_token)
    decoded = pyjwt.decode(access, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    payload_user_id = decoded["sub"]

    db = get_db()
    user = await db.users.find_one({"_id": ObjectId(payload_user_id)})
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer exists")

    return TokenResponse(access_token=access, refresh_token=new_refresh, user=UserPublic(**user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(data: RefreshRequest) -> None:
    """Revoke one refresh token (this device's session)."""
    await revoke_refresh_token(data.refresh_token)


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
async def logout_all(user_id: str = Depends(get_current_user_id)) -> None:
    """Revoke every refresh token for this account — 'log out everywhere'."""
    await revoke_all_refresh_tokens_for_user(user_id)


@router.get("/me", response_model=UserPublic)
async def get_me(user_id: str = Depends(get_current_user_id)) -> UserPublic:
    db = get_db()
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return UserPublic(**user)
