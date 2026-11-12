"""Unified AI provider interface.

Every provider (Ollama, OpenAI-compatible, Anthropic, Gemini, ...) implements
this adapter. The agent engine only ever talks to `ProviderAdapter`, so
switching providers — including moving the model to another VPS — never
requires changing the engine.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional


@dataclass
class ToolCallRequest:
    id: str
    name: str
    arguments: Dict[str, Any]


@dataclass
class StreamEvent:
    """Normalized streaming event emitted by every adapter."""
    type: str                       # "token" | "tool_call" | "usage" | "done"
    text: str = ""
    tool_call: Optional[ToolCallRequest] = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    raw: Optional[Any] = None


@dataclass
class ProviderConfig:
    provider_type: str
    base_url: str
    api_key: Optional[str] = None
    model: str = ""
    temperature: float = 0.7
    top_p: float = 0.95
    max_output_tokens: int = 4096
    context_length: int = 32768
    custom_headers: Dict[str, str] = field(default_factory=dict)


class ProviderError(Exception):
    pass


class ProviderAdapter(ABC):
    """Base class for all AI provider adapters."""

    provider_type: str = "base"

    def __init__(self, config: ProviderConfig):
        self.config = config

    # -------- required -------------------------------------------------
    @abstractmethod
    async def stream_chat(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> AsyncIterator[StreamEvent]:
        """Stream a chat completion. `messages` use the OpenAI-ish schema:
        {"role": ..., "content": ..., "tool_calls": [...], "tool_call_id": ...}
        `tools` use the OpenAI function-calling JSON schema.
        """
        ...

    @abstractmethod
    async def list_models(self) -> List[str]:
        ...

    async def test_connection(self) -> tuple[bool, str]:
        try:
            models = await self.list_models()
            return True, f"Connected — {len(models)} model(s) available"
        except Exception as exc:
            return False, f"Connection failed: {exc}"

    # -------- shared helpers -------------------------------------------
    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        headers.update(self.config.custom_headers or {})
        return headers

    def sampling_params(self) -> Dict[str, Any]:
        return {
            "temperature": self.config.temperature,
            "top_p": self.config.top_p,
            "max_tokens": self.config.max_output_tokens,
        }
