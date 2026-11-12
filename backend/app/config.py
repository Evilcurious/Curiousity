"""Application configuration loaded from environment variables."""
from __future__ import annotations

import secrets
from functools import lru_cache
from typing import List, Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Application ---
    app_name: str = "Curiousity"
    environment: str = "production"
    debug: bool = False
    api_prefix: str = "/api"
    public_api_url: str = "http://localhost:8000"
    cors_origins: List[str] = ["http://localhost:3000"]

    # --- Security ---
    secret_key: str = secrets.token_urlsafe(48)
    encryption_key: str = ""  # Fernet key; derived from secret_key when empty
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 30
    password_reset_expire_minutes: int = 60
    cookie_secure: bool = False
    cookie_samesite: str = "lax"
    bcrypt_cost: int = 12

    # --- Database / cache ---
    database_url: str = "postgresql+psycopg2://curiousity:curiousity@localhost:5432/curiousity"
    redis_url: str = "redis://localhost:6379/0"

    # --- Admin bootstrap (first run) ---
    admin_email: str = ""
    admin_password: str = ""

    # --- Google OAuth ---
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:3000/auth/google/callback"

    # --- AI defaults (bootstrap provider) ---
    ai_base_url: str = "http://127.0.0.1:11434"
    ai_model: str = "curiousity-glm"
    ai_provider_type: str = "ollama"
    agent_max_steps: int = 8
    agent_context_budget_chars: int = 24000

    # --- Storage ---
    upload_dir: str = "/data/uploads"
    max_upload_mb: int = 25

    # --- Email (SMTP) for password reset; optional ---
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "curiousity@localhost"
    smtp_tls: bool = True

    # --- Rate limiting ---
    rate_limit_enabled: bool = True
    rate_limit_auth_per_minute: int = 10
    rate_limit_api_per_minute: int = 120

    # --- Registration controls ---
    registration_enabled: bool = True
    maintenance_mode: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
