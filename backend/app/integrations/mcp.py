"""MCP (Model Context Protocol) client.

Implements JSON-RPC 2.0 against MCP servers over:
  - stdio: launch a local server process (`command` + `args` + `env`)
  - http:  remote Streamable HTTP / SSE endpoint (`url` + `headers`)

Supported MCP methods: initialize, tools/list, tools/call.
Tool definitions discovered from a server are persisted into the `tools`
table so the agent engine can call them uniformly.
"""
from __future__ import annotations

import asyncio
import json
import os
import uuid
from typing import Any, Dict, List, Optional, Tuple

import httpx
from sqlalchemy.orm import Session

from app.core.security import decrypt, encrypt
from app.models import MCPServer, Tool as ToolRow

PROTOCOL_VERSION = "2024-11-05"
CLIENT_INFO = {"name": "curiousity", "version": "1.0.0"}


class MCPError(Exception):
    pass


# ----------------------------------------------------------------- stdio transport
class StdioMCPClient:
    def __init__(self, command: str, args: List[str], env: Dict[str, str]):
        self.command = command
        self.args = args or []
        self.env = env or {}
        self._proc: Optional[asyncio.subprocess.Process] = None
        self._id = 0

    async def __aenter__(self) -> "StdioMCPClient":
        full_env = {**os.environ, **self.env}
        self._proc = await asyncio.create_subprocess_exec(
            self.command, *self.args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=full_env,
        )
        return self

    async def __aexit__(self, *exc) -> None:
        if self._proc:
            try:
                self._proc.terminate()
                await asyncio.wait_for(self._proc.wait(), timeout=5)
            except Exception:
                self._proc.kill()

    async def request(self, method: str, params: Optional[Dict[str, Any]] = None,
                      timeout: float = 30) -> Any:
        if not self._proc or not self._proc.stdin or not self._proc.stdout:
            raise MCPError("MCP process not started")
        self._id += 1
        msg = {"jsonrpc": "2.0", "id": self._id, "method": method}
        if params is not None:
            msg["params"] = params
        self._proc.stdin.write((json.dumps(msg) + "\n").encode())
        await self._proc.stdin.drain()
        while True:
            line = await asyncio.wait_for(self._proc.stdout.readline(), timeout=timeout)
            if not line:
                stderr = b""
                if self._proc.stderr:
                    stderr = await asyncio.wait_for(self._proc.stderr.read(4096), timeout=2)
                raise MCPError(f"MCP server exited unexpectedly: {stderr.decode(errors='replace')[:500]}")
            try:
                resp = json.loads(line)
            except json.JSONDecodeError:
                continue
            if resp.get("id") == self._id:
                if "error" in resp:
                    raise MCPError(f"MCP error: {resp['error']}")
                return resp.get("result")

    async def notify(self, method: str, params: Optional[Dict[str, Any]] = None) -> None:
        if not self._proc or not self._proc.stdin:
            return
        msg: Dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        self._proc.stdin.write((json.dumps(msg) + "\n").encode())
        await self._proc.stdin.drain()


# ----------------------------------------------------------------- http transport
class HttpMCPClient:
    def __init__(self, url: str, headers: Optional[Dict[str, str]] = None):
        self.url = url
        self.headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
        self.headers.update(headers or {})
        self._id = 0
        self._session_id: Optional[str] = None

    async def __aenter__(self) -> "HttpMCPClient":
        self._client = httpx.AsyncClient(timeout=60)
        return self

    async def __aexit__(self, *exc) -> None:
        await self._client.aclose()

    async def request(self, method: str, params: Optional[Dict[str, Any]] = None,
                      timeout: float = 30) -> Any:
        self._id += 1
        msg = {"jsonrpc": "2.0", "id": self._id, "method": method}
        if params is not None:
            msg["params"] = params
        headers = dict(self.headers)
        if self._session_id:
            headers["Mcp-Session-Id"] = self._session_id
        resp = await self._client.post(self.url, json=msg, headers=headers, timeout=timeout)
        if resp.status_code >= 400:
            raise MCPError(f"MCP HTTP {resp.status_code}: {resp.text[:500]}")
        sid = resp.headers.get("Mcp-Session-Id") or resp.headers.get("mcp-session-id")
        if sid:
            self._session_id = sid
        content_type = resp.headers.get("content-type", "")
        if "text/event-stream" in content_type:
            # Parse SSE stream for the JSON-RPC response with our id.
            for line in resp.text.splitlines():
                if line.startswith("data:"):
                    try:
                        event = json.loads(line[5:].strip())
                    except json.JSONDecodeError:
                        continue
                    if event.get("id") == self._id:
                        if "error" in event:
                            raise MCPError(f"MCP error: {event['error']}")
                        return event.get("result")
            raise MCPError("MCP stream ended without a response")
        data = resp.json()
        if "error" in data:
            raise MCPError(f"MCP error: {data['error']}")
        return data.get("result")

    async def notify(self, method: str, params: Optional[Dict[str, Any]] = None) -> None:
        msg: Dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        headers = dict(self.headers)
        if self._session_id:
            headers["Mcp-Session-Id"] = self._session_id
        try:
            await self._client.post(self.url, json=msg, headers=headers)
        except Exception:
            pass


# ----------------------------------------------------------------- helpers
def _decrypt_json(blob: Optional[str]) -> Dict[str, str]:
    if not blob:
        return {}
    try:
        return json.loads(decrypt(blob))
    except Exception:
        return {}


async def _connect(server: MCPServer):
    """Return a connected, initialized MCP client for the given server row."""
    if server.transport == "stdio":
        if not server.command:
            raise MCPError("MCP stdio server has no command configured")
        client = StdioMCPClient(server.command, server.args or [], _decrypt_json(server.env_enc))
    else:
        if not server.url:
            raise MCPError("MCP remote server has no URL configured")
        client = HttpMCPClient(server.url, _decrypt_json(server.headers_enc))
    await client.__aenter__()
    try:
        result = await client.request("initialize", {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "clientInfo": CLIENT_INFO,
        })
        await client.notify("notifications/initialized")
        return client
    except Exception:
        await client.__aexit__(None, None, None)
        raise


async def discover_tools(db: Session, server: MCPServer) -> Tuple[List[ToolRow], str]:
    """Connect to an MCP server, list its tools, and sync them into the DB."""
    client = await _connect(server)
    try:
        result = await client.request("tools/list")
        tools = (result or {}).get("tools", [])
    finally:
        await client.__aexit__(None, None, None)

    seen: List[ToolRow] = []
    for t in tools:
        name = f"mcp_{server.name}_{t.get('name', '')}".replace(" ", "_").lower()[:180]
        row = (
            db.query(ToolRow)
            .filter(ToolRow.source == "mcp", ToolRow.mcp_server_id == server.id,
                    ToolRow.external_id == t.get("name", ""))
            .first()
        )
        if row is None:
            row = ToolRow(source="mcp", mcp_server_id=server.id, external_id=t.get("name", ""), name=name)
            db.add(row)
        row.display_name = t.get("name", name)
        row.description = t.get("description", "") or ""
        row.parameters_schema = t.get("inputSchema") or {"type": "object", "properties": {}}
        row.enabled = True
        seen.append(row)
    db.commit()
    return seen, f"Discovered {len(seen)} tool(s)"


async def execute_mcp_tool(db: Session, tool_row: ToolRow, arguments: Dict[str, Any]) -> str:
    server = db.get(MCPServer, tool_row.mcp_server_id) if tool_row.mcp_server_id else None
    if not server:
        raise MCPError("MCP server for this tool no longer exists")
    client = await _connect(server)
    try:
        result = await client.request("tools/call", {
            "name": tool_row.external_id or tool_row.name,
            "arguments": arguments,
        })
    finally:
        await client.__aexit__(None, None, None)
    if isinstance(result, dict):
        content = result.get("content", [])
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(item.get("text", ""))
            else:
                parts.append(json.dumps(item, default=str))
        if result.get("isError"):
            raise MCPError("\n".join(parts) or "MCP tool error")
        return "\n".join(parts) or json.dumps(result, default=str)
    return json.dumps(result, default=str)


async def test_mcp_server(server: MCPServer) -> Tuple[bool, str]:
    try:
        client = await _connect(server)
        try:
            result = await client.request("tools/list")
            n = len((result or {}).get("tools", []))
            return True, f"Connected — {n} tool(s) available"
        finally:
            await client.__aexit__(None, None, None)
    except Exception as exc:
        return False, f"MCP connection failed: {exc}"
