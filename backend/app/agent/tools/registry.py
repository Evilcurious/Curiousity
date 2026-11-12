"""Tool registry — resolves, filters and executes tools from every source.

Sources: built-in tools, MCP servers, Composio integrations, custom HTTP tools.
Per-tool enable/disable flags and per-user permissions are enforced here on
the server side (never trust the frontend).
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.agent.tools.base import BaseTool, ToolContext, ToolError, ToolSpec
from app.agent.tools.builtin import BUILTIN_TOOLS
from app.models import Tool as ToolRow, ToolExecution, ToolPermission


class ToolRegistry:
    """Caches resolved tools per request; executes with logging and permissions."""

    def __init__(self, db: Session, user_id: str):
        self.db = db
        self.user_id = user_id
        self._builtin: Dict[str, BaseTool] = {t.spec.name: t for t in BUILTIN_TOOLS}
        self._specs: Dict[str, ToolSpec] = {}
        self._rows: Dict[str, ToolRow] = {}
        self._load()

    # ------------------------------------------------------------------ loading
    def _load(self) -> None:
        for tool in BUILTIN_TOOLS:
            self._specs[tool.spec.name] = tool.spec
        rows = (
            self.db.query(ToolRow)
            .filter(ToolRow.enabled.is_(True), ToolRow.source != "builtin")
            .all()
        )
        for row in rows:
            if not self._allowed(row.id):
                continue
            name = row.name
            self._rows[name] = row
            self._specs[name] = ToolSpec(
                name=name,
                description=row.description or "",
                parameters=row.parameters_schema or {"type": "object", "properties": {}},
                source=row.source,
                tool_id=row.id,
                requires_approval=bool(row.requires_approval),
            )

    def _allowed(self, tool_id: str) -> bool:
        perm = (
            self.db.query(ToolPermission)
            .filter(ToolPermission.tool_id == tool_id, ToolPermission.user_id == self.user_id)
            .first()
        )
        return True if perm is None else bool(perm.allowed)

    # ------------------------------------------------------------------ introspection
    def specs(self) -> List[ToolSpec]:
        return list(self._specs.values())

    def openai_tools(self) -> List[Dict[str, Any]]:
        return [s.to_openai_schema() for s in self._specs.values()]

    def get(self, name: str) -> Optional[ToolSpec]:
        return self._specs.get(name)

    # ------------------------------------------------------------------ execution
    async def execute(
        self,
        name: str,
        arguments: Dict[str, Any],
        ctx: ToolContext,
        message_id: Optional[str] = None,
        approved: bool = False,
    ) -> ToolExecution:
        spec = self._specs.get(name)
        record = ToolExecution(
            user_id=self.user_id,
            conversation_id=ctx.conversation_id,
            message_id=message_id,
            tool_id=spec.tool_id if spec else None,
            tool_name=name,
            arguments=arguments,
            status="running",
        )
        self.db.add(record)
        self.db.commit()
        self.db.refresh(record)

        if spec is None:
            return self._finish(record, status="error", error=f"Unknown tool '{name}'")
        if spec.requires_approval and not approved:
            return self._finish(record, status="pending_approval",
                                error="This tool requires human approval before execution")

        started = time.monotonic()
        try:
            if name in self._builtin:
                result = await self._builtin[name].execute(arguments, ctx)
            else:
                result = await self._execute_external(spec, arguments, ctx)
            record.duration_ms = int((time.monotonic() - started) * 1000)
            return self._finish(record, status="success", result=result[:20000])
        except ToolError as exc:
            record.duration_ms = int((time.monotonic() - started) * 1000)
            return self._finish(record, status="error", error=str(exc))
        except Exception as exc:  # noqa: BLE001 — tool failures must not crash the agent
            record.duration_ms = int((time.monotonic() - started) * 1000)
            return self._finish(record, status="error", error=f"Tool execution failed: {exc}")

    def _finish(self, record: ToolExecution, status: str,
                result: Optional[str] = None, error: Optional[str] = None) -> ToolExecution:
        record.status = status
        record.result = result
        record.error = error
        record.finished_at = datetime.now(timezone.utc)
        self.db.commit()
        self.db.refresh(record)
        return record

    async def _execute_external(self, spec: ToolSpec, arguments: Dict[str, Any], ctx: ToolContext) -> str:
        row = self._rows.get(spec.name)
        if row is None:
            raise ToolError(f"Tool '{spec.name}' is not configured")
        if row.source == "mcp":
            from app.integrations.mcp import execute_mcp_tool
            return await execute_mcp_tool(self.db, row, arguments)
        if row.source in ("composio", "custom"):
            from app.integrations.registry import execute_integration_tool
            return await execute_integration_tool(self.db, row, arguments, ctx)
        raise ToolError(f"Unsupported tool source '{row.source}'")


def log_tool_result_note(db: Session, execution: ToolExecution) -> str:
    """Render a tool execution as a message for the model."""
    if execution.status == "success":
        return execution.result or "(no output)"
    if execution.status == "pending_approval":
        return json.dumps({"status": "pending_approval", "message": execution.error})
    return json.dumps({"status": execution.status, "error": execution.error})
