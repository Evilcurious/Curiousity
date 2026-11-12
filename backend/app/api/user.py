"""User settings & profile API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.deps import client_ip, get_current_user
from app.core.events import audit
from app.core.security import hash_password, verify_password
from app.database import get_db
from app.models import User, UserSettings
from app.schemas import (
    DeleteAccountRequest, ProfileUpdate, UserOut, UserSettingsOut, UserSettingsUpdate,
)

router = APIRouter(prefix="/user", tags=["user"])


@router.get("/settings", response_model=UserSettingsOut)
def get_settings_row(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(UserSettings, user.id)
    if row is None:
        row = UserSettings(user_id=user.id)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


@router.patch("/settings", response_model=UserSettingsOut)
def update_settings(body: UserSettingsUpdate, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    row = db.get(UserSettings, user.id) or UserSettings(user_id=user.id)
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/profile", response_model=UserOut)
def update_profile(body: ProfileUpdate, request: Request,
                   user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.email and body.email.lower() != user.email:
        existing = db.query(User).filter(User.email == body.email.lower()).first()
        if existing:
            raise HTTPException(status_code=409, detail="Email already in use")
        user.email = body.email.lower()
    if body.display_name is not None:
        user.display_name = body.display_name
    if body.avatar_url is not None:
        user.avatar_url = body.avatar_url
    audit(db, "user.profile_updated", user_id=user.id, ip=client_ip(request))
    db.commit()
    from app.services.auth_service import user_to_dict
    return UserOut(**user_to_dict(db, user))


@router.delete("/account")
def delete_account(body: DeleteAccountRequest, request: Request,
                   user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.password_hash and not body.confirm:
        raise HTTPException(status_code=400, detail="Set confirm=true to delete your account")
    if user.password_hash and body.password:
        if not verify_password(user.password_hash, body.password):
            raise HTTPException(status_code=400, detail="Password is incorrect")
    audit(db, "user.account_deleted", user_id=user.id, ip=client_ip(request))
    db.commit()
    db.delete(user)
    db.commit()
    return {"ok": True}
