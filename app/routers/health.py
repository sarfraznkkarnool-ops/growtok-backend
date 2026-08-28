from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.database import get_connection_error

router = APIRouter(tags=["health"])


class HealthStatus(BaseModel):
    status: str
    version: str
    db: str
    db_error: Optional[str] = None


@router.get("/healthz", response_model=HealthStatus, summary="Health check")
async def health_check() -> HealthStatus:
    """Returns the API health status and MongoDB connection state."""
    err = get_connection_error()
    return HealthStatus(
        status="ok",
        version="1.0.0",
        db="disconnected" if err else "connected",
        db_error=err,
    )
