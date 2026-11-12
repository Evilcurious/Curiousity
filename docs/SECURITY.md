# Security Model

Curiousity implements defense in depth across authentication, authorization,
data protection and transport.

## Authentication

* **Password hashing** — Argon2id (argon2-cffi: time_cost=3, memory_cost=64MB).
  Passwords are re-hashed transparently when parameters change.
* **Sessions** — short-lived JWT access tokens (HS256) + rotating opaque
  refresh tokens stored hashed (SHA-256) in the `sessions` table and delivered
  in `httpOnly`, `SameSite` cookies. Refresh rotates the token and revokes the
  previous one (theft detection).
* **Password reset** — single-use, expiring tokens (hashed at rest). With SMTP
  configured the token is only delivered by email; without SMTP it is shown in
  the UI (documented self-hosted behavior).
* **Google OAuth** — authorization-code flow, verified against Google's
  token/userinfo endpoints. OAuth tokens are encrypted at rest.
* No OTP / email verification is required (by design).

## Authorization

* **Role-based access control** — `user` and `admin` roles enforced by server-side
  dependencies (`get_current_admin`) on every admin route. Frontend role values
  are never trusted.
* **Per-user data isolation** — every conversation, message, attachment,
  settings row and tool execution is scoped by `user_id`; access to another
  user's resource returns 404.
* **Tool permissions** — per-user allow/deny per tool, enforced in the tool
  registry server-side.
* **Human approval** — tools flagged `requires_approval` pause the agent and
  require an explicit user decision before execution.
* **Model permissions** — per-user allow/deny per model, enforced at message
  time.

## Credential protection

* All secrets (provider API keys, OAuth tokens, integration credentials, MCP
  headers/env) are encrypted at rest with Fernet (`ENCRYPTION_KEY`).
* The API never returns secret values — responses only expose `has_api_key`-style
  booleans.
* The admin bootstrap password comes only from the environment; it is never
  hardcoded. Existing accounts are not modified on restart.

## API hardening

* **Rate limiting** — per-IP sliding windows on auth (10/min) and the whole API
  (120/min), backed by Redis with in-memory fallback.
* **Input validation** — Pydantic schemas with length/pattern constraints on
  every endpoint.
* **SQL injection** — all queries go through SQLAlchemy ORM/parameterized
  statements.
* **XSS** — React escapes by default; Markdown rendering goes through
  react-markdown (no raw HTML injection); strict Content-Security-Policy.
* **CSRF** — cookie-based refresh is `SameSite=Lax` + state-changing requests
  require the Authorization bearer token; CORS is restricted to configured
  origins.
* **Secure headers** — `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, CSP, HSTS (when TLS) set both by
  Nginx and the backend.
* **Maintenance mode** — instantly blocks all non-admin API access.

## Audit & monitoring

* Every security-relevant event (login, failed login, password change/reset,
  admin changes, tool approvals, deletions) is written to `audit_logs` with
  user, IP and timestamp — viewable in Admin → Logs.

## Deployment hardening checklist

- [ ] `SECRET_KEY` and `ENCRYPTION_KEY` are unique random values (never defaults).
- [ ] `ADMIN_PASSWORD` set only in `.env` (chmod 600), never committed.
- [ ] HTTPS enabled (Certbot), `COOKIE_SECURE=true`.
- [ ] PostgreSQL/Redis/Ollama have no public ports (Compose default).
- [ ] Firewall allows only 22/80/443 (`deploy/setup-ubuntu.sh` configures UFW).
- [ ] `.env` excluded from version control.
- [ ] Regular backups of `postgres-data` + `ENCRYPTION_KEY` stored separately.
- [ ] Docker images kept updated.
