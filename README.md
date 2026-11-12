# Curiousity

**Curiousity** is a self-hosted, production-ready AI agent platform with a ChatGPT-inspired monochrome interface, a multi-provider AI layer (Ollama, OpenAI-compatible, Anthropic, Gemini, OpenRouter, DeepSeek, Groq, Together AI, ...), a tool-calling agent engine, an integrations marketplace (Composio, MCP, n8n, Activepieces, custom HTTP tools/webhooks) and a full admin panel.

## Highlights

- **ChatGPT-style UI** — sidebar with searchable, pinnable, date-grouped chat history; streaming responses; markdown + code highlighting; copy / regenerate / edit-and-resend; dark & light monochrome themes.
- **Real authentication** — email + password (Argon2), Google Sign-In/Sign-Up, password reset, change password, persistent sessions. No OTP or email verification required.
- **Multi-provider AI layer** — one unified adapter interface; Ollama (local or remote), any OpenAI-compatible API, Anthropic, Gemini (via OpenAI-compatible endpoint), custom base URLs/API keys/headers. Moving the model to another VPS is an env change only.
- **Agent engine** — tool calling, multi-step execution, conversation memory, context management, execution logs, human approval for sensitive actions.
- **Integrations marketplace** — Composio, MCP (local stdio + remote HTTP), n8n/Activepieces webhooks, custom REST/HTTP tools, per-tool enable/disable and permissions.
- **Admin panel** — overview metrics, user management, AI provider & model management, integration management, system settings, audit/security logs.
- **Secure** — encrypted credentials at rest, RBAC with server-side authorization, rate limiting, audit logs, secure headers, private internal networking for Postgres/Redis/Ollama.

## Quick start (Docker Compose)

```bash
git clone <your-fork> curiousity && cd curiousity
cp .env.example .env
# Set at minimum: SECRET_KEY, ENCRYPTION_KEY, ADMIN_EMAIL, ADMIN_PASSWORD
docker compose up -d --build
# First run with the bundled Ollama service + model pull:
COMPOSE_PROFILES=ollama docker compose up -d --build
```

Open `http://<server-ip>` — the admin account from `.env` is bootstrapped automatically on first start.

## Documentation

| Document | Description |
|---|---|
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Ubuntu 24.04 VPS installation, Docker Compose, Nginx, TLS |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | Every environment variable explained |
| [docs/MULTI_VPS.md](docs/MULTI_VPS.md) | Moving the AI model to a separate VPS (no app rewrite) |
| [docs/SECURITY.md](docs/SECURITY.md) | Security model and hardening checklist |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture and extension points |

## Repository layout

```
backend/    FastAPI + SQLAlchemy + Alembic (Python) — API, agent engine, integrations
frontend/   Next.js + TypeScript + Tailwind — chat UI, settings, admin panel
nginx/      Reverse proxy configuration (TLS-ready)
deploy/     VPS helper scripts
docs/       Deployment, environment, security, multi-VPS docs
```

## Tech stack

Frontend: Next.js · TypeScript · Tailwind CSS
Backend: Python · FastAPI · SQLAlchemy · Alembic · (LangGraph-style agent orchestration)
AI: Ollama (GLM-4.7-Flash default) · OpenAI-compatible providers · Anthropic · Gemini
Database: PostgreSQL · Cache/jobs: Redis · Integrations: Composio · MCP · n8n · Activepieces
Deployment: Docker · Docker Compose · Nginx · Ubuntu 24.04
