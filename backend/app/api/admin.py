"""Admin panel API: overview stats, user management, system settings, logs."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.deps import client_ip, get_current_admin
from app.core.events import audit
from app.core.security import hash_password
from app.database import get_db
from app.models import (
    AuditLog, Conversation, Message, ToolExecution, User, UserSettings,
)
from app.schemas import (
    AdminUserCreate, AdminUserUpdate, AuditLogOut, OverviewStats,
    SystemSettingsOut, SystemSettingsUpdate, UserOut,
)
from app.services.auth_service import user_to_dict

router = APIRouter(prefix="/admin", tags=["admin"])

from app.services import system_settings  # noqa: E402


@router.get("/overview", response_model=OverviewStats)
def overview(admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(days=30)
    total_users = db.query(func.count(User.id)).scalar() or 0
    active_users = db.query(func.count(User.id)).filter(User.status == "active").scalar() or 0
    total_convs = db.query(func.count(Conversation.id)).scalar() or 0
    total_msgs = db.query(func.count(Message.id)).scalar() or 0
    ai_requests = db.query(func.count(Message.id)).filter(Message.role == "assistant").scalar() or 0
    tool_execs = db.query(func.count(ToolExecution.id)).scalar() or 0

    usage_rows = (
        db.query(Message.model_id, func.count(Message.id))
        .filter(Message.role == "assistant", Message.model_id.isnot(None))
        .group_by(Message.model_id)
        .order_by(func.count(Message.id).desc())
        .limit(10)
        .all()
    )
    model_usage = [{"model_id": m, "count": c} for m, c in usage_rows]

    from app.models import AIModel
    model_names = {m.id: (m.display_name or m.model_id) for m in db.query(AIModel).all()}
    for row in model_usage:
        row["model_name"] = model_names.get(row["model_id"], row["model_id"])

    recent = (
        db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(15).all()
    )
    return OverviewStats(
        total_users=total_users,
        active_users=active_users,
        total_conversations=total_convs,
        total_messages=total_msgs,
        ai_requests=ai_requests,
        tool_executions=tool_execs,
        model_usage=model_usage,
        system_status={
            "database": "ok",
            "registration_enabled": system_settings.registration_allowed(),
            "maintenance_mode": system_settings.is_maintenance_mode(),
            "environment": get_settings().environment,
        },
        recent_activity=[AuditLogOut.model_validate(a) for a in recent],
    )


# ------------------------------------------------------------------ users
@router.get("/users")
def list_users(search: str = "", status: Optional[str] = None, limit: int = 50, offset: int = 0,
               admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    q = db.query(User)
    if search:
        like = f"%{search}%"
        q = q.filter((User.email.ilike(like)) | (User.display_name.ilike(like)))
    if status:
        q = q.filter(User.status == status)
    total = q.count()
    users = q.order_by(User.created_at.desc()).offset(offset).limit(min(limit, 200)).all()
    return {
        "total": total,
        "items": [user_to_dict(db, u) for u in users],
    }


@router.post("/users")
def create_user(body: AdminUserCreate, request: Request,
                admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == body.email.lower()).first():
        raise HTTPException(status_code=409, detail="Email already exists")
    user = User(
        email=body.email.lower(), password_hash=hash_password(body.password),
        display_name=body.display_name or body.email.split("@")[0], role=body.role,
    )
    db.add(user)
    db.flush()
    db.add(UserSettings(user_id=user.id))
    audit(db, "admin.user_created", user_id=admin.id, resource_type="user",
          resource_id=user.id, ip=client_ip(request))
    db.commit()
    return user_to_dict(db, user)


@router.patch("/users/{user_id}")
def update_user(user_id: str, body: AdminUserUpdate, request: Request,
                admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if body.role == "user" and user.id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot demote your own account")
    if body.status == "suspended" and user.id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot suspend your own account")
    if body.email is not None:
        existing = db.query(User).filter(User.email == body.email.lower(), User.id != user_id).first()
        if existing:
            raise HTTPException(status_code=409, detail="Email already in use")
        user.email = body.email.lower()
    if body.display_name is not None:
        user.display_name = body.display_name
    if body.role is not None:
        user.role = body.role
    if body.status is not None:
        user.status = body.status
    audit(db, "admin.user_updated", user_id=admin.id, resource_type="user",
          resource_id=user_id, details=body.model_dump(exclude_unset=True), ip=client_ip(request))
    db.commit()
    return user_to_dict(db, user)


@router.delete("/users/{user_id}")
def delete_user(user_id: str, request: Request,
                admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    audit(db, "admin.user_deleted", user_id=admin.id, resource_type="user",
          resource_id=user_id, ip=client_ip(request))
    db.commit()
    db.delete(user)
    db.commit()
    return {"ok": True}


@router.post("/users/{user_id}/reset-password")
def admin_reset_password(user_id: str, request: Request,
                         admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    import secrets
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    temp_password = secrets.token_urlsafe(12)
    user.password_hash = hash_password(temp_password)
    audit(db, "admin.user_password_reset", user_id=admin.id, resource_type="user",
          resource_id=user_id, ip=client_ip(request))
    db.commit()
    return {"ok": True, "temporary_password": temp_password}


# ------------------------------------------------------------------ system settings
@router.get("/settings", response_model=SystemSettingsOut)
def get_system_settings(admin: User = Depends(get_current_admin)):
    s = get_settings()
    return SystemSettingsOut(
        app_name=system_settings.get_override("app_name", s.app_name),
        registration_enabled=system_settings.get_override("registration_enabled", s.registration_enabled),
        maintenance_mode=system_settings.get_override("maintenance_mode", s.maintenance_mode),
        default_theme=system_settings.get_override("default_theme", "system"),
        google_oauth_configured=bool(s.google_client_id and s.google_client_secret),
        ai_base_url=s.ai_base_url,
        ai_model=s.ai_model,
        smtp_configured=bool(s.smtp_host),
    )


@router.patch("/settings", response_model=SystemSettingsOut)
def update_system_settings(body: SystemSettingsUpdate, request: Request,
                           admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    system_settings.set_overrides(body.model_dump(exclude_unset=True))
    audit(db, "admin.settings_updated", user_id=admin.id, resource_type="system",
          details=body.model_dump(exclude_unset=True), ip=client_ip(request))
    db.commit()
    return get_system_settings(admin)


# ------------------------------------------------------------------ logs
@router.get("/logs")
def list_logs(action: Optional[str] = None, user_id: Optional[str] = None,
              limit: int = 100, offset: int = 0,
              admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    q = db.query(AuditLog)
    if action:
        q = q.filter(AuditLog.action.ilike(f"{action}%"))
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)
    total = q.count()
    rows = q.order_by(AuditLog.created_at.desc()).offset(offset).limit(min(limit, 500)).all()
    return {"total": total, "items": [AuditLogOut.model_validate(r) for r in rows]}


@router.get("/logs/logins")
def login_history(limit: int = 100, admin: User = Depends(get_current_admin),
                  db: Session = Depends(get_db)):
    rows = (
        db.query(AuditLog)
        .filter(AuditLog.action.in_(["auth.login", "auth.login_failed", "auth.google_login"]))
        .order_by(AuditLog.created_at.desc())
        .limit(min(limit, 500))
        .all()
    )
    return {"items": [AuditLogOut.model_validate(r) for r in rows]}


def is_maintenance_mode() -> bool:
    return bool(system_settings.is_maintenance_mode())


def registration_allowed() -> bool:
    return system_settings.registration_allowed()
