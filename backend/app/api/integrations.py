"""Integrations marketplace API: integrations, MCP servers, tools, executions."""
from __future__ import annotations

import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.deps import client_ip, get_current_admin, get_current_user
from app.core.events import audit
from app.core.security import encrypt
from app.database import get_db
from app.integrations.mcp import discover_tools as mcp_discover, test_mcp_server
from app.integrations.registry import (
    discover_integration_tools, get_connector, load_credentials,
)
from app.models import (
    Integration, IntegrationCredential, MCPServer, Tool as ToolRow,
    ToolExecution, ToolPermission, User,
)
from app.schemas import (
    ApprovalDecision, IntegrationCreate, IntegrationOut, IntegrationUpdate,
    MCPServerCreate, MCPServerOut, MCPServerUpdate, ToolExecutionOut, ToolOut, ToolUpdate,
)

router = APIRouter(tags=["integrations"])


def _integration_out(db: Session, i: Integration) -> IntegrationOut:
    creds = db.query(IntegrationCredential).filter(IntegrationCredential.integration_id == i.id).count()
    tools = db.query(ToolRow).filter(ToolRow.integration_id == i.id).count()
    cfg = dict(i.config or {})
    return IntegrationOut(
        id=i.id, key=i.key, name=i.name, config=cfg, enabled=i.enabled, status=i.status,
        has_credentials=creds > 0, created_at=i.created_at, tool_count=tools,
    )


# ------------------------------------------------------------------ integration catalog (users can browse)
@router.get("/integrations/catalog")
def catalog():
    """Static catalog of supported integration types for the marketplace UI."""
    return {"items": [
        {"key": "composio", "name": "Composio", "description": "Connect 250+ apps (Gmail, Slack, GitHub, ...) via Composio toolkits. Requires a Composio API key.", "credentials": ["api_key"]},
        {"key": "mcp", "name": "MCP Server", "description": "Model Context Protocol servers — local (stdio) or remote (HTTP/SSE). Managed via /integrations/mcp.", "credentials": []},
        {"key": "n8n", "name": "n8n", "description": "Trigger n8n workflows through their webhook URLs.", "credentials": ["api_key"]},
        {"key": "activepieces", "name": "Activepieces", "description": "Trigger Activepieces flows via webhook.", "credentials": ["api_key"]},
        {"key": "custom_http", "name": "Custom REST API", "description": "Expose any REST endpoint as agent tools with custom auth (bearer/basic/header).", "credentials": ["api_key", "username", "password"]},
        {"key": "webhook", "name": "Webhook", "description": "POST agent tool calls to an arbitrary webhook URL.", "credentials": ["api_key"]},
    ]}


# ------------------------------------------------------------------ integrations CRUD (admin configures, users browse)
@router.get("/integrations", response_model=List[IntegrationOut])
def list_integrations(admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    return [_integration_out(db, i) for i in db.query(Integration).order_by(Integration.created_at.desc()).all()]


@router.get("/integrations/enabled", response_model=List[IntegrationOut])
def list_enabled_integrations(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [_integration_out(db, i) for i in
            db.query(Integration).filter(Integration.enabled.is_(True)).order_by(Integration.name).all()]


@router.post("/integrations", response_model=IntegrationOut)
async def create_integration(body: IntegrationCreate, request: Request,
                             admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    integration = Integration(
        key=body.key, name=body.name, config=body.config, enabled=body.enabled,
        created_by=admin.id, status="configured",
    )
    db.add(integration)
    db.flush()
    for k, v in (body.credentials or {}).items():
        db.add(IntegrationCredential(integration_id=integration.id, key=k, value_enc=encrypt(v)))
    audit(db, "admin.integration_created", user_id=admin.id, resource_type="integration",
          details={"key": body.key, "name": body.name}, ip=client_ip(request))
    db.commit()
    db.refresh(integration)
    return _integration_out(db, integration)


@router.patch("/integrations/{integration_id}", response_model=IntegrationOut)
def update_integration(integration_id: str, body: IntegrationUpdate, request: Request,
                       admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    integration = db.get(Integration, integration_id)
    if integration is None:
        raise HTTPException(status_code=404, detail="Integration not found")
    if body.name is not None:
        integration.name = body.name
    if body.config is not None:
        integration.config = body.config
    if body.enabled is not None:
        integration.enabled = body.enabled
    for k, v in (body.credentials or {}).items():
        row = db.query(IntegrationCredential).filter(
            IntegrationCredential.integration_id == integration.id,
            IntegrationCredential.key == k).first()
        if row:
            row.value_enc = encrypt(v)
        else:
            db.add(IntegrationCredential(integration_id=integration.id, key=k, value_enc=encrypt(v)))
    audit(db, "admin.integration_updated", user_id=admin.id, resource_type="integration",
          resource_id=integration_id, ip=client_ip(request))
    db.commit()
    db.refresh(integration)
    return _integration_out(db, integration)


@router.delete("/integrations/{integration_id}")
def delete_integration(integration_id: str, request: Request,
                       admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    integration = db.get(Integration, integration_id)
    if integration is None:
        raise HTTPException(status_code=404, detail="Integration not found")
    db.delete(integration)
    audit(db, "admin.integration_deleted", user_id=admin.id, resource_type="integration",
          resource_id=integration_id, ip=client_ip(request))
    db.commit()
    return {"ok": True}


@router.post("/integrations/{integration_id}/test")
async def test_integration(integration_id: str, admin: User = Depends(get_current_admin),
                           db: Session = Depends(get_db)):
    integration = db.get(Integration, integration_id)
    if integration is None:
        raise HTTPException(status_code=404, detail="Integration not found")
    connector = get_connector(integration.key)
    ok, message = await connector.test_connection(integration.config or {}, load_credentials(db, integration.id))
    integration.status = "connected" if ok else "error"
    db.commit()
    return {"ok": ok, "message": message}


@router.post("/integrations/{integration_id}/discover")
async def discover_tools(integration_id: str, request: Request,
                         admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    integration = db.get(Integration, integration_id)
    if integration is None:
        raise HTTPException(status_code=404, detail="Integration not found")
    rows, message = await discover_integration_tools(db, integration)
    audit(db, "admin.tools_discovered", user_id=admin.id, resource_type="integration",
          resource_id=integration_id, details={"count": len(rows)}, ip=client_ip(request))
    db.commit()
    return {"ok": True, "message": message, "tools": [ToolOut.model_validate(r).model_dump() for r in rows]}


# ------------------------------------------------------------------ MCP servers
def _mcp_out(db: Session, s: MCPServer) -> MCPServerOut:
    tools = db.query(ToolRow).filter(ToolRow.mcp_server_id == s.id).count()
    return MCPServerOut(
        id=s.id, name=s.name, transport=s.transport, command=s.command, args=s.args,
        url=s.url, status=s.status, last_error=s.last_error, enabled=s.enabled,
        created_at=s.created_at, tool_count=tools,
    )


@router.get("/integrations/mcp", response_model=List[MCPServerOut])
def list_mcp_servers(admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    return [_mcp_out(db, s) for s in db.query(MCPServer).order_by(MCPServer.created_at.desc()).all()]


@router.post("/integrations/mcp", response_model=MCPServerOut)
def create_mcp_server(body: MCPServerCreate, request: Request,
                      admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    server = MCPServer(
        name=body.name, transport=body.transport,
        command=body.command, args=body.args,
        env_enc=encrypt(json.dumps(body.env)) if body.env else None,
        url=body.url,
        headers_enc=encrypt(json.dumps(body.headers)) if body.headers else None,
        enabled=body.enabled, created_by=admin.id,
    )
    db.add(server)
    audit(db, "admin.mcp_created", user_id=admin.id, resource_type="mcp_server",
          details={"name": body.name}, ip=client_ip(request))
    db.commit()
    db.refresh(server)
    return _mcp_out(db, server)


@router.patch("/integrations/mcp/{server_id}", response_model=MCPServerOut)
def update_mcp_server(server_id: str, body: MCPServerUpdate, request: Request,
                      admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    server = db.get(MCPServer, server_id)
    if server is None:
        raise HTTPException(status_code=404, detail="MCP server not found")
    if body.name is not None:
        server.name = body.name
    if body.command is not None:
        server.command = body.command
    if body.args is not None:
        server.args = body.args
    if body.env is not None:
        server.env_enc = encrypt(json.dumps(body.env))
    if body.url is not None:
        server.url = body.url
    if body.headers is not None:
        server.headers_enc = encrypt(json.dumps(body.headers))
    if body.enabled is not None:
        server.enabled = body.enabled
    audit(db, "admin.mcp_updated", user_id=admin.id, resource_type="mcp_server",
          resource_id=server_id, ip=client_ip(request))
    db.commit()
    db.refresh(server)
    return _mcp_out(db, server)


@router.delete("/integrations/mcp/{server_id}")
def delete_mcp_server(server_id: str, request: Request,
                      admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    server = db.get(MCPServer, server_id)
    if server is None:
        raise HTTPException(status_code=404, detail="MCP server not found")
    db.delete(server)
    audit(db, "admin.mcp_deleted", user_id=admin.id, resource_type="mcp_server",
          resource_id=server_id, ip=client_ip(request))
    db.commit()
    return {"ok": True}


@router.post("/integrations/mcp/{server_id}/test")
async def test_mcp(server_id: str, admin: User = Depends(get_current_admin),
                   db: Session = Depends(get_db)):
    server = db.get(MCPServer, server_id)
    if server is None:
        raise HTTPException(status_code=404, detail="MCP server not found")
    ok, message = await test_mcp_server(server)
    server.status = "connected" if ok else "error"
    server.last_error = None if ok else message
    db.commit()
    return {"ok": ok, "message": message}


@router.post("/integrations/mcp/{server_id}/discover")
async def discover_mcp_tools(server_id: str, request: Request,
                             admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    server = db.get(MCPServer, server_id)
    if server is None:
        raise HTTPException(status_code=404, detail="MCP server not found")
    try:
        rows, message = await mcp_discover(db, server)
    except Exception as exc:
        server.status = "error"
        server.last_error = str(exc)
        db.commit()
        raise HTTPException(status_code=502, detail=str(exc))
    server.status = "connected"
    server.last_error = None
    audit(db, "admin.mcp_tools_discovered", user_id=admin.id, resource_type="mcp_server",
          resource_id=server_id, details={"count": len(rows)}, ip=client_ip(request))
    db.commit()
    return {"ok": True, "message": message, "tools": [ToolOut.model_validate(r).model_dump() for r in rows]}


# ------------------------------------------------------------------ tools
@router.get("/tools", response_model=List[ToolOut])
def list_tools(source: Optional[str] = None, admin: User = Depends(get_current_admin),
               db: Session = Depends(get_db)):
    q = db.query(ToolRow)
    if source:
        q = q.filter(ToolRow.source == source)
    return [ToolOut.model_validate(t) for t in q.order_by(ToolRow.source, ToolRow.name).all()]


@router.patch("/tools/{tool_id}", response_model=ToolOut)
def update_tool(tool_id: str, body: ToolUpdate, request: Request,
                admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    tool = db.get(ToolRow, tool_id)
    if tool is None:
        raise HTTPException(status_code=404, detail="Tool not found")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(tool, key, value)
    audit(db, "admin.tool_updated", user_id=admin.id, resource_type="tool",
          resource_id=tool_id, ip=client_ip(request))
    db.commit()
    db.refresh(tool)
    return ToolOut.model_validate(tool)


@router.delete("/tools/{tool_id}")
def delete_tool(tool_id: str, request: Request,
                admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    tool = db.get(ToolRow, tool_id)
    if tool is None:
        raise HTTPException(status_code=404, detail="Tool not found")
    db.delete(tool)
    audit(db, "admin.tool_deleted", user_id=admin.id, resource_type="tool",
          resource_id=tool_id, ip=client_ip(request))
    db.commit()
    return {"ok": True}


@router.put("/tools/{tool_id}/permissions/{user_id}")
def set_tool_permission(tool_id: str, user_id: str, body: ApprovalDecision,
                        admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """Reuse ApprovalDecision {decision}: sets allowed = (decision == 'approve')."""
    tool = db.get(ToolRow, tool_id)
    if tool is None:
        raise HTTPException(status_code=404, detail="Tool not found")
    allowed = body.decision == "approve"
    perm = db.query(ToolPermission).filter(
        ToolPermission.tool_id == tool_id, ToolPermission.user_id == user_id).first()
    if perm is None:
        db.add(ToolPermission(tool_id=tool_id, user_id=user_id, allowed=allowed))
    else:
        perm.allowed = allowed
    db.commit()
    return {"ok": True, "allowed": allowed}


# ------------------------------------------------------------------ execution history
@router.get("/tool-executions", response_model=List[ToolExecutionOut])
def list_executions(limit: int = 50, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    q = db.query(ToolExecution)
    if user.role != "admin":
        q = q.filter(ToolExecution.user_id == user.id)
    return [ToolExecutionOut.model_validate(e) for e in
            q.order_by(ToolExecution.created_at.desc()).limit(min(limit, 200)).all()]
