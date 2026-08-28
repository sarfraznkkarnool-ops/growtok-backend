import os
import sys
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

load_dotenv()  # no-op if .env doesn't exist — e.g. on Replit, where Secrets
# are already in the process environment

from app.config import settings
from app.database import close_db, connect_db
from app.routers import auth, comments, health, users, videos


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db()
    yield
    await close_db()


app = FastAPI(
    title="GrowTok Backend",
    description="FastAPI backend for GrowTok, backed by MongoDB (Motor).",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def limit_request_body_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > settings.max_request_body_bytes:
        return JSONResponse(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            content={"detail": "Request body too large."},
        )
    return await call_next(request)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    return response


app.include_router(health.router)
app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(users.router, prefix="/users", tags=["users"])
app.include_router(videos.router, prefix="/videos", tags=["videos"])
app.include_router(comments.router, prefix="/videos", tags=["comments"])


if not settings.debug:
    if not settings.jwt_secret or len(settings.jwt_secret) < 32:
        print(
            "FATAL: JWT_SECRET is missing or too short (need 32+ random characters). "
            "Set it in Replit Secrets before deploying. "
            "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(48))\"",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
