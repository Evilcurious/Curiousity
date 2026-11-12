"""Custom REST/HTTP tools, webhooks, n8n and Activepieces triggers.

A custom HTTP tool is defined by a URL, method, headers and argument mapping
(configured via the integration `config` JSON). n8n / Activepieces are
webhook-based: executing a tool POSTs the arguments to the configured
webhook URL.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Tuple

import httpx

from app.integrations.base import IntegrationConnector, IntegrationError


class CustomHttpConnector(IntegrationConnector):
    key = "custom_http"

    def _headers(self, config: Dict[str, Any], credentials: Dict[str, str]) -> Dict[str, str]:
        headers = dict(config.get("headers") or {})
        auth_type = config.get("auth_type", "none")
        if auth_type == "bearer" and credentials.get("api_key"):
            headers["Authorization"] = f"Bearer {credentials['api_key']}"
        elif auth_type == "basic" and credentials.get("username"):
            import base64
            raw = f"{credentials.get('username','')}:{credentials.get('password','')}"
            headers["Authorization"] = "Basic " + base64.b64encode(raw.encode()).decode()
        elif auth_type == "header" and credentials.get("api_key"):
            headers[config.get("auth_header_name", "X-API-Key")] = credentials["api_key"]
        return headers

    async def test_connection(self, config: Dict[str, Any], credentials: Dict[str, str]) -> Tuple[bool, str]:
        url = config.get("test_url") or config.get("base_url") or config.get("url")
        if not url:
            return False, "No test URL configured (set config.test_url or config.base_url)"
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
                resp = await client.request(config.get("method", "GET"), url,
                                            headers=self._headers(config, credentials))
                if resp.status_code < 500:
                    return True, f"Endpoint reachable (HTTP {resp.status_code})"
                return False, f"Endpoint returned HTTP {resp.status_code}"
        except Exception as exc:
            return False, f"Connection failed: {exc}"

    async def discover_tools(self, config: Dict[str, Any], credentials: Dict[str, str]) -> List[Dict[str, Any]]:
        tools = config.get("tools") or []
        result = []
        for t in tools:
            result.append({
                "external_id": t.get("name", ""),
                "name": f"http_{t.get('name','')}"[:180],
                "display_name": t.get("display_name") or t.get("name", ""),
                "description": t.get("description", ""),
                "parameters_schema": t.get("parameters") or {"type": "object", "properties": {}},
            })
        return result

    async def execute(self, config: Dict[str, Any], credentials: Dict[str, str],
                      external_id: str, arguments: Dict[str, Any]) -> str:
        tools = {t.get("name"): t for t in (config.get("tools") or [])}
        tool_cfg = tools.get(external_id, {})
        base = config.get("base_url", "").rstrip("/")
        path = tool_cfg.get("path", f"/{external_id}")
        url = tool_cfg.get("url") or (base + path if base else path)
        method = tool_cfg.get("method", config.get("method", "POST")).upper()
        headers = self._headers(config, credentials)
        try:
            async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
                if method in ("GET", "DELETE"):
                    resp = await client.request(method, url, params=arguments, headers=headers)
                else:
                    resp = await client.request(method, url, json=arguments, headers=headers)
                if resp.status_code >= 400:
                    raise IntegrationError(f"HTTP {resp.status_code}: {resp.text[:500]}")
                return resp.text[:20000] or json.dumps({"status": resp.status_code})
        except IntegrationError:
            raise
        except Exception as exc:
            raise IntegrationError(f"HTTP tool execution failed: {exc}")


class WebhookConnector(CustomHttpConnector):
    """n8n / Activepieces / generic webhook: POST the arguments to a webhook URL."""
    key = "webhook"

    async def execute(self, config: Dict[str, Any], credentials: Dict[str, str],
                      external_id: str, arguments: Dict[str, Any]) -> str:
        url = config.get("webhook_url", "")
        if not url:
            raise IntegrationError("Webhook URL not configured (config.webhook_url)")
        headers = self._headers(config, credentials)
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            resp = await client.post(url, json=arguments, headers=headers)
            if resp.status_code >= 400:
                raise IntegrationError(f"Webhook returned HTTP {resp.status_code}: {resp.text[:500]}")
            return resp.text[:20000] or json.dumps({"status": resp.status_code})

    async def discover_tools(self, config: Dict[str, Any], credentials: Dict[str, str]) -> List[Dict[str, Any]]:
        name = config.get("tool_name", "run_workflow")
        return [{
            "external_id": name,
            "name": f"webhook_{name}"[:180],
            "display_name": config.get("tool_display_name") or name,
            "description": config.get("tool_description") or "Trigger the configured workflow via webhook",
            "parameters_schema": config.get("parameters") or {
                "type": "object",
                "properties": {"payload": {"type": "object", "description": "Payload to send"}},
            },
        }]
