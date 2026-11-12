"""Integration connector registry and DB-backed tool execution."""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.agent.tools.base import ToolContext
from app.core.security import decrypt
from app.integrations.base import IntegrationConnector, IntegrationError
from app.integrations.composio import ComposioConnector
from app.integrations.custom_http import CustomHttpConnector, WebhookConnector
from app.models import Integration, IntegrationCredential, Tool as ToolRow

_CONNECTORS: Dict[str, IntegrationConnector] = {
    "composio": ComposioConnector(),
    "custom_http": CustomHttpConnector(),
    "webhook": WebhookConnector(),
    "n8n": WebhookConnector(),
    "activepieces": WebhookConnector(),
}


def get_connector(key: str) -> IntegrationConnector:
    conn = _CONNECTORS.get(key)
    if conn is None:
        raise IntegrationError(f"Unknown integration type '{key}'")
    return conn


def load_credentials(db: Session, integration_id: str) -> Dict[str, str]:
    rows = db.query(IntegrationCredential).filter(
        IntegrationCredential.integration_id == integration_id).all()
    out: Dict[str, str] = {}
    for row in rows:
        try:
            out[row.key] = decrypt(row.value_enc)
        except Exception:
            out[row.key] = ""
    return out


async def execute_integration_tool(
    db: Session,
    tool_row: ToolRow,
    arguments: Dict[str, Any],
    ctx: Optional[ToolContext] = None,
) -> str:
    integration = db.get(Integration, tool_row.integration_id) if tool_row.integration_id else None
    if integration is None:
        raise IntegrationError("Integration for this tool no longer exists")
    connector = get_connector(integration.key)
    credentials = load_credentials(db, integration.id)
    return await connector.execute(integration.config or {}, credentials,
                                   tool_row.external_id or tool_row.name, arguments)


async def discover_integration_tools(db: Session, integration: Integration) -> Tuple[List[ToolRow], str]:
    connector = get_connector(integration.key)
    credentials = load_credentials(db, integration.id)
    discovered = await connector.discover_tools(integration.config or {}, credentials)
    rows: List[ToolRow] = []
    for t in discovered:
        row = (
            db.query(ToolRow)
            .filter(ToolRow.integration_id == integration.id, ToolRow.external_id == t["external_id"])
            .first()
        )
        if row is None:
            row = ToolRow(source="custom" if integration.key in ("custom_http", "webhook", "n8n", "activepieces") else integration.key,
                          integration_id=integration.id, external_id=t["external_id"], name=t["name"])
            db.add(row)
        row.display_name = t.get("display_name", row.name)
        row.description = t.get("description", "") or ""
        row.parameters_schema = t.get("parameters_schema") or {"type": "object", "properties": {}}
        row.enabled = True
        rows.append(row)
    db.commit()
    return rows, f"Discovered {len(rows)} tool(s)"
