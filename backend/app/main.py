"""Curiousity backend — FastAPI application entrypoint."""
from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api import admin as admin_api
from app.api import auth as auth_api
from app.api import chat as chat_api
from app.api import health as health_api
from app.api import integrations as integrations_api
from app.api import providers as providers_api
from app.api import user as user_api
from app.config import get_settings
from app.core.rate_limit import rate_limit_exceeded
from app.database import Base, engine, session_scope
from app.services import system_settings
from app.services.bootstrap import run_bootstrap

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("curiousity")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info("Starting %s (%s)", settings.app_name, settings.environment)
    try:
        Base.metadata.create_all(bind=engine)  # safety net; alembic manages versioned schema
        with session_scope() as db:
            run_bootstrap(db)
    except Exception:
        logger.exception("Bootstrap failed — check DATABASE_URL and credentials")
    yield
    logger.info("Shutting down")


app = FastAPI(
    title="Curiousity API",
    version="1.0.0",
    description="Self-hosted AI agent platform — chat, agents, integrations, admin.",
    lifespan=lifespan,
)

app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.middleware("http")
async def security_and_limits(request: Request, call_next):
    settings = get_settings()
    start = time.monotonic()

    # Global API rate limit (per IP).
    if request.url.path.startswith(settings.api_prefix) and request.method != "OPTIONS":
        ip = request.headers.get("X-Forwarded-For", "").split(",")[0].strip() \
            or (request.client.host if request.client else "unknown")
        if rate_limit_exceeded(f"api:{ip}", settings.rate_limit_api_per_minute):
            return Response('{"detail":"Too many requests"}', status_code=429,
                            media_type="application/json")

    # Maintenance mode: block everything except health + admin auth.
    if system_settings.is_maintenance_mode() and request.url.path.startswith(settings.api_prefix):
        if not (request.url.path.startswith(f"{settings.api_prefix}/health")
                or request.url.path.startswith(f"{settings.api_prefix}/auth")
                or request.url.path.startswith(f"{settings.api_prefix}/admin")):
            return Response('{"detail":"Maintenance in progress"}', status_code=503,
                            media_type="application/json")

    response = await call_next(request)

    # Secure HTTP headers
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data: https:; "
        "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://accounts.google.com; "
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    )
    if settings.cookie_secure:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["X-Response-Time-Ms"] = str(int((time.monotonic() - start) * 1000))
    return response


# ------------------------------------------------------------------ routers
prefix = get_settings().api_prefix
app.include_router(health_api.router, prefix=prefix)
app.include_router(auth_api.router, prefix=prefix)
app.include_router(user_api.router, prefix=prefix)
app.include_router(chat_api.router, prefix=prefix)
app.include_router(providers_api.router, prefix=prefix)
app.include_router(integrations_api.router, prefix=prefix)
app.include_router(admin_api.router, prefix=prefix)


@app.get("/")
def root():
    return {
        "name": "Curiousity",
        "docs": "/docs",
        "health": f"{prefix}/health",
    }
