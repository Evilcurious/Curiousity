"""Authentication API: register, login, Google OAuth, sessions, password flows."""
from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.deps import client_ip, get_current_user
from app.core.rate_limit import rate_limit_exceeded
from app.core.security import hash_reset_token
from app.database import get_db
from app.models import PasswordResetToken, User
from app.schemas import (
    ChangePasswordRequest, ForgotPasswordRequest, GoogleAuthRequest, LoginRequest,
    RegisterRequest, ResetPasswordRequest, SessionOut, UserOut,
)
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_session_cookies(response: Response, access: str, refresh: str) -> None:
    settings = get_settings()
    response.set_cookie(
        "curiousity_access", access,
        max_age=settings.access_token_expire_minutes * 60,
        httponly=True, secure=settings.cookie_secure, samesite=settings.cookie_samesite,
    )
    response.set_cookie(
        "curiousity_refresh", refresh,
        max_age=settings.refresh_token_expire_days * 24 * 3600,
        httponly=True, secure=settings.cookie_secure, samesite=settings.cookie_samesite,
        path="/api/auth",
    )


def _clear_session_cookies(response: Response) -> None:
    response.delete_cookie("curiousity_access")
    response.delete_cookie("curiousity_refresh", path="/api/auth")


@router.post("/register", response_model=SessionOut)
def register(body: RegisterRequest, request: Request, response: Response,
             db: Session = Depends(get_db)):
    ip = client_ip(request)
    if rate_limit_exceeded(f"auth:{ip}", get_settings().rate_limit_auth_per_minute):
        raise HTTPException(status_code=429, detail="Too many attempts — try again later")
    user = auth_service.register_user(db, body.email, body.password, body.display_name, ip)
    access, refresh, _ = auth_service.create_session(
        db, user, ip, request.headers.get("User-Agent", ""))
    _set_session_cookies(response, access, refresh)
    return SessionOut(access_token=access, user=UserOut(**auth_service.user_to_dict(db, user)))


@router.post("/login", response_model=SessionOut)
def login(body: LoginRequest, request: Request, response: Response,
          db: Session = Depends(get_db)):
    ip = client_ip(request)
    if rate_limit_exceeded(f"auth:{ip}", get_settings().rate_limit_auth_per_minute):
        raise HTTPException(status_code=429, detail="Too many attempts — try again later")
    user = auth_service.login_user(db, body.email, body.password, ip)
    access, refresh, _ = auth_service.create_session(
        db, user, ip, request.headers.get("User-Agent", ""))
    _set_session_cookies(response, access, refresh)
    return SessionOut(access_token=access, user=UserOut(**auth_service.user_to_dict(db, user)))


@router.post("/google", response_model=SessionOut)
async def google_login(body: GoogleAuthRequest, request: Request, response: Response,
                       db: Session = Depends(get_db)):
    ip = client_ip(request)
    if rate_limit_exceeded(f"auth:{ip}", get_settings().rate_limit_auth_per_minute):
        raise HTTPException(status_code=429, detail="Too many attempts — try again later")
    user = await auth_service.google_authenticate(db, body.code, body.redirect_uri, ip)
    access, refresh, _ = auth_service.create_session(
        db, user, ip, request.headers.get("User-Agent", ""))
    _set_session_cookies(response, access, refresh)
    return SessionOut(access_token=access, user=UserOut(**auth_service.user_to_dict(db, user)))


@router.get("/google/url")
def google_url(request: Request):
    settings = get_settings()
    if not settings.google_client_id:
        raise HTTPException(status_code=503, detail="Google OAuth is not configured")
    state = secrets.token_urlsafe(16)
    return {"url": auth_service.google_auth_url(state), "state": state}


@router.post("/refresh", response_model=SessionOut)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get("curiousity_refresh") or ""
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    access, refresh_token, user = auth_service.rotate_refresh_token(
        db, token, client_ip(request), request.headers.get("User-Agent", ""))
    _set_session_cookies(response, access, refresh_token)
    return SessionOut(access_token=access, user=UserOut(**auth_service.user_to_dict(db, user)))


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get("curiousity_refresh") or ""
    if token:
        auth_service.revoke_session(db, token)
    _clear_session_cookies(response)
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return UserOut(**auth_service.user_to_dict(db, user))


@router.post("/forgot-password")
def forgot_password(body: ForgotPasswordRequest, request: Request,
                    db: Session = Depends(get_db)):
    ip = client_ip(request)
    if rate_limit_exceeded(f"reset:{ip}", 5):
        raise HTTPException(status_code=429, detail="Too many attempts — try again later")
    token = auth_service.request_password_reset(db, body.email, ip)
    resp = {"ok": True, "message": "If that account exists, a reset link has been sent."}
    if token is not None:
        # SMTP is not configured: return the token so the self-hosted admin flow works.
        resp["reset_token"] = token
        resp["message"] = "SMTP is not configured; use the reset_token returned here."
    return resp


@router.post("/reset-password")
def reset_password(body: ResetPasswordRequest, request: Request,
                   db: Session = Depends(get_db)):
    ip = client_ip(request)
    if rate_limit_exceeded(f"reset:{ip}", 5):
        raise HTTPException(status_code=429, detail="Too many attempts — try again later")
    auth_service.reset_password(db, body.token, body.password, ip)
    return {"ok": True}


@router.post("/change-password")
def change_password(body: ChangePasswordRequest, request: Request,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    auth_service.change_password(db, user, body.current_password, body.new_password, client_ip(request))
    return {"ok": True}
