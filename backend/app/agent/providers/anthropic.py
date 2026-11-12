"""Anthropic Messages API adapter."""
from __future__ import annotations

import json
import uuid
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx

from app.agent.providers.base import (
    ProviderAdapter, ProviderError, StreamEvent, ToolCallRequest,
)


class AnthropicAdapter(ProviderAdapter):
    provider_type = "anthropic"

    def _url(self, path: str) -> str:
        base = (self.config.base_url or "https://api.anthropic.com").rstrip("/")
        return f"{base}{path}"

    def _headers(self) -> Dict[str, str]:
        headers = super()._headers()
        headers["x-api-key"] = self.config.api_key or ""
        headers["anthropic-version"] = "2023-06-01"
        return headers

    async def list_models(self) -> List[str]:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(self._url("/v1/models"), headers=self._headers())
            resp.raise_for_status()
            data = resp.json()
            return [m.get("id", "") for m in data.get("data", []) if m.get("id")]

    async def stream_chat(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> AsyncIterator[StreamEvent]:
        system_parts: List[str] = []
        converted: List[Dict[str, Any]] = []
        for msg in messages:
            role = msg.get("role")
            if role == "system":
                system_parts.append(msg.get("content") or "")
                continue
            if role == "tool":
                converted.append({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": msg.get("tool_call_id", ""),
                        "content": msg.get("content") or "",
                    }],
                })
                continue
            content: Any = msg.get("content") or ""
            tool_calls = msg.get("tool_calls") or []
            if tool_calls:
                blocks: List[Dict[str, Any]] = []
                if content:
                    blocks.append({"type": "text", "text": content})
                for tc in tool_calls:
                    fn = tc.get("function") or {}
                    args = fn.get("arguments", {})
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except json.JSONDecodeError:
                            args = {}
                    blocks.append({
                        "type": "tool_use",
                        "id": tc.get("id", f"call_{uuid.uuid4().hex[:12]}"),
                        "name": fn.get("name", ""),
                        "input": args,
                    })
                converted.append({"role": "assistant", "content": blocks})
            else:
                converted.append({"role": role, "content": content})

        anthropic_tools = None
        if tools:
            anthropic_tools = [
                {
                    "name": t["function"]["name"],
                    "description": t["function"].get("description", ""),
                    "input_schema": t["function"].get("parameters", {"type": "object", "properties": {}}),
                }
                for t in tools
                if t.get("function")
            ]

        payload: Dict[str, Any] = {
            "model": self.config.model,
            "messages": converted,
            "max_tokens": self.config.max_output_tokens,
            "temperature": self.config.temperature,
            "top_p": self.config.top_p,
            "stream": True,
        }
        if system_parts:
            payload["system"] = "\n\n".join(system_parts)
        if anthropic_tools:
            payload["tools"] = anthropic_tools

        tool_block: Optional[Dict[str, Any]] = None
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(600, connect=15)) as client:
                async with client.stream(
                    "POST", self._url("/v1/messages"), headers=self._headers(), json=payload
                ) as resp:
                    if resp.status_code >= 400:
                        body = (await resp.aread()).decode(errors="replace")[:2000]
                        raise ProviderError(f"Anthropic returned {resp.status_code}: {body}")
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        try:
                            event = json.loads(line[5:].strip())
                        except json.JSONDecodeError:
                            continue
                        etype = event.get("type")
                        if etype == "content_block_delta":
                            delta = event.get("delta") or {}
                            if delta.get("type") == "text_delta" and delta.get("text"):
                                yield StreamEvent(type="token", text=delta["text"])
                            elif delta.get("type") == "input_json_delta":
                                if tool_block is None:
                                    tool_block = {"id": "", "name": "", "arguments": ""}
                                tool_block["arguments"] += delta.get("partial_json", "")
                        elif etype == "content_block_start":
                            block = event.get("content_block") or {}
                            if block.get("type") == "tool_use":
                                tool_block = {
                                    "id": block.get("id", f"call_{uuid.uuid4().hex[:12]}"),
                                    "name": block.get("name", ""),
                                    "arguments": "",
                                }
                        elif etype == "content_block_stop" and tool_block:
                            try:
                                args = json.loads(tool_block["arguments"] or "{}")
                            except json.JSONDecodeError:
                                args = {"_raw": tool_block["arguments"]}
                            yield StreamEvent(
                                type="tool_call",
                                tool_call=ToolCallRequest(
                                    id=tool_block["id"], name=tool_block["name"], arguments=args
                                ),
                            )
                            tool_block = None
                        elif etype == "message_delta":
                            usage = event.get("usage") or {}
                            yield StreamEvent(
                                type="usage",
                                completion_tokens=usage.get("output_tokens", 0),
                            )
        except httpx.HTTPError as exc:
            raise ProviderError(f"Anthropic request failed: {exc}") from exc
        yield StreamEvent(type="done")
