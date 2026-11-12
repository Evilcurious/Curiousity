"""Ollama adapter — local or remote Ollama server (/api/chat streaming).

Uses the Ollama native API. Supports OpenAI-style tool calling when the
underlying model supports it, and a text-based JSON tool-call protocol as a
fallback for models that emit tool calls as plain JSON.
"""
from __future__ import annotations

import json
import re
import uuid
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx

from app.agent.providers.base import (
    ProviderAdapter, ProviderError, StreamEvent, ToolCallRequest,
)

# Matches a model-emitted tool call like:  {"tool": "name", "arguments": {...}}
_TOOL_JSON_RE = re.compile(r"\{[\s\S]*?\"(tool|function|name)\"[\s\S]*?\}")


class OllamaAdapter(ProviderAdapter):
    provider_type = "ollama"

    def _url(self, path: str) -> str:
        base = (self.config.base_url or "http://127.0.0.1:11434").rstrip("/")
        return f"{base}{path}"

    def _headers(self) -> Dict[str, str]:
        headers = super()._headers()
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        return headers

    async def list_models(self) -> List[str]:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(self._url("/api/tags"), headers=self._headers())
            resp.raise_for_status()
            data = resp.json()
            return [m.get("name", "") for m in data.get("models", []) if m.get("name")]

    async def stream_chat(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> AsyncIterator[StreamEvent]:
        payload: Dict[str, Any] = {
            "model": self.config.model,
            "messages": messages,
            "stream": True,
            "options": {
                "temperature": self.config.temperature,
                "top_p": self.config.top_p,
                "num_predict": self.config.max_output_tokens,
            },
        }
        if tools:
            payload["tools"] = tools

        text_parts: List[str] = []
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(600, connect=15)) as client:
                async with client.stream(
                    "POST", self._url("/api/chat"), headers=self._headers(), json=payload
                ) as resp:
                    if resp.status_code >= 400:
                        body = (await resp.aread()).decode(errors="replace")[:2000]
                        raise ProviderError(f"Ollama returned {resp.status_code}: {body}")
                    async for line in resp.aiter_lines():
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            chunk = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        msg = chunk.get("message") or {}
                        if msg.get("content"):
                            text_parts.append(msg["content"])
                            yield StreamEvent(type="token", text=msg["content"])
                        for tc in msg.get("tool_calls") or []:
                            fn = tc.get("function") or {}
                            if not fn.get("name"):
                                continue
                            raw_args = fn.get("arguments", {})
                            if isinstance(raw_args, str):
                                try:
                                    raw_args = json.loads(raw_args)
                                except json.JSONDecodeError:
                                    raw_args = {"_raw": raw_args}
                            yield StreamEvent(
                                type="tool_call",
                                tool_call=ToolCallRequest(
                                    id=f"call_{uuid.uuid4().hex[:12]}",
                                    name=fn["name"],
                                    arguments=raw_args or {},
                                ),
                            )
                        if chunk.get("prompt_eval_count") or chunk.get("eval_count"):
                            yield StreamEvent(
                                type="usage",
                                prompt_tokens=chunk.get("prompt_eval_count", 0),
                                completion_tokens=chunk.get("eval_count", 0),
                            )
        except httpx.HTTPError as exc:
            raise ProviderError(f"Ollama request failed: {exc}") from exc

        # Fallback: parse text-emitted tool calls when no native tool_calls arrived.
        full_text = "".join(text_parts)
        parsed = self._parse_text_tool_call(full_text)
        if parsed and tools:
            yield StreamEvent(type="tool_call", tool_call=parsed)
        yield StreamEvent(type="done")

    @staticmethod
    def _parse_text_tool_call(text: str) -> Optional[ToolCallRequest]:
        """Detect a JSON tool call the model wrote as text.

        Accepts: {"tool": "x", "arguments": {...}} / {"name": "x", "arguments": {...}}
        / {"function": "x", "arguments": {...}} possibly inside a code fence.
        """
        if not text or '"arguments"' not in text and '"parameters"' not in text:
            return None
        candidates = re.findall(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", text)
        candidates += _TOOL_JSON_RE.findall(text) and re.findall(r"\{[\s\S]*?\}", text) or []
        for cand in candidates:
            try:
                obj = json.loads(cand)
            except json.JSONDecodeError:
                continue
            if not isinstance(obj, dict):
                continue
            name = obj.get("tool") or obj.get("name") or obj.get("function")
            args = obj.get("arguments") or obj.get("parameters") or {}
            if isinstance(name, str) and name and isinstance(args, dict):
                return ToolCallRequest(
                    id=f"call_{uuid.uuid4().hex[:12]}", name=name, arguments=args
                )
        return None
