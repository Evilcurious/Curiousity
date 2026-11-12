# Deploying Curiousity on Ubuntu 24.04

This guide deploys the complete Curiousity stack (frontend, backend, PostgreSQL,
Redis, Nginx) on a single Ubuntu 24.04 VPS, with the option to run Ollama on the
same machine. Everything runs in Docker Compose on a private network —
PostgreSQL, Redis and Ollama are never exposed to the internet.

## 1. Server requirements

| Setup | CPU | RAM | Disk |
|---|---|---|---|
| Without local LLM (remote AI) | 2 | 4 GB | 40 GB |
| With Ollama (small models) | 4 | 12 GB | 80 GB |
| With Ollama (GLM-4 / 7B-class) | 8 | 24 GB+ | 120 GB+ (more for models) |

A fresh Ubuntu 24.04 LTS server with a sudo user and SSH access.

## 2. Initial server setup

```bash
# As your sudo user
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ca-certificates

# Optional: run the bundled helper (installs Docker + Compose plugin)
git clone <your-repository-url> curiousity
cd curiousity
chmod +x deploy/setup-ubuntu.sh
sudo ./deploy/setup-ubuntu.sh
```

`deploy/setup-ubuntu.sh` installs Docker Engine, the Compose plugin, and adds
your user to the `docker` group (log out and back in afterwards).

## 3. Configure environment

```bash
cd curiousity
cp .env.example .env
nano .env
```

**Minimum required values:**

| Variable | What to set |
|---|---|
| `SECRET_KEY` | `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `ENCRYPTION_KEY` | `python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `ADMIN_EMAIL` | Your administrator email |
| `ADMIN_PASSWORD` | A strong, unique password (never commit it) |
| `POSTGRES_PASSWORD` | A strong database password |
| `COOKIE_SECURE` | `true` once HTTPS is enabled |
| `CORS_ORIGINS` | `["https://your-domain.com"]` in production |

The admin account is created automatically the first time the backend starts.
Registration of additional users is controlled from the admin panel.

## 4. Start the stack

```bash
# Without a local LLM (use a remote provider configured in the admin panel):
docker compose up -d --build

# With the bundled Ollama server (pulls the default model once):
COMPOSE_PROFILES=ollama docker compose up -d --build
docker compose run --rm ollama-pull      # pulls AI_MODEL into Ollama
```

Check health:

```bash
docker compose ps
curl -fsS http://localhost/api/health
```

Open `http://<server-ip>` and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## 5. Domain + HTTPS

1. Point an A record for `your-domain.com` at the server.
2. Install Certbot and obtain certificates:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

3. Edit `nginx/nginx.conf`: uncomment the HTTPS server block (or let Certbot
   manage it), and set `COOKIE_SECURE=true` + `CORS_ORIGINS` in `.env`.
4. Restart: `docker compose up -d --build`.

## 6. Post-deployment checklist

- [ ] Log in as the admin and change nothing in source — all settings live in the admin panel or `.env`.
- [ ] Admin → System: review registration and maintenance controls.
- [ ] Admin → AI models: verify the default provider (or add OpenAI/OpenRouter/etc.).
- [ ] Admin → Integrations: connect Composio / MCP / n8n as needed.
- [ ] Back up `docker compose` volumes regularly: `postgres-data`, `uploads`, `ollama-models`.
- [ ] Set up TLS, `COOKIE_SECURE=true`, and a firewall (see docs/SECURITY.md).

## 7. Common operations

```bash
docker compose logs -f backend          # watch API logs
docker compose exec backend alembic upgrade head   # apply migrations manually
docker compose restart backend          # restart the API
docker compose down                     # stop everything (data persists in volumes)
docker compose down -v                  # stop and DELETE all data
```

## 8. Backups

```bash
# Database
docker compose exec postgres pg_dump -U curiousity curiousity | gzip > backup-$(date +%F).sql.gz

# Uploads
docker compose run --rm -v curiousity_uploads:/data -v $(pwd):/backup alpine \
  tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

Restore: `gunzip -c backup.sql.gz | docker compose exec -T postgres psql -U curiousity curiousity`.
