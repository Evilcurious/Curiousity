"""Chat API: conversations, messages, streaming generation, attachments."""
from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.agent.engine import (
    AgentEngine, register_generation, stop_generation,
)
from app.core.deps import client_ip, get_current_user
from app.core.events import audit
from app.database import get_db
from app.models import Conversation, Message, User
from app.schemas import (
    AttachmentOut, ChatRequest, ConversationOut, ConversationUpdate,
    EditMessageRequest, MessageOut,
)
from app.services import chat_service

router = APIRouter(tags=["chat"])


# ------------------------------------------------------------------ conversations
@router.get("/conversations", response_model=List[ConversationOut])
def list_conversations(search: str = "", user: User = Depends(get_current_user),
                       db: Session = Depends(get_db)):
    return chat_service.list_conversations(db, user, search)


@router.post("/conversations", response_model=ConversationOut)
def create_conversation(body: ConversationUpdate | None = None,
                        user: User = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    body = body or ConversationUpdate()
    return chat_service.create_conversation(db, user, body.title or "New chat", body.model_id)


@router.get("/conversations/{conversation_id}", response_model=ConversationOut)
def get_conversation(conversation_id: str, user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    conv = db.get(Conversation, conversation_id)
    if conv is None or conv.user_id != user.id:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


@router.patch("/conversations/{conversation_id}", response_model=ConversationOut)
def update_conversation(conversation_id: str, body: ConversationUpdate,
                        user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    conv = db.get(Conversation, conversation_id)
    if conv is None or conv.user_id != user.id:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if body.title is not None:
        conv.title = body.title[:255]
    if body.pinned is not None:
        conv.pinned = body.pinned
    if body.model_id is not None:
        conv.model_id = body.model_id
    db.commit()
    db.refresh(conv)
    return conv


@router.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: str, request: Request,
                        user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    chat_service.delete_conversation(db, user, conversation_id)
    audit(db, "chat.conversation_deleted", user_id=user.id, resource_id=conversation_id,
          ip=client_ip(request))
    db.commit()
    return {"ok": True}


@router.get("/conversations/{conversation_id}/messages", response_model=List[MessageOut])
def list_messages(conversation_id: str, user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    return chat_service.get_messages(db, user, conversation_id)


# ------------------------------------------------------------------ attachments
@router.post("/attachments", response_model=AttachmentOut)
async def upload_attachment(file: UploadFile = File(...),
                            conversation_id: Optional[str] = Form(None),
                            user: User = Depends(get_current_user),
                            db: Session = Depends(get_db)):
    if conversation_id:
        conv = db.get(Conversation, conversation_id)
        if conv is None or conv.user_id != user.id:
            raise HTTPException(status_code=404, detail="Conversation not found")
    return await chat_service.save_attachment(db, user, file, conversation_id)


# ------------------------------------------------------------------ generation
async def _sse_stream(events: AsyncIterator[dict]) -> AsyncIterator[str]:
    async for event in events:
        yield f"data: {json.dumps(event, default=str)}\n\n"


async def _run_generation(db: Session, user: User, conv: Conversation, model,
                          user_message: Message) -> AsyncIterator[dict]:
    handle = register_generation(conv.id, user.id)
    engine = AgentEngine(db, user, conv, model, handle)
    try:
        async for event in engine.run(user_message.id):
            yield event
    except asyncio.CancelledError:
        yield {"type": "done", "reason": "stopped"}
        raise
    except Exception as exc:  # noqa: BLE001
        yield {"type": "error", "message": f"Generation failed: {exc}"}


@router.post("/conversations/{conversation_id}/messages")
async def send_message(conversation_id: str, body: ChatRequest,
                       request: Request,
                       user: User = Depends(get_current_user),
                       db: Session = Depends(get_db)):
    conv = db.get(Conversation, conversation_id)
    if conv is None or conv.user_id != user.id:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if not body.content.strip() and not body.attachment_ids:
        raise HTTPException(status_code=400, detail="Message content is empty")

    model = chat_service.resolve_model(db, user, body.model_id or conv.model_id)
    conv.model_id = model.id

    attachments = []
    for att_id in body.attachment_ids:
        from app.models import Attachment
        att = db.get(Attachment, att_id)
        if att and att.user_id == user.id:
            attachments.append(chat_service.attachment_payload(att))
            att.message_id = None  # set below

    user_msg = Message(
        conversation_id=conv.id, user_id=user.id, role="user",
        content=body.content, attachments=attachments or None,
    )
    db.add(user_msg)
    db.commit()
    db.refresh(user_msg)
    for att in attachments:
        from app.models import Attachment
        row = db.get(Attachment, att["id"])
        if row:
            row.message_id = user_msg.id
    db.commit()

    chat_service.auto_title(db, conv, body.content)
    audit(db, "chat.message_sent", user_id=user.id, resource_id=conv.id, ip=client_ip(request))
    db.commit()

    async def events() -> AsyncIterator[dict]:
        yield {"type": "message_start", "user_message_id": user_msg.id}
        async for event in _run_generation(db, user, conv, model, user_msg):
            yield event

    return StreamingResponse(_sse_stream(events()), media_type="text/event-stream")


@router.post("/conversations/{conversation_id}/messages/{message_id}/regenerate")
async def regenerate(conversation_id: str, message_id: str,
                     user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    conv = db.get(Conversation, conversation_id)
    if conv is None or conv.user_id != user.id:
        raise HTTPException(status_code=404, detail="Conversation not found")
    user_msg = db.get(Message, message_id)
    if user_msg is None or user_msg.conversation_id != conv.id or user_msg.role != "user":
        raise HTTPException(status_code=404, detail="Message not found")

    # Remove prior assistant replies that follow this user message.
    followups = (
        db.query(Message)
        .filter(Message.conversation_id == conv.id, Message.created_at > user_msg.created_at)
        .all()
    )
    for m in followups:
        db.delete(m)
    db.commit()

    model = chat_service.resolve_model(db, user, conv.model_id)

    async def events() -> AsyncIterator[dict]:
        yield {"type": "message_start", "user_message_id": user_msg.id}
        async for event in _run_generation(db, user, conv, model, user_msg):
            yield event

    return StreamingResponse(_sse_stream(events()), media_type="text/event-stream")


@router.patch("/conversations/{conversation_id}/messages/{message_id}")
async def edit_message(conversation_id: str, message_id: str, body: EditMessageRequest,
                       user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    conv = db.get(Conversation, conversation_id)
    if conv is None or conv.user_id != user.id:
        raise HTTPException(status_code=404, detail="Conversation not found")
    user_msg = db.get(Message, message_id)
    if user_msg is None or user_msg.conversation_id != conv.id or user_msg.role != "user":
        raise HTTPException(status_code=404, detail="Message not found")

    user_msg.content = body.content
    followups = (
        db.query(Message)
        .filter(Message.conversation_id == conv.id, Message.created_at > user_msg.created_at)
        .all()
    )
    for m in followups:
        db.delete(m)
    db.commit()

    model = chat_service.resolve_model(db, user, body.model_id or conv.model_id)

    async def events() -> AsyncIterator[dict]:
        yield {"type": "message_start", "user_message_id": user_msg.id}
        async for event in _run_generation(db, user, conv, model, user_msg):
            yield event

    return StreamingResponse(_sse_stream(events()), media_type="text/event-stream")


@router.post("/conversations/{conversation_id}/stop")
def stop(conversation_id: str, user: User = Depends(get_current_user)):
    stopped = stop_generation(conversation_id, user.id)
    return {"ok": True, "stopped": stopped}


@router.post("/tool-executions/{execution_id}/approval")
async def decide_approval(execution_id: str, request: Request,
                          user: User = Depends(get_current_user),
                          db: Session = Depends(get_db)):
    """Human approval for a sensitive tool call: {decision: approve|deny}."""
    from app.models import ToolExecution
    body = await request.json()
    decision = body.get("decision", "deny")
    execution = db.get(ToolExecution, execution_id)
    if execution is None or execution.user_id != user.id:
        raise HTTPException(status_code=404, detail="Execution not found")
    if execution.status != "pending_approval":
        raise HTTPException(status_code=400, detail="Execution is not awaiting approval")
    execution.status = "approved" if decision == "approve" else "denied"
    db.commit()
    audit(db, "tool.approval", user_id=user.id, resource_id=execution_id,
          details={"decision": decision}, ip=client_ip(request))
    db.commit()
    return {"ok": True, "status": execution.status}
