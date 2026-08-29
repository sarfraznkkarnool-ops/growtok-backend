"""
Seeds MongoDB with demo users and videos so the feed isn't empty on first run.

NOTE ON STORAGE: real uploads go through POST /videos or /videos/batch and are
stored as base64 (`video_base64`), per the app's design. Seed data uses
`video_url` (public sample clips) instead, purely because embedding real
video files as base64 directly in this script would make it enormous — the
API and frontend treat both fields identically, this is just a seeding
convenience.

Run with:  python seed.py   (from artifacts/fastapi-server/, with MONGODB_URL set)
"""
import asyncio
import os
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv()  # must run before importing app.* so os.environ is populated

from motor.motor_asyncio import AsyncIOMotorClient

from app.security import hash_password

SAMPLE_VIDEOS = [
    "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "https://storage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
    "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
]

SAMPLE_USERS = [
    {"email": "ava@growtok.demo", "username": "ava.codes", "display_name": "Ava"},
    {"email": "leo@growtok.demo", "username": "leo.travels", "display_name": "Leo"},
    {"email": "mia@growtok.demo", "username": "mia.cooks", "display_name": "Mia"},
]

CAPTIONS = [
    "wait for it 🌱 #growtok",
    "day 1 of posting until this blows up",
    "this took way too many takes 😂",
    "green screen fail at 0:12",
    "POV: you finally hit your goal",
]


async def main():
    mongo_url = os.environ["MONGODB_URL"]
    client = AsyncIOMotorClient(mongo_url)
    db = client["app"]

    print("Clearing existing demo collections...")
    await db.users.delete_many({})
    await db.videos.delete_many({})
    await db.comments.delete_many({})
    await db.likes.delete_many({})
    await db.follows.delete_many({})
    await db.refresh_tokens.delete_many({})

    user_ids = []
    for u in SAMPLE_USERS:
        result = await db.users.insert_one({
            "email": u["email"],
            "username": u["username"],
            "display_name": u["display_name"],
            "password_hash": hash_password("password123"),
            "bio": "Just here to grow 🌱",
            "followers_count": 0,
            "following_count": 0,
            "likes_count": 0,
        })
        user_ids.append(str(result.inserted_id))
        print(f"Created user @{u['username']} (password: password123)")

    for i, url in enumerate(SAMPLE_VIDEOS):
        owner_id = user_ids[i % len(user_ids)]
        await db.videos.insert_one({
            "owner_id": owner_id,
            "caption": CAPTIONS[i % len(CAPTIONS)],
            "sound_name": "Original sound",
            "video_url": url,
            "video_base64": None,
            "thumbnail_base64": None,
            "thumbnail_url": None,
            "likes_count": 12 + i * 7,
            "comments_count": 0,
            "shares_count": i,
            "created_at": datetime.now(timezone.utc),
        })
        print(f"Created video {i + 1}/{len(SAMPLE_VIDEOS)}")

    print("\nSeed complete. Demo login: ava@growtok.demo / password123")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
