"""Authentication flows: register, login, Google OAuth, password reset, sessions."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

import httpx
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.events import audit
from app.core.security import (
    create_access_token, generate_refresh_token, generate_reset_token,
    hash_password, hash_refresh_token, hash_reset_token, needs_rehash,
    verify_password, encrypt, decrypt,
)
from app.models import (
    Account, PasswordResetToken, Session as SessionRow, User, UserSettings,
)


def _aware(dt: datetime) -> datetime:
    """Normalize DB datetimes to UTC-aware (SQLite returns naive datetimes)."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


def _new_user(db: Session, email: str, password: Optional[str], display_name: str,
              role: str = "user", google_sub: Optional[str] = None,
              avatar_url: Optional[str] = None) -> User:
    user = User(
        email=email.lower().strip(),
        password_hash=hash_password(password) if password else None,
        display_name=display_name or email.split("@")[0],
        role=role,
        google_sub=google_sub,
        avatar_url=avatar_url,
        last_login_at=datetime.now(timezone.utc),
    )
    db.add(user)
    db.flush()
    db.add(UserSettings(user_id=user.id))
    return user


def create_session(db: Session, user: User, ip: str, user_agent: str) -> Tuple[str, str, SessionRow]:
    """Create a persistent session; returns (access_token, refresh_token, row)."""
    settings = get_settings()
    refresh = generate_refresh_token()
    row = SessionRow(
        user_id=user.id,
        refresh_token_hash=hash_refresh_token(refresh),
        user_agent=(user_agent or "")[:512],
        ip=ip,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days),
    )
    db.add(row)
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    access = create_access_token(user.id, user.role)
    return access, refresh, row


def revoke_session(db: Session, refresh_token: str) -> None:
    row = db.query(SessionRow).filter(
        SessionRow.refresh_token_hash == hash_refresh_token(refresh_token),
        SessionRow.revoked_at.is_(None),
    ).first()
    if row:
        row.revoked_at = datetime.now(timezone.utc)
        db.commit()


def rotate_refresh_token(db: Session, refresh_token: str, ip: str, user_agent: str) -> Tuple[str, str, User]:
    row = db.query(SessionRow).filter(
        SessionRow.refresh_token_hash == hash_refresh_token(refresh_token),
    ).first()
    if row is None or row.revoked_at is not None or _aware(row.expires_at) < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    user = db.get(User, row.user_id)
    if not user or user.status == "suspended":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account unavailable")
    # rotate: revoke old, issue new
    row.revoked_at = datetime.now(timezone.utc)
    access, refresh, _ = create_session(db, user, ip, user_agent)
    return access, refresh, user


# ------------------------------------------------------------------ registration / login
def register_user(db: Session, email: str, password: str, display_name: str, ip: str) -> User:
    from app.services.system_settings import registration_allowed
    if not registration_allowed():
        raise HTTPException(status_code=403, detail="Registration is disabled")
    if db.query(User).filter(User.email == email.lower().strip()).first():
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user = _new_user(db, email, password, display_name)
    db.commit()
    audit(db, "auth.register", user_id=user.id, ip=ip)
    db.commit()
    return user


def login_user(db: Session, email: str, password: str, ip: str) -> User:
    user = db.query(User).filter(User.email == email.lower().strip()).first()
    if not user or not user.password_hash or not verify_password(user.password_hash, password):
        audit(db, "auth.login_failed", details={"email": email}, ip=ip)
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if user.status == "suspended":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account suspended")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    audit(db, "auth.login", user_id=user.id, ip=ip)
    db.commit()
    return user


# ------------------------------------------------------------------ Google OAuth
async def google_authenticate(db: Session, code: str, redirect_uri: Optional[str], ip: str) -> User:
    settings = get_settings()
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(status_code=503, detail="Google OAuth is not configured on this server")
    data = {
        "code": code,
        "client_id": settings.google_client_id,
        "client_secret": settings.google_client_secret,
        "redirect_uri": redirect_uri or settings.google_redirect_uri,
        "grant_type": "authorization_code",
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            token_resp = await client.post(GOOGLE_TOKEN_URL, data=data)
            if token_resp.status_code != 200:
                raise HTTPException(status_code=401, detail=f"Google token exchange failed: {token_resp.text[:200]}")
            tokens = token_resp.json()
            info_resp = await client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {tokens.get('access_token', '')}"},
            )
            info_resp.raise_for_status()
            info = info_resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach Google: {exc}")

    sub = info.get("sub")
    email = (info.get("email") or "").lower()
    if not sub or not email:
        raise HTTPException(status_code=401, detail="Google account info incomplete")

    user = db.query(User).filter((User.google_sub == sub) | (User.email == email)).first()
    if user is None:
        user = _new_user(
            db, email, password=None,
            display_name=info.get("name") or email.split("@")[0],
            google_sub=sub, avatar_url=info.get("picture"),
        )
    else:
        user.google_sub = user.google_sub or sub
        user.avatar_url = user.avatar_url or info.get("picture")
    if user.status == "suspended":
        raise HTTPException(status_code=403, detail="Account suspended")

    account = db.query(Account).filter(Account.provider == "google", Account.provider_account_id == sub).first()
    if account is None:
        account = Account(user_id=user.id, provider="google", provider_account_id=sub)
        db.add(account)
    if tokens.get("access_token"):
        account.access_token_enc = encrypt(tokens["access_token"])
    if tokens.get("refresh_token"):
        account.refresh_token_enc = encrypt(tokens["refresh_token"])
    if tokens.get("expires_in"):
        account.expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(tokens["expires_in"]))

    audit(db, "auth.google_login", user_id=user.id, ip=ip)
    db.commit()
    return user


def google_auth_url(state: str) -> str:
    settings = get_settings()
    from urllib.parse import urlencode
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "select_account",
        "state": state,
    }
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)


# ------------------------------------------------------------------ password management
def change_password(db: Session, user: User, current_password: str, new_password: str, ip: str) -> None:
    if not user.password_hash or not verify_password(user.password_hash, current_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.password_hash = hash_password(new_password)
    # revoke all other sessions
    for row in db.query(SessionRow).filter(SessionRow.user_id == user.id, SessionRow.revoked_at.is_(None)):
        row.revoked_at = datetime.now(timezone.utc)
    audit(db, "auth.password_changed", user_id=user.id, ip=ip)
    db.commit()


def request_password_reset(db: Session, email: str, ip: str) -> Optional[str]:
    """Create a reset token. Returns the raw token when SMTP is not configured
    (self-hosted convenience — documented in docs/ENVIRONMENT.md)."""
    user = db.query(User).filter(User.email == email.lower().strip()).first()
    if user is None:
        return None  # do not reveal whether the account exists
    token = generate_reset_token()
    db.add(PasswordResetToken(
        user_id=user.id,
        token_hash=hash_reset_token(token),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=get_settings().password_reset_expire_minutes),
    ))
    audit(db, "auth.password_reset_requested", user_id=user.id, ip=ip)
    db.commit()

    settings = get_settings()
    if settings.smtp_host:
        _send_reset_email(email, token)
        return None
    return token


def _send_reset_email(email: str, token: str) -> None:
    import smtplib
    from email.message import EmailMessage
    settings = get_settings()
    msg = EmailMessage()
    msg["Subject"] = f"{settings.app_name} password reset"
    msg["From"] = settings.smtp_from
    msg["To"] = email
    reset_link = f"{settings.public_api_url.replace('/api','')}/reset-password?token={token}"
    msg.set_content(f"Use this link to reset your password (valid for {settings.password_reset_expire_minutes} minutes):\n{reset_link}\n\nToken: {token}")
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            if settings.smtp_tls:
                smtp.starttls()
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
    except Exception:
        pass  # token remains valid; user can request again


def reset_password(db: Session, token: str, new_password: str, ip: str) -> None:
    row = db.query(PasswordResetToken).filter(
        PasswordResetToken.token_hash == hash_reset_token(token)).first()
    if row is None or row.used_at is not None or _aware(row.expires_at) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    user = db.get(User, row.user_id)
    if user is None:
        raise HTTPException(status_code=400, detail="Invalid reset token")
    user.password_hash = hash_password(new_password)
    row.used_at = datetime.now(timezone.utc)
    for s in db.query(SessionRow).filter(SessionRow.user_id == user.id, SessionRow.revoked_at.is_(None)):
        s.revoked_at = datetime.now(timezone.utc)
    audit(db, "auth.password_reset_completed", user_id=user.id, ip=ip)
    db.commit()


def user_to_dict(db: Session, user: User) -> Dict[str, Any]:
    linked = db.query(Account).filter(Account.user_id == user.id, Account.provider == "google").first()
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "role": user.role,
        "status": user.status,
        "avatar_url": user.avatar_url,
        "google_linked": linked is not None,
        "created_at": user.created_at,
        "last_login_at": user.last_login_at,
    }
