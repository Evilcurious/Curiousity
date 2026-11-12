# Architecture

## Overview

```
Browser (Next.js SPA)
   │  /api/* (relative URLs)
   ▼
Nginx ──▶ Frontend (Next.js)         static + SSR shell
   └──▶ Backend (FastAPI)
          ├── Auth        JWT + rotating refresh sessions, Google OAuth
          ├── Chat        SSE streaming, conversations, attachments
          ├── AgentEngine plan → act → observe loop (LangGraph-style)
          │     └── ProviderAdapter (unified AI interface)
          │           ├── OllamaAdapter        (native /api/chat)
          │           ├── OpenAICompatAdapter  (OpenAI/OpenRouter/DeepSeek/Groq/Together/vLLM...)
          │           ├── GeminiCompatAdapter  (Gemini OpenAI-compat endpoint)
          │           └── AnthropicAdapter     (Messages API)
          ├── ToolRegistry  builtin + MCP + Composio + custom HTTP tools
          │     ├── permissions, approval gates, execution logs
          │     └── Integrations: Composio / MCP(stdio, HTTP) / n8n / Activepieces / webhooks
          └── Admin API   users, providers, models, integrations, settings, audit logs
          │
          ├── PostgreSQL (all relational data, credentials encrypted)
          └── Redis (rate limiting; optional)
```

## Key design decisions

### Unified provider interface
`ProviderAdapter` (`backend/app/agent/providers/base.py`) normalizes streaming
events (`token`, `tool_call`, `usage`, `done`) across providers. The agent
engine only consumes this interface, so swapping Ollama for a remote
OpenAI-compatible server is a base-URL change (docs/MULTI_VPS.md).

### Agent engine
`backend/app/agent/engine.py` implements a bounded multi-step loop:
1. Build context (system prompt + budgeted history + attachment previews).
2. Stream from the model with tool definitions (OpenAI function schema).
3. Execute tool calls through `ToolRegistry` (permissions + approval).
4. Feed results back; repeat until a final answer or `AGENT_MAX_STEPS`.
Models without native tool calling fall back to a text-JSON tool protocol.

### Tool system
Every tool is a `ToolSpec` + executor from one of:
* **builtin** — time, calculator, web search, HTTP fetch, JSON query.
* **mcp** — real MCP client (JSON-RPC 2.0 over stdio or Streamable HTTP).
* **composio** — Composio REST v3 (discovery + execution).
* **custom** — custom REST/HTTP tools, n8n/Activepieces webhooks.
New sources implement `IntegrationConnector` (test, discover, execute) and are
registered in `integrations/registry.py` — no core changes needed.

### Data model
Tables: `users, accounts, sessions, password_reset_tokens, conversations,
messages, attachments, ai_providers, ai_models, user_model_permissions,
integrations, integration_credentials, mcp_servers, tools, tool_permissions,
tool_executions, user_settings, audit_logs`. Migrations live in
`backend/alembic/versions/` (Alembic).

### Streaming protocol (SSE)
`POST /api/conversations/{id}/messages` streams:
`message_start → token* → (tool_call → tool_result)* → message_done → done`,
plus `approval_required` events for gated tools and `error` on failures.

## Extension points

| To add | Do this |
|---|---|
| A new AI provider | Subclass `ProviderAdapter`, register in `providers/registry.py` |
| A new built-in tool | Add a `BaseTool` in `agent/tools/builtin.py` |
| A new integration type | Implement `IntegrationConnector`, register in `integrations/registry.py` |
| A new admin metric | Extend `admin.py` overview query |
| Custom branding/theme | CSS variables in `frontend/src/app/globals.css` |
