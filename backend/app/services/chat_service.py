"""Chat service: conversations, messages, attachments, model resolution."""
from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import (
    AIModel, Attachment, Conversation, Message, User, UserSettings,
)


def _owned_conversation(db: Session, user: User, conversation_id: str) -> Conversation:
    conv = db.get(Conversation, conversation_id)
    if conv is None or conv.user_id != user.id:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


def list_conversations(db: Session, user: User, search: str = "") -> List[Conversation]:
    q = db.query(Conversation).filter(Conversation.user_id == user.id)
    if search:
        like = f"%{search}%"
        matching = (
            db.query(Message.conversation_id)
            .filter(Message.user_id == user.id, Message.content.ilike(like))
            .subquery()
        )
        q = q.filter(
            (Conversation.title.ilike(like)) | (Conversation.id.in_(matching))
        )
    return q.order_by(Conversation.pinned.desc(), Conversation.updated_at.desc()).all()


def create_conversation(db: Session, user: User, title: str = "New chat",
                        model_id: Optional[str] = None) -> Conversation:
    if not model_id:
        settings_row = db.get(UserSettings, user.id)
        if settings_row and settings_row.default_model_id:
            model_id = settings_row.default_model_id
        else:
            default_model = db.query(AIModel).filter(
                AIModel.is_default.is_(True), AIModel.enabled.is_(True)).first()
            model_id = default_model.id if default_model else None
    conv = Conversation(user_id=user.id, title=title[:255], model_id=model_id)
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv


def resolve_model(db: Session, user: User, model_id: Optional[str]) -> AIModel:
    if model_id:
        model = db.get(AIModel, model_id)
        if model is None or not model.enabled or not model.provider.enabled:
            raise HTTPException(status_code=400, detail="Selected model is not available")
        # user-level permission
        from app.models import UserModelPermission
        perm = db.query(UserModelPermission).filter(
            UserModelPermission.user_id == user.id,
            UserModelPermission.model_id == model.id,
        ).first()
        if perm is not None and not perm.allowed:
            raise HTTPException(status_code=403, detail="You do not have access to this model")
        return model
    settings_row = db.get(UserSettings, user.id)
    if settings_row and settings_row.default_model_id:
        model = db.get(AIModel, settings_row.default_model_id)
        if model and model.enabled:
            return model
    model = db.query(AIModel).filter(
        AIModel.is_default.is_(True), AIModel.enabled.is_(True)).first()
    if model is None:
        model = db.query(AIModel).filter(AIModel.enabled.is_(True)).first()
    if model is None:
        raise HTTPException(status_code=503, detail="No AI model is configured — ask an administrator")
    return model


def auto_title(db: Session, conv: Conversation, first_message: str) -> None:
    if conv.title in ("", "New chat") and first_message.strip():
        conv.title = first_message.strip().splitlines()[0][:60]
        db.commit()


# ------------------------------------------------------------------ attachments
TEXT_PREVIEW_LIMIT = 4000


async def save_attachment(db: Session, user: User, file: UploadFile,
                          conversation_id: Optional[str]) -> Attachment:
    settings = get_settings()
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_mb}MB limit")
    filename = os.path.basename(file.filename or "upload.bin")[:255]
    att_id = uuid.uuid4().hex
    os.makedirs(settings.upload_dir, exist_ok=True)
    path = os.path.join(settings.upload_dir, f"{att_id}_{filename}")
    with open(path, "wb") as fh:
        fh.write(data)
    att = Attachment(
        id=att_id,
        user_id=user.id,
        conversation_id=conversation_id,
        filename=filename,
        content_type=file.content_type or "application/octet-stream",
        size=len(data),
        storage_path=path,
    )
    db.add(att)
    db.commit()
    db.refresh(att)
    return att


def attachment_payload(att: Attachment, with_preview: bool = True) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "id": att.id,
        "filename": att.filename,
        "content_type": att.content_type,
        "size": att.size,
    }
    if with_preview and (att.content_type.startswith("text/")
                         or att.filename.endswith((".txt", ".md", ".py", ".js", ".ts", ".json",
                                                   ".csv", ".yml", ".yaml", ".html", ".css", ".sh"))):
        try:
            with open(att.storage_path, "r", errors="replace") as fh:
                payload["preview"] = fh.read(TEXT_PREVIEW_LIMIT)
        except Exception:
            pass
    return payload


def delete_conversation(db: Session, user: User, conversation_id: str) -> None:
    conv = _owned_conversation(db, user, conversation_id)
    db.delete(conv)
    db.commit()


def get_messages(db: Session, user: User, conversation_id: str) -> List[Message]:
    _owned_conversation(db, user, conversation_id)
    return (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.created_at)
        .all()
    )
