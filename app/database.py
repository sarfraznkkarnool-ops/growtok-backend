import os
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

_client: AsyncIOMotorClient | None = None
_connection_error: str | None = None


def get_client() -> AsyncIOMotorClient:
    if _client is None:
        raise RuntimeError("Database client is not initialised. Call connect_db() first.")
    return _client


def get_db() -> AsyncIOMotorDatabase:
    return get_client()["app"]


def get_connection_error() -> str | None:
    return _connection_error


async def _ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    """
    Unique/lookup indexes. These matter for correctness under concurrency
    (two simultaneous signups with the same email can both pass an app-level
    "does this exist" check and only the DB-level unique index stops the
    second one) as well as query performance.
    """
    await db.users.create_index("email", unique=True)
    await db.users.create_index("username", unique=True)

    await db.videos.create_index("owner_id")
    await db.videos.create_index([("created_at", -1)])

    await db.comments.create_index("video_id")

    await db.likes.create_index([("user_id", 1), ("video_id", 1)], unique=True)
    await db.follows.create_index([("follower_id", 1), ("following_id", 1)], unique=True)

    await db.refresh_tokens.create_index("token_hash", unique=True)
    await db.refresh_tokens.create_index("family_id")
    # TTL index: Mongo automatically deletes expired refresh token docs, so the
    # collection doesn't grow forever with dead tokens.
    await db.refresh_tokens.create_index("expires_at", expireAfterSeconds=0)


async def connect_db() -> None:
    global _client, _connection_error
    url = os.environ.get("MONGODB_URL")
    if not url:
        _connection_error = "MONGODB_URL environment variable is not set."
        print(f"WARNING: {_connection_error}")
        return

    try:
        _client = AsyncIOMotorClient(url, serverSelectionTimeoutMS=5000)
        await _client.admin.command("ping")
        await _ensure_indexes(_client["app"])
        _connection_error = None
        print("Connected to MongoDB successfully.")
    except Exception as exc:
        _connection_error = str(exc)
        _client = None
        print(f"WARNING: MongoDB connection failed at startup: {_connection_error}")
        print("Server will start anyway. Fix MONGODB_URL and restart.")


async def close_db() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None
        print("MongoDB connection closed.")
