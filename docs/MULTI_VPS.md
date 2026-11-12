# Moving the AI model to a separate VPS (multi-VPS deployment)

The AI provider layer is designed so that **moving the model never requires an
application rewrite** — only environment configuration and a deployment change.

## Architecture

```
                      ┌──────────────────────────┐
                      │  VPS 1 — Curiousity      │
 Browser ──HTTPS──▶   │  nginx → frontend        │
                      │        → backend (FastAPI)│
                      │        → postgres, redis  │
                      └────────────┬─────────────┘
                                   │ HTTPS + API key (private network / VPN / allowlist)
                      ┌────────────▼─────────────┐
                      │  VPS 2 — AI inference    │
                      │  Ollama (or vLLM, etc.)  │
                      │  GLM-4.7-Flash           │
                      └──────────────────────────┘
```

The backend talks to the AI server **only** through the unified
`ProviderAdapter` interface (`backend/app/agent/providers/`). Ollama,
OpenAI-compatible and Anthropic servers are interchangeable; the agent engine
does not know or care where inference runs.

## Step-by-step migration

1. **Provision VPS 2** (Ubuntu 24.04) and install Ollama:

   ```bash
   curl -fsSL https://ollama.com/install.sh | sh
   ollama pull glm4            # or your model
   ollama serve                # bound to 127.0.0.1 by default
   ```

2. **Expose the AI server securely.** Recommended options (pick one):

   * **Caddy/Nginx + TLS + allowlist** — serve `https://ai.your-domain.com`,
     restrict by IP or mTLS, require a bearer token via a reverse proxy.
   * **WireGuard/Tailscale** — keep Ollama on a private address
     (e.g. `http://10.0.0.2:11434`) reachable only from VPS 1.
   * Never expose raw Ollama to the public internet without auth.

   If you use an OpenAI-compatible front (vLLM, LiteLLM, OpenRouter), simply
   plan for a base URL + API key instead.

3. **Update VPS 1 configuration** — exactly one line in `.env`:

   ```bash
   # Before (local Ollama on the compose network):
   AI_BASE_URL=http://ollama:11434

   # After (remote AI VPS):
   AI_BASE_URL=https://ai.your-domain.com
   ```

   For providers with keys, add the key in **Admin → AI models → Add/Edit
   provider** (it is stored encrypted), or move the model to an
   `openai_compat` provider with a custom base URL + API key + custom headers.

4. **Restart and verify:**

   ```bash
   docker compose up -d --build
   # Admin → AI models → [provider] → Test  (must report "Connected")
   ```

5. (Optional) **Disable the bundled Ollama** on VPS 1:

   ```bash
   docker compose stop ollama
   docker compose up -d --remove-orphans
   ```

## Adding more models / providers

The admin panel supports unlimited providers simultaneously — e.g. local
Ollama for private data plus OpenRouter for frontier models. Each provider has
its own base URL, API key, custom headers, models, sampling settings and
per-user permissions. Nothing about the deployment topology changes.

## What does NOT need to change

* The agent engine, tool system, integrations, database — zero code changes.
* The frontend — model selection is dynamic.
* Chat history — messages store model identifiers, not endpoints.

## Scaling notes

* The backend is stateless (sessions live in PostgreSQL) — run multiple
  `backend` replicas behind nginx for horizontal scaling.
* Use Redis for rate limiting across replicas (already wired).
* For heavy inference, one dedicated GPU VPS per model family works well;
  register each as its own provider.
