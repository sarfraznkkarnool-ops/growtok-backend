"""
Auth primitives: password hashing, JWT access/refresh tokens, and the FastAPI
dependencies that enforce them on protected routes.

Design, and why:

- Access tokens are short-lived (default 30 min) and carry no server-side state —
  a stolen access token is only useful for a short window.
- Refresh tokens are long-lived but opaque to the client: only their *hash* is
  stored in Mongo (`refresh_tokens` collection), the same way you'd store a
  password. If the DB leaks, stored refresh tokens are useless without also
  reversing the hash. Presenting a refresh token consumes it and issues a new
  one (rotation) — reusing an old, already-rotated refresh token revokes the
  entire token family, which flags token theft (see refresh_access_token()).
- Logout deletes the refresh token's DB record, which immediately invalidates
  it — something a bare stateless JWT can never do.

What this does NOT cover (being upfront, since "hack-proof" isn't a real
property software has): no email verification, no 2FA, no anomaly/IP
detection, no WAF/DDoS layer — those live outside the application layer
(reverse proxy, hosting provider, email service) and aren't things a FastAPI
app alone can provide.
"""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from bson import ObjectId
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings
from app.database import get_db

bearer_scheme = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        # Malformed hash in the DB — treat as a failed login, not a 500.
        return False


# ---------------------------------------------------------------------------
# Access tokens (short-lived, stateless JWT)
# ---------------------------------------------------------------------------

def create_access_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "type": "access",
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        return None


# ---------------------------------------------------------------------------
# Refresh tokens (long-lived, opaque, hashed at rest, rotated on use)
# ---------------------------------------------------------------------------

def _hash_refresh_token(raw_token: str) -> str:
    # SHA-256 (not bcrypt) here: this value is a high-entropy random secret,
    # not a low-entropy human password, so a fast deterministic hash is
    # appropriate and lets us index/look it up directly by hash.
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


async def issue_refresh_token(user_id: str, family_id: Optional[str] = None) -> str:
    """Create a new refresh token, store its hash, return the raw token to the client."""
    db = get_db()
    raw_token = secrets.token_urlsafe(48)
    family_id = family_id or secrets.token_urlsafe(16)
    now = datetime.now(timezone.utc)

    await db.refresh_tokens.insert_one({
        "token_hash": _hash_refresh_token(raw_token),
        "user_id": user_id,
        "family_id": family_id,
        "created_at": now,
        "expires_at": now + timedelta(days=settings.refresh_token_expire_days),
        "revoked": False,
    })
    return raw_token


async def rotate_refresh_token(raw_token: str) -> tuple[str, str]:
    """
    Validate + consume a refresh token, issue a new access + refresh token pair.
    Raises HTTPException(401) if the token is invalid, expired, revoked, or reused.
    """
    db = get_db()
    token_hash = _hash_refresh_token(raw_token)
    record = await db.refresh_tokens.find_one({"token_hash": token_hash})

    if not record:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")

    if record["revoked"]:
        # This token was already used once before (rotation already happened)
        # or was explicitly revoked via logout. Reuse of a rotated token is a
        # strong signal of theft — revoke every token in the family so a
        # stolen-and-replayed token can't keep producing valid sessions.
        await db.refresh_tokens.update_many(
            {"family_id": record["family_id"]}, {"$set": {"revoked": True}}
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token has already been used")

    expires_at = record["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token has expired")

    await db.refresh_tokens.update_one({"_id": record["_id"]}, {"$set": {"revoked": True}})

    new_access = create_access_token(record["user_id"])
    new_refresh = await issue_refresh_token(record["user_id"], family_id=record["family_id"])
    return new_access, new_refresh


async def revoke_refresh_token(raw_token: str) -> None:
    db = get_db()
    await db.refresh_tokens.update_one(
        {"token_hash": _hash_refresh_token(raw_token)}, {"$set": {"revoked": True}}
    )


async def revoke_all_refresh_tokens_for_user(user_id: str) -> None:
    """Used for a 'log out everywhere' action, or if an account is compromised."""
    db = get_db()
    await db.refresh_tokens.update_many({"user_id": user_id}, {"$set": {"revoked": True}})


# ---------------------------------------------------------------------------
# Request-time dependencies
# ---------------------------------------------------------------------------

async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> str:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "access" or not payload.get("sub"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")

    # Confirm the user still exists — a deleted account's old access tokens
    # stay cryptographically "valid" until they expire, so check the DB too.
    db = get_db()
    if not ObjectId.is_valid(payload["sub"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token subject")
    user = await db.users.find_one({"_id": ObjectId(payload["sub"])}, {"_id": 1})
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer exists")
    return payload["sub"]


async def get_optional_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> Optional[str]:
    if credentials is None:
        return None
    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "access" or not payload.get("sub"):
        return None
    return payload["sub"]


# ---------------------------------------------------------------------------
# Brute-force mitigation for /auth/login and /auth/signup
# ---------------------------------------------------------------------------
# In-memory sliding window keyed by client IP. This is deliberately simple —
# no extra dependency — and is enough to blunt naive credential-stuffing
# scripts. It is NOT sufficient on its own in a multi-process deployment
# (gunicorn runs 2 worker processes here, each with its own memory, so a
# determined attacker can get ~2x the allowed rate by hitting different
# workers). For real production hardening, move this to Redis (shared across
# workers) or enforce it at the reverse proxy / API gateway layer.

class _RateLimiter:
    def __init__(self, max_attempts: int, window_seconds: int):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._hits: dict[str, list[float]] = {}

    def check(self, key: str) -> None:
        import time
        now = time.time()
        window_start = now - self.window_seconds
        hits = [t for t in self._hits.get(key, []) if t > window_start]
        if len(hits) >= self.max_attempts:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Too many attempts. Try again in a minute.",
            )
        hits.append(now)
        self._hits[key] = hits


_login_limiter = _RateLimiter(max_attempts=10, window_seconds=60)


def enforce_login_rate_limit(request: Request) -> None:
    client_ip = request.client.host if request.client else "unknown"
    _login_limiter.check(client_ip)
