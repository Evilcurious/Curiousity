"""Health-check endpoints for Docker/Nginx/monitoring."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db

router = APIRouter(tags=["health"])


@router.get("/health")
def health(db: Session = Depends(get_db)):
    status = {"status": "ok", "app": get_settings().app_name, "checks": {}}
    code = 200
    try:
        db.execute(text("SELECT 1"))
        status["checks"]["database"] = "ok"
    except Exception as exc:
        status["checks"]["database"] = f"error: {exc}"
        status["status"] = "degraded"
        code = 503
    try:
        import redis as redis_lib
        r = redis_lib.Redis.from_url(get_settings().redis_url, socket_connect_timeout=1)
        r.ping()
        status["checks"]["redis"] = "ok"
    except Exception:
        status["checks"]["redis"] = "unavailable (rate limiting falls back to memory)"
    return Response(
        content=__import__("json").dumps(status),
        media_type="application/json",
        status_code=code,
    )


@router.get("/health/ready")
def ready(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        return {"ready": True}
    except Exception:
        return Response(content='{"ready": false}', media_type="application/json", status_code=503)
