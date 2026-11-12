"""First-run bootstrap: admin account and default AI provider/model.

The admin account is created from ADMIN_EMAIL / ADMIN_PASSWORD environment
variables exactly once. The password is never hardcoded in source.
"""
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.events import audit
from app.core.security import encrypt, hash_password
from app.models import AIModel, AIProvider, User, UserSettings

logger = logging.getLogger("curiousity.bootstrap")


def bootstrap_admin(db: Session) -> None:
    settings = get_settings()
    if not settings.admin_email or not settings.admin_password:
        logger.warning("ADMIN_EMAIL/ADMIN_PASSWORD not set — no bootstrap admin created")
        return
    email = settings.admin_email.lower().strip()
    existing = db.query(User).filter(User.email == email).first()
    if existing is None:
        admin = User(
            email=email,
            password_hash=hash_password(settings.admin_password),
            display_name="Administrator",
            role="admin",
            status="active",
        )
        db.add(admin)
        db.flush()
        db.add(UserSettings(user_id=admin.id))
        audit(db, "system.admin_bootstrapped", user_id=admin.id, resource_type="user", resource_id=admin.id)
        db.commit()
        logger.info("Bootstrap administrator account created: %s", email)
    elif existing.role != "admin":
        existing.role = "admin"
        db.commit()
        logger.info("Existing account %s promoted to administrator", email)


def bootstrap_default_provider(db: Session) -> None:
    """Create the initial Ollama provider + model from env configuration."""
    settings = get_settings()
    provider = db.query(AIProvider).filter(AIProvider.is_system.is_(True)).first()
    if provider is None:
        provider = AIProvider(
            name="Default " + settings.ai_provider_type.replace("_", " ").title(),
            provider_type=settings.ai_provider_type,
            base_url=settings.ai_base_url,
            is_system=True,
            enabled=True,
        )
        db.add(provider)
        db.flush()
        logger.info("Default AI provider created: %s @ %s", settings.ai_provider_type, settings.ai_base_url)
    else:
        # Keep the system provider in sync with env (allows moving AI to another VPS via env only).
        provider.provider_type = settings.ai_provider_type
        provider.base_url = settings.ai_base_url

    model = db.query(AIModel).filter(
        AIModel.provider_id == provider.id, AIModel.model_id == settings.ai_model).first()
    if model is None:
        model = AIModel(
            provider_id=provider.id,
            model_id=settings.ai_model,
            display_name=settings.ai_model,
            is_default=db.query(AIModel).filter(AIModel.is_default.is_(True)).count() == 0,
            enabled=True,
        )
        db.add(model)
        logger.info("Default AI model created: %s", settings.ai_model)
    db.commit()


def run_bootstrap(db: Session) -> None:
    bootstrap_admin(db)
    bootstrap_default_provider(db)
