"""Pydantic request/response schemas for the Curiousity API."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, EmailStr, Field


# ------------------------------------------------------------------ auth
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(default="", max_length=120)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class GoogleAuthRequest(BaseModel):
    code: str = Field(description="OAuth authorization code from Google")
    redirect_uri: Optional[str] = None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    password: str = Field(min_length=8, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class UserOut(BaseModel):
    id: str
    email: str
    display_name: str
    role: str
    status: str
    avatar_url: Optional[str] = None
    google_linked: bool = False
    created_at: datetime
    last_login_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class SessionOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ------------------------------------------------------------------ user settings
class UserSettingsOut(BaseModel):
    theme: str = "system"
    default_model_id: Optional[str] = None
    system_prompt: Optional[str] = None
    send_on_enter: bool = True
    allow_personal_api: bool = False

    model_config = {"from_attributes": True}


class UserSettingsUpdate(BaseModel):
    theme: Optional[str] = None
    default_model_id: Optional[str] = None
    system_prompt: Optional[str] = None
    send_on_enter: Optional[bool] = None


class ProfileUpdate(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=120)
    email: Optional[EmailStr] = None
    avatar_url: Optional[str] = Field(default=None, max_length=1024)


class DeleteAccountRequest(BaseModel):
    password: Optional[str] = None
    confirm: bool = False


# ------------------------------------------------------------------ chat
class ConversationOut(BaseModel):
    id: str
    title: str
    model_id: Optional[str] = None
    pinned: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ConversationUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=255)
    pinned: Optional[bool] = None
    model_id: Optional[str] = None


class AttachmentOut(BaseModel):
    id: str
    filename: str
    content_type: str
    size: int

    model_config = {"from_attributes": True}


class MessageOut(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    tool_calls: Optional[Any] = None
    tool_call_id: Optional[str] = None
    tool_name: Optional[str] = None
    attachments: Optional[Any] = None
    model_id: Optional[str] = None
    error: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatRequest(BaseModel):
    content: str = Field(default="", max_length=32000)
    attachment_ids: List[str] = Field(default_factory=list)
    model_id: Optional[str] = None


class EditMessageRequest(BaseModel):
    content: str = Field(min_length=1, max_length=32000)
    attachment_ids: List[str] = Field(default_factory=list)
    model_id: Optional[str] = None


# ------------------------------------------------------------------ providers / models
class ProviderOut(BaseModel):
    id: str
    name: str
    provider_type: str
    base_url: str
    custom_headers: Optional[Any] = None
    enabled: bool
    is_system: bool
    has_api_key: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


class ProviderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    provider_type: str = Field(pattern="^(ollama|openai_compat|anthropic|gemini)$")
    base_url: str = Field(default="", max_length=1024)
    api_key: Optional[str] = None
    custom_headers: Optional[Dict[str, str]] = None
    enabled: bool = True


class ProviderUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)
    base_url: Optional[str] = Field(default=None, max_length=1024)
    api_key: Optional[str] = None
    custom_headers: Optional[Dict[str, str]] = None
    enabled: Optional[bool] = None


class ModelOut(BaseModel):
    id: str
    provider_id: str
    model_id: str
    display_name: str
    context_length: int
    max_output_tokens: int
    temperature: float
    top_p: float
    enabled: bool
    is_default: bool
    provider_name: Optional[str] = None
    provider_type: Optional[str] = None

    model_config = {"from_attributes": True}


class ModelCreate(BaseModel):
    provider_id: str
    model_id: str = Field(min_length=1, max_length=255)
    display_name: str = Field(default="", max_length=255)
    context_length: int = Field(default=32768, ge=512, le=2_000_000)
    max_output_tokens: int = Field(default=4096, ge=64, le=200_000)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    top_p: float = Field(default=0.95, ge=0.0, le=1.0)
    enabled: bool = True


class ModelUpdate(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=255)
    context_length: Optional[int] = Field(default=None, ge=512, le=2_000_000)
    max_output_tokens: Optional[int] = Field(default=None, ge=64, le=200_000)
    temperature: Optional[float] = Field(default=None, ge=0.0, le=2.0)
    top_p: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    enabled: Optional[bool] = None
    is_default: Optional[bool] = None


class TestConnectionRequest(BaseModel):
    provider_id: Optional[str] = None
    provider_type: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    custom_headers: Optional[Dict[str, str]] = None


class TestConnectionResponse(BaseModel):
    ok: bool
    message: str
    models: List[str] = Field(default_factory=list)


# ------------------------------------------------------------------ integrations
class IntegrationOut(BaseModel):
    id: str
    key: str
    name: str
    config: Optional[Any] = None
    enabled: bool
    status: str
    has_credentials: bool = False
    created_at: datetime
    tool_count: int = 0

    model_config = {"from_attributes": True}


class IntegrationCreate(BaseModel):
    key: str = Field(pattern="^(composio|mcp|n8n|activepieces|custom_http|webhook)$")
    name: str = Field(min_length=1, max_length=160)
    config: Optional[Any] = None
    credentials: Optional[Dict[str, str]] = None   # stored encrypted, never echoed back
    enabled: bool = True


class IntegrationUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=160)
    config: Optional[Any] = None
    credentials: Optional[Dict[str, str]] = None
    enabled: Optional[bool] = None


class MCPServerOut(BaseModel):
    id: str
    name: str
    transport: str
    command: Optional[str] = None
    args: Optional[Any] = None
    url: Optional[str] = None
    status: str
    last_error: Optional[str] = None
    enabled: bool
    created_at: datetime
    tool_count: int = 0

    model_config = {"from_attributes": True}


class MCPServerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    transport: str = Field(default="stdio", pattern="^(stdio|http)$")
    command: Optional[str] = Field(default=None, max_length=512)
    args: Optional[List[str]] = None
    env: Optional[Dict[str, str]] = None
    url: Optional[str] = Field(default=None, max_length=1024)
    headers: Optional[Dict[str, str]] = None
    enabled: bool = True


class MCPServerUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=160)
    command: Optional[str] = Field(default=None, max_length=512)
    args: Optional[List[str]] = None
    env: Optional[Dict[str, str]] = None
    url: Optional[str] = Field(default=None, max_length=1024)
    headers: Optional[Dict[str, str]] = None
    enabled: Optional[bool] = None


class ToolOut(BaseModel):
    id: str
    source: str
    name: str
    display_name: str
    description: str
    parameters_schema: Optional[Any] = None
    integration_id: Optional[str] = None
    mcp_server_id: Optional[str] = None
    external_id: Optional[str] = None
    enabled: bool
    requires_approval: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ToolUpdate(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = None
    enabled: Optional[bool] = None
    requires_approval: Optional[bool] = None
    parameters_schema: Optional[Any] = None


class ToolExecutionOut(BaseModel):
    id: str
    user_id: str
    conversation_id: Optional[str] = None
    tool_name: str
    arguments: Optional[Any] = None
    result: Optional[str] = None
    status: str
    error: Optional[str] = None
    duration_ms: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ApprovalDecision(BaseModel):
    decision: str = Field(pattern="^(approve|deny)$")


# ------------------------------------------------------------------ admin
class AdminUserUpdate(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=120)
    email: Optional[EmailStr] = None
    role: Optional[str] = Field(default=None, pattern="^(user|admin)$")
    status: Optional[str] = Field(default=None, pattern="^(active|suspended)$")


class AdminUserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(default="", max_length=120)
    role: str = Field(default="user", pattern="^(user|admin)$")


class SystemSettingsOut(BaseModel):
    app_name: str
    registration_enabled: bool
    maintenance_mode: bool
    default_theme: str = "system"
    google_oauth_configured: bool
    ai_base_url: str
    ai_model: str
    smtp_configured: bool


class SystemSettingsUpdate(BaseModel):
    app_name: Optional[str] = Field(default=None, max_length=120)
    registration_enabled: Optional[bool] = None
    maintenance_mode: Optional[bool] = None
    default_theme: Optional[str] = Field(default=None, pattern="^(light|dark|system)$")
    ai_base_url: Optional[str] = Field(default=None, max_length=1024)
    ai_model: Optional[str] = Field(default=None, max_length=255)


class AuditLogOut(BaseModel):
    id: str
    user_id: Optional[str] = None
    action: str
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    details: Optional[Any] = None
    ip: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class OverviewStats(BaseModel):
    total_users: int
    active_users: int
    total_conversations: int
    total_messages: int
    ai_requests: int
    tool_executions: int
    model_usage: List[Dict[str, Any]]
    system_status: Dict[str, Any]
    recent_activity: List[AuditLogOut]
