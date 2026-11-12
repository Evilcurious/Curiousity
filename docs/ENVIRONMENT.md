# Environment Variables Reference

All configuration is via environment variables (or `.env` for Docker Compose).
Nothing secret is ever hardcoded in source.

## Required secrets

| Variable | Description | Example / generator |
|---|---|---|
| `SECRET_KEY` | Signs JWT access tokens. Rotate = all sessions invalid. | `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `ENCRYPTION_KEY` | Fernet key encrypting API keys, OAuth tokens and MCP headers at rest. **Losing this key makes stored credentials unrecoverable.** | `python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `ADMIN_EMAIL` | Bootstrap administrator email (created once, on first start). | `evilcurious6@gmail.com` |
| `ADMIN_PASSWORD` | Bootstrap administrator password. Set a strong value **at deployment time only**; never commit it. If the account already exists, the password is not changed. | set during deployment |
| `POSTGRES_PASSWORD` | PostgreSQL password used by Compose. | random string |

## Database & cache

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg2://curiousity:curiousity@localhost:5432/curiousity` | SQLAlchemy URL. Compose overrides this to point at the `postgres` service. |
| `REDIS_URL` | `redis://localhost:6379/0` | Used for rate limiting. Falls back to in-memory limiting if Redis is unreachable. |
| `POSTGRES_USER` / `POSTGRES_DB` | `curiousity` | Compose database credentials. |

## Application

| Variable | Default | Description |
|---|---|---|
| `APP_NAME` | `Curiousity` | Display name. |
| `ENVIRONMENT` | `production` | `production` or `development`. |
| `DEBUG` | `false` | Verbose errors (keep off in production). |
| `PUBLIC_API_URL` | `http://localhost:8000` | Public URL used in emails/password-reset links. |
| `CORS_ORIGINS` | `["http://localhost:3000"]` | JSON list of allowed browser origins. |
| `HTTP_PORT` | `80` | Host port for Nginx (Compose). |
| `UVICORN_WORKERS` | `2` | Backend worker processes (Compose). |

## Security

| Variable | Default | Description |
|---|---|---|
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | JWT lifetime. |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `30` | Persistent-session lifetime (rotating refresh tokens in httpOnly cookies). |
| `COOKIE_SECURE` | `false` | Set `true` when serving over HTTPS. |
| `COOKIE_SAMESITE` | `lax` | Cookie SameSite policy. |
| `RATE_LIMIT_ENABLED` | `true` | Master switch for rate limiting. |
| `RATE_LIMIT_AUTH_PER_MINUTE` | `10` | Per-IP limit on `/api/auth/*`. |
| `RATE_LIMIT_API_PER_MINUTE` | `120` | Per-IP limit on the whole API. |

## AI provider defaults

These seed the **system provider** at bootstrap and can be changed later in the
admin panel or by editing `.env` and restarting (the system provider is kept in
sync with the environment).

| Variable | Default | Description |
|---|---|---|
| `AI_BASE_URL` | `http://127.0.0.1:11434` | Ollama/AI server URL. In Docker Compose: `http://ollama:11434`. Later: `https://ai.your-domain.com` (see docs/MULTI_VPS.md). |
| `AI_MODEL` | `curiousity-glm` | Default model identifier (e.g. GLM-4.7-Flash via Ollama). |
| `AI_PROVIDER_TYPE` | `ollama` | `ollama` \| `openai_compat` \| `anthropic` \| `gemini`. |
| `AGENT_MAX_STEPS` | `8` | Maximum plan→act→observe loops per user message. |
| `AGENT_CONTEXT_BUDGET_CHARS` | `24000` | Character budget for conversation history sent to the model. |

## Google OAuth (optional)

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth credentials from Google Cloud Console → Credentials → OAuth client (Web). |
| `GOOGLE_REDIRECT_URI` | Must match an authorized redirect URI: `https://your-domain.com/auth/google/callback`. |

When unset, Google sign-in buttons hide automatically and only email/password
authentication is offered. See below for the console setup steps.

### Google Cloud Console setup
1. Create a project → APIs & Services → Credentials → Create OAuth client ID (Web application).
2. Authorized JavaScript origins: `https://your-domain.com`
3. Authorized redirect URIs: `https://your-domain.com/auth/google/callback`
4. Copy Client ID/Secret into `.env`, restart the backend.

## SMTP (optional)

Password-reset emails are sent when `SMTP_HOST` is set. If SMTP is not
configured, the reset token is displayed directly in the UI (self-hosted
convenience) — no email is sent.

| Variable | Default | Description |
|---|---|---|
| `SMTP_HOST` | *(empty)* | SMTP server. |
| `SMTP_PORT` | `587` | SMTP port. |
| `SMTP_USER` / `SMTP_PASSWORD` | | SMTP credentials. |
| `SMTP_FROM` | `curiousity@localhost` | From address. |
| `SMTP_TLS` | `true` | Use STARTTLS. |

## Registration & maintenance

| Variable | Default | Description |
|---|---|---|
| `REGISTRATION_ENABLED` | `true` | Can also be toggled live in Admin → System settings. |
| `MAINTENANCE_MODE` | `false` | Blocks all non-admin API access when enabled. |

## Uploads

| Variable | Default | Description |
|---|---|---|
| `UPLOAD_DIR` | `/data/uploads` | Where chat file attachments are stored (a Docker volume in Compose). |
| `MAX_UPLOAD_MB` | `25` | Per-file upload limit. |

## Integration credentials

Integration secrets (Composio API keys, custom REST tokens, MCP headers) are
**not** environment variables — they are stored in the database encrypted with
`ENCRYPTION_KEY` and are never returned by the API.
