"""OpenAI-compatible chat completions adapter.

Works with OpenAI, OpenRouter, DeepSeek, Groq, Together AI, vLLM, LM Studio,
text-generation-webui, and any service exposing the OpenAI chat completions
API. Also used for Google Gemini through its OpenAI-compatible endpoint.
"""
from __future__ import annotations

import json
import uuid
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx

from app.agent.providers.base import (
    ProviderAdapter, ProviderError, StreamEvent, ToolCallRequest,
)


class OpenAICompatAdapter(ProviderAdapter):
    provider_type = "openai_compat"

    def _url(self, path: str) -> str:
        base = (self.config.base_url or "https://api.openai.com/v1").rstrip("/")
        if not base.endswith("/v1") and "generativelanguage" not in base:
            base = base + "/v1"
        return f"{base}{path}"

    async def list_models(self) -> List[str]:
        headers = self._headers()
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(self._url("/models"), headers=headers)
            resp.raise_for_status()
            data = resp.json()
            items = data.get("data", data if isinstance(data, list) else [])
            return [m.get("id", "") for m in items if m.get("id")]

    async def stream_chat(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> AsyncIterator[StreamEvent]:
        headers = self._headers()
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"

        payload: Dict[str, Any] = {
            "model": self.config.model,
            "messages": messages,
            "stream": True,
            **self.sampling_params(),
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        acc_tool_calls: Dict[int, Dict[str, Any]] = {}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(600, connect=15)) as client:
                async with client.stream(
                    "POST", self._url("/chat/completions"), headers=headers, json=payload
                ) as resp:
                    if resp.status_code >= 400:
                        body = (await resp.aread()).decode(errors="replace")[:2000]
                        raise ProviderError(f"{self.config.base_url} returned {resp.status_code}: {body}")
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        choices = chunk.get("choices") or []
                        if not choices:
                            if chunk.get("usage"):
                                yield StreamEvent(
                                    type="usage",
                                    prompt_tokens=chunk["usage"].get("prompt_tokens", 0),
                                    completion_tokens=chunk["usage"].get("completion_tokens", 0),
                                )
                            continue
                        delta = choices[0].get("delta") or {}
                        if delta.get("content"):
                            yield StreamEvent(type="token", text=delta["content"])
                        for tc in delta.get("tool_calls") or []:
                            idx = tc.get("index", 0)
                            slot = acc_tool_calls.setdefault(
                                idx, {"id": "", "name": "", "arguments": ""}
                            )
                            if tc.get("id"):
                                slot["id"] = tc["id"]
                            fn = tc.get("function") or {}
                            if fn.get("name"):
                                slot["name"] = fn["name"]
                            if fn.get("arguments"):
                                slot["arguments"] += fn["arguments"]
                        if chunk.get("usage"):
                            yield StreamEvent(
                                type="usage",
                                prompt_tokens=chunk["usage"].get("prompt_tokens", 0),
                                completion_tokens=chunk["usage"].get("completion_tokens", 0),
                            )
        except httpx.HTTPError as exc:
            raise ProviderError(f"Provider request failed: {exc}") from exc

        for slot in acc_tool_calls.values():
            if not slot["name"]:
                continue
            try:
                args = json.loads(slot["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {"_raw": slot["arguments"]}
            yield StreamEvent(
                type="tool_call",
                tool_call=ToolCallRequest(
                    id=slot["id"] or f"call_{uuid.uuid4().hex[:12]}",
                    name=slot["name"],
                    arguments=args,
                ),
            )
        yield StreamEvent(type="done")


class GeminiCompatAdapter(OpenAICompatAdapter):
    """Google Gemini via its OpenAI-compatible endpoint."""
    provider_type = "gemini"

    def _url(self, path: str) -> str:
        base = (self.config.base_url or "https://generativelanguage.googleapis.com/v1beta/openai").rstrip("/")
        return f"{base}{path}"
