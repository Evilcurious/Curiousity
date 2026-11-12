"""Composio connector — real REST integration.

Requires a Composio API key (stored encrypted as integration credential
`api_key`). Implements tool discovery (GET /api/v3/tools), app listing and
tool execution (POST /api/v3/tools/{slug}/execute) against the Composio
backend. See docs/ENVIRONMENT.md for configuration instructions.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Tuple

import httpx

from app.integrations.base import IntegrationConnector, IntegrationError

COMPOSIO_BASE = "https://backend.composio.dev/api/v3"


class ComposioConnector(IntegrationConnector):
    key = "composio"

    def _headers(self, credentials: Dict[str, str]) -> Dict[str, str]:
        api_key = credentials.get("api_key", "")
        if not api_key:
            raise IntegrationError("Composio API key not configured — add credential 'api_key'")
        return {"x-api-key": api_key, "Content-Type": "application/json"}

    async def test_connection(self, config: Dict[str, Any], credentials: Dict[str, str]) -> Tuple[bool, str]:
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.get(f"{COMPOSIO_BASE}/tools", headers=self._headers(credentials),
                                        params={"limit": 1})
                if resp.status_code == 401:
                    return False, "Invalid Composio API key"
                resp.raise_for_status()
                return True, "Connected to Composio"
        except IntegrationError as exc:
            return False, str(exc)
        except Exception as exc:
            return False, f"Composio connection failed: {exc}"

    async def discover_tools(self, config: Dict[str, Any], credentials: Dict[str, str]) -> List[Dict[str, Any]]:
        """List tools, optionally filtered to one app via config['app_names']."""
        params: Dict[str, Any] = {"limit": int(config.get("tool_limit", 50))}
        app_names = config.get("app_names")
        if app_names:
            params["appNames"] = ",".join(app_names) if isinstance(app_names, list) else app_names
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(f"{COMPOSIO_BASE}/tools", headers=self._headers(credentials), params=params)
            resp.raise_for_status()
            data = resp.json()
        items = data.get("items", data if isinstance(data, list) else [])
        tools: List[Dict[str, Any]] = []
        for item in items:
            slug = item.get("slug") or item.get("name", "")
            if not slug:
                continue
            tools.append({
                "external_id": slug,
                "name": f"composio_{slug}"[:180],
                "display_name": item.get("displayName") or slug,
                "description": (item.get("description") or "")[:2000],
                "parameters_schema": item.get("inputParameters") or item.get("parameters")
                    or {"type": "object", "properties": {}},
            })
        return tools

    async def execute(self, config: Dict[str, Any], credentials: Dict[str, str],
                      external_id: str, arguments: Dict[str, Any]) -> str:
        payload = {"arguments": arguments}
        if config.get("connected_account_id"):
            payload["connectedAccountId"] = config["connected_account_id"]
        if config.get("user_id"):
            payload["userIds"] = [config["user_id"]]
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{COMPOSIO_BASE}/tools/{external_id}/execute",
                headers=self._headers(credentials),
                json=payload,
            )
            if resp.status_code >= 400:
                raise IntegrationError(f"Composio execution failed ({resp.status_code}): {resp.text[:500]}")
            return json.dumps(resp.json(), default=str)[:20000]
