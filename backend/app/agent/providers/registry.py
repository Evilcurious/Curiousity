"""Maps AIProvider/AIModel rows to concrete provider adapters."""
from __future__ import annotations

from typing import Dict, Type

from app.agent.providers.anthropic import AnthropicAdapter
from app.agent.providers.base import ProviderAdapter, ProviderConfig
from app.agent.providers.ollama import OllamaAdapter
from app.agent.providers.openai_compat import GeminiCompatAdapter, OpenAICompatAdapter
from app.core.security import decrypt
from app.models import AIModel, AIProvider

_ADAPTERS: Dict[str, Type[ProviderAdapter]] = {
    "ollama": OllamaAdapter,
    "openai_compat": OpenAICompatAdapter,
    "openai": OpenAICompatAdapter,
    "anthropic": AnthropicAdapter,
    "gemini": GeminiCompatAdapter,
    "openrouter": OpenAICompatAdapter,
    "deepseek": OpenAICompatAdapter,
    "groq": OpenAICompatAdapter,
    "together": OpenAICompatAdapter,
}


def build_adapter(provider: AIProvider, model: AIModel) -> ProviderAdapter:
    api_key = decrypt(provider.api_key_enc) if provider.api_key_enc else None
    config = ProviderConfig(
        provider_type=provider.provider_type,
        base_url=provider.base_url,
        api_key=api_key,
        model=model.model_id,
        temperature=model.temperature,
        top_p=model.top_p,
        max_output_tokens=model.max_output_tokens,
        context_length=model.context_length,
        custom_headers=provider.custom_headers or {},
    )
    adapter_cls = _ADAPTERS.get(provider.provider_type)
    if adapter_cls is None:
        adapter_cls = OpenAICompatAdapter  # unknown types default to OpenAI-compatible
    return adapter_cls(config)


def build_adapter_from_values(
    provider_type: str,
    base_url: str,
    api_key: str | None = None,
    model: str = "",
    custom_headers: dict | None = None,
) -> ProviderAdapter:
    config = ProviderConfig(
        provider_type=provider_type,
        base_url=base_url,
        api_key=api_key,
        model=model,
        custom_headers=custom_headers or {},
    )
    adapter_cls = _ADAPTERS.get(provider_type, OpenAICompatAdapter)
    return adapter_cls(config)
