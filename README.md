# Curiousity

Curiousity is a self-hosted studio for turning authorized YouTube videos and livestreams into captioned clips. Choose Local analysis or an AI model that can see the footage. **Captions** creates full-length subtitled MP4s from a device video or from one picture plus audio. **Chat** offers model conversations, **Reach** video discovery, and reviewed **n8n Workflows**. **Try demo** runs a full export without YouTube or an API key.

## Run locally

Install **Node.js 22.13+** and **Python 3.10+**. On Debian/Ubuntu, `sudo apt install git python3-venv ffmpeg fontconfig fonts-dejavu-core` provides the media tools and base fonts. On Windows, install WSL Ubuntu (`wsl --install -d Ubuntu`), then install Node.js and run these commands in the Ubuntu terminal.

```sh
git clone --branch arena/e2b88358-curiousity --single-branch https://github.com/Evilcurious/Curiousity.git curiousity
cd curiousity
npm ci
npm run setup
npm run dev
```

Open <http://localhost:5173> and **Sign up** to create a member account (email, password, repeat password). If you need admin access or are upgrading an existing installation, stop the app and complete the administrator setup below before exposing it. Sign-up is enabled by default; `ALLOW_SIGNUP=false` disables it without locking out existing accounts. There is no email verification or password recovery by email. Signed-in users can change their own password. It is intended for a trusted workspace, not as an open public video-processing service.

`npm run setup` installs or updates yt-dlp, its JavaScript support, and faster-whisper in `.venv`. It installs a portable FFmpeg when a system build is missing and a wheel is available. It does not create third-party accounts or supply API keys. Use `npm run setup -- --no-whisper` if you only need source captions or remote transcription. Local Whisper downloads model weights from Hugging Face on first use; to do that ahead of time, run `npm run setup -- --download-model`. `WHISPER_MODEL` defaults to `base`; `tiny` is faster on a small CPU. **Setup Guide** in the app shows detected tools.

## Provision an administrator or upgrade

The browser's old Basic Auth prompt is gone. Do **not** reuse a disclosed or shared password for the admin. On the host, **stop the server** and back up `.clipforge/` (or your configured `DATA_DIR`), including `.key`. Run this from a terminal in the checkout, substituting your administrator email:

```sh
ADMIN_EMAIL='admin@example.com' npm run admin
```

Enter and confirm a new unique password of at least 14 characters. Your input is hidden; only the salted password hash is saved. Do not commit the password, put it in preview settings, or leave it in `.env`. For unattended setup, the command also accepts `ADMIN_PASSWORD` from a private host environment.

`npm run admin` creates the administrator once. With an existing installation, it adopts the old single-user clips, keys and integrations **privately** under that administrator. It does not automatically list any exports for other members. Keep using the same data directory rather than renaming `.clipforge/`. If you set `ADMIN_EMAIL` in `.env` before provisioning, that email is reserved from self-registration. The CLI will not promote an existing member using that email. To rotate the administrator password and revoke all its sessions, stop the app and use the same procedure with `npm run admin -- --reset`. The administrator email must match the existing one. You can remove legacy `AUTH_USER` and `AUTH_PASSWORD` settings; they are no longer used.

There is no default password. To generate one instead of typing it, run this in your private SSH terminal with the app stopped:

```sh
ADMIN_EMAIL='admin@example.com' npm run admin -- --generate
```

`--generate` prints a unique temporary password once to the terminal, never to redirected output. Only its hash is saved. It expires after 24 hours, and the app requires a replacement before allowing access to the workspace. Add `--reset` after `--generate` only to recover an existing administrator account; this revokes its sessions. To enter your own temporary password instead, use `--temporary`.

To change your password in the app, go to **Settings → Account → Change password**. Enter the current password and confirm a new one. This signs out every session for your account; sign in again with the new password.

If upgrading a clone on this branch, stop the running server, back up as above, run `git pull --ff-only origin arena/e2b88358-curiousity`, then `npm ci`, `npm run build`, and restart the same service. Run `npm run setup` if media tools need updating. Keep the same data directory; provision an administrator only if you don’t already have one. On a normal startup after provisioning, **no admin password environment variable is needed**.

## Run on a VPS or with Compose

Use a persistent Node service with FFmpeg and a writable data directory. Curiousity is not a static app or a serverless workload. **Public sign-in requires HTTPS.** `http://VPS_IP:5173` is not a sign-in URL. Keep the Node listener private on `127.0.0.1:5173` and do not expose `npm run dev`.

### Node with an HTTPS reverse proxy

On a fresh install, copy `.env.example` to `.env`. Set `ADMIN_EMAIL` and consider `ALLOW_SIGNUP=false` for a private instance. When Nginx or Caddy runs on the same Linux host and connects to Curiousity on loopback, set:

```dotenv
HOST=127.0.0.1
PUBLIC_ORIGIN=https://clips.example.com
TRUST_PROXY=loopback
```

Replace `clips.example.com` with your hostname. Install and build with `npm ci`, `npm run setup`, and `npm run build`. Provision the admin as shown above before starting `npm start`. With systemd or PM2, set the service working directory to the checkout (where `.env` and the default `.clipforge/` live). Both `npm start` and direct `node server/main.mjs` launches read `.env` from that directory. Settings already exported by the service take precedence.

Point DNS at the VPS and allow inbound ports 80 and 443. For Caddy, this site config serves HTTPS and redirects HTTP automatically:

```caddyfile
clips.example.com {
    reverse_proxy 127.0.0.1:5173
}
```

For Nginx, configure TLS and redirect port 80 to HTTPS. Copy [`deploy/nginx-curiousity.conf`](deploy/nginx-curiousity.conf) to `/etc/nginx/snippets/curiousity-proxy.conf` and use it inside the existing **HTTPS** virtual host, replacing its Curiousity proxy directives rather than duplicating them:

```nginx
location / {
    include /etc/nginx/snippets/curiousity-proxy.conf;
}
```

Run `sudo nginx -t && sudo systemctl reload nginx` after editing. The snippet preserves the hostname and **overwrites** `X-Forwarded-Proto` with `$scheme`. Restart Curiousity after changing `.env` or its service environment.

**Large device-video uploads.** Install or update both Nginx snippets from the checkout:

```sh
sudo install -m 0644 deploy/nginx-curiousity.conf /etc/nginx/snippets/curiousity-proxy.conf
sudo install -m 0644 deploy/nginx-caption-upload.conf /etc/nginx/snippets/curiousity-caption-upload.conf
```

In the same HTTPS `server { … }`, add `include /etc/nginx/snippets/curiousity-caption-upload.conf;` **alongside** `location /`, not inside it. Then validate and reload Nginx as above. This disables Nginx’s body-size cap and request buffering **only** for `/api/captions/upload`; it does not change limits on other routes. The proxy snippet also gives model replies more than the default 60 seconds. Caddy’s `reverse_proxy` streams incoming uploads by default; don’t add a request-size cap to this route if you want uncapped uploads. A CDN, hosting plan, or another proxy can still reject large or slow transfers. If it does, use a directly reachable TLS hostname or a private SSH tunnel instead. Git updates do not change the running proxy or restart the service.

If sign-in still reports an HTTPS error, check the public route without submitting a password:

```sh
curl -fsS https://clips.example.com/api/auth/session
```

The response should contain `"passwordTransport":"https"`. A `blocked` or `local` result at the public URL means the app is not seeing a trusted TLS connection. Verify the proxy forwards a single `X-Forwarded-Proto: https` on actual TLS requests, connects to `127.0.0.1` for `TRUST_PROXY=loopback`, and that the app picked up the setting. If a CDN sits in front of Nginx, use TLS from the CDN to the VPS as well; don't hard-code the forwarded scheme. If one trusted proxy connects over a private non-loopback network (for example the Compose HTTPS overlay), use `TRUST_PROXY=1` instead. Never enable proxy trust on a public backend port.

#### “API route not found” after an update

The browser files and the Node process are separate. `npm run build` updates `dist/`, but a running process can still have the old API loaded. If **Captions** or **Chat** shows this error, restart the **Curiousity service** from the checkout you pulled, not just Nginx or Caddy. Keep its existing `DATA_DIR` and `.key`; no account reset is needed. For systemd, check the unit’s `WorkingDirectory` and restart that unit. For PM2, check the app’s script path and restart that app. For Docker Compose, rebuild and recreate the app with `docker compose up -d --build`, using the same project and `-f` files as your current deployment.

Check the running backend from the VPS, then check the public routing. Use your actual loopback port and HTTPS hostname:

```sh
curl -fsS http://127.0.0.1:5173/api/auth/session
curl -fsS https://clips.example.com/api/auth/session
```

Look for `"mediaModes":true`, `"stillCaptions":true`, `"socialOAuth":true`, and `"n8nWorkflows":true` in `apiFeatures`. These flags indicate route support, not that media tools or integrations are configured. If the flag is missing locally, verify which process is listening on the app port and that it was restarted from the updated checkout. If it’s present locally but missing at the public URL, check the proxy’s upstream address and any API caching. If both are current but one action still fails, make sure every `/api/` location (including `/api/captions/upload`) forwards the original path. Use `proxy_pass http://127.0.0.1:5173;` **without** a trailing slash in the supplied Nginx snippets. Reload the page after restarting the backend. If reporting a remaining error, include the failing action and the HTTP method, path and status from the browser’s Network tab, not cookies, API keys or passwords.

### Docker Compose with automatic HTTPS

Use the optional `compose.https.yaml` overlay if no other proxy already listens on ports 80/443. Point a DNS name at the VPS, open ports 80/443, and set `CURIOUSITY_DOMAIN=clips.example.com` in `.env` (hostname only). The overlay starts Caddy with persistent TLS certificates, redirects HTTP, and supplies the app’s `PUBLIC_ORIGIN` and `TRUST_PROXY` settings. If you already have a proxy, use `compose.yaml` and configure it as above instead.

Build the image and, if no admin exists, provision it from an interactive terminal while the app is stopped. Replace the example email:

```sh
docker compose build
docker compose stop curiousity
docker compose run --rm -e ADMIN_EMAIL=admin@example.com curiousity npm run admin -- --generate
```

Then start the HTTPS deployment and open `https://clips.example.com`:

```sh
docker compose -f compose.yaml -f compose.https.yaml up -d
```

Run these from your existing Compose project directory, with the same project name if you use `-p`, to keep its workspace volume. For code updates, add `--build` to `up -d`. The backend remains bound to `127.0.0.1:5173` on the host; `CURIOUSITY_PORT` overrides that host port. When upgrading from the old Compose service, use `docker compose down` **without `-v`** in the original checkout first so the existing workspace volume is retained.

### No domain? Use an SSH tunnel for private access

Keep the backend port private and run this **on your computer**, not on the VPS:

```sh
ssh -N -L 127.0.0.1:5173:127.0.0.1:5173 your-user@VPS_IP
```

Keep the tunnel open and visit <http://localhost:5173> in your browser. The HTTP connection only runs on loopback at both ends; traffic between your computer and the VPS is encrypted by SSH. If you use Compose without a public proxy, start it with `docker compose up -d` (no HTTPS overlay). This option is for private access, not for public Buffer media links or external HTTPS OAuth callbacks.

Use one app process per data directory. Back up `.clipforge/` (or `DATA_DIR` / the Docker `/data` volume) **including `.key`**. The key lives alongside encrypted integration credentials; protect access to both, and to `.env` and backups. For YouTube imports and picture + audio jobs, `MAX_SOURCE_MINUTES` defaults to 180 and `MAX_SOURCE_MB` to 2048. Temporary working media is removed after a job; delete old projects to reclaim export space. Saved library copies keep their media even after the original is removed.

## Accounts, themes, and the Clip Library

- **Settings → Admin → Workspace branding** sets one of 14 themes and the logo for everyone, including the sign-in page. **Appearance** is read-only for members. An upgrade removes old personal theme overrides.
- **Admin → Member access → Edit sign-in** changes a member’s email and/or sets a temporary password. This requires the administrator’s current password and revokes all of that member’s sessions. Temporary passwords expire in 24 hours and must be replaced before the member can use the workspace. Projects and connections keep the same owner ID. The last successful sign-in IP and time are visible only to administrators. Configure a trusted proxy as described above, with the backend private and the proxy overwriting forwarding headers; otherwise the saved address is the direct peer, which may be the proxy.
- A finished project is private until its owner opens it and chooses **Share to library → Share exports**. Only share media and captions other members have permission to reuse. Shared listings include rendered exports and metadata such as clip title and duration, not project controls, source links, or connections.
- In **Clip Library → Shared clips**, any signed-in member can preview, download, and select **Save to my projects** to keep a private reusable export. This does not include the original full source or delivery settings. The owner can stop sharing and the administrator can unlist the exports without deleting the project. Copies already saved or downloaded are not recalled. Only the original project can re-list its exports.

## YouTube sources and live capture

- **Auto-detect** handles video URLs, completed replays, and active streams. **Recorded video** refuses a still-running live feed. **Live monitor** requires one. To capture a channel that's live now, use its YouTube `/live` link or the stream's watch URL.
- **Live replay** is for clipping the finished recording, not recording from the live edge. Paste an individual YouTube watch or stream link. A playable replay starts immediately; if the broadcast is upcoming, still live or being processed, it displays **Waiting for replay** and checks again automatically. Auto-detect and Recorded video also wait if a broadcast has just ended. If a channel link resolves to a particular broadcast, the wait is pinned to that video ID; otherwise use the individual link.
- You can close the tab while waiting. Pending replay checks survive server restarts, release the media worker between checks, and still count toward queue limits. **Stop project** cancels the wait. By default the server checks about every minute and gives up after six hours (`REPLAY_CHECK_SECONDS`, 5–600; `REPLAY_WAIT_MINUTES`, 1–1440). Queue load may delay checks. A replay still needs compatible, authorized media within normal duration and size limits.
- Choose a **Live capture limit** (2, 5, 10, 15, or 30 minutes, or **Custom** from 1 minute up to `MAX_SOURCE_MINUTES`). Once Curiousity finds an active stream, the project shows **Live Monitor** with three modes:
  - **Analytics** starts recording near the live edge. **Analyze now** examines newly saved footage and adds clips without stopping the recorder. The capture limit still applies; at the end Analytics examines any remaining complete footage within the clip count. Segments are available for analysis once closed, not as soon as their first frames arrive.
  - **Auto** monitors the public live chat feed. A sustained increase in message volume triggers one AI-ranked clip from nearby captured footage. Choose an available personal or shared vision-capable model. Chat data and video arrive separately, so the reaction time is approximate. Curiousity distinguishes an unavailable feed from a feed where no messages or spikes have been observed. A missing feed or failed AI call never creates a fake spike clip. The server bounds automatic evaluations to 12 per capture, with a cooldown, within the project’s clip count.
  - **Full** stops the live-edge recording and waits for the **same broadcast’s** replay, pinned by video ID. Analysis covers the playable replay from its beginning, including footage before you opened the monitor. Existing clips are kept and replay clips are added separately. The normal source and replay wait limits still apply. YouTube may not publish a replay, or it may omit some of the original broadcast.
- **End project** stops capture, analysis, or replay checks and keeps already-rendered clips. Download clips while the monitor is open; end the project before sharing or delivering them. Reaching the capture limit or finishing the replay does not end the project. Recording and the current snapshot can coexist temporarily (up to two source-sized files plus export/scratch space). Live chat is collected only from the public feed: the server reads events into a short-lived meter and removes raw temporary chat files when the collector ends; no chat messages or authors go to the AI model.
- Capture tries the available public HLS variants, including separate video/audio and master playlists, then checks for alternative formats such as DASH. If an HLS stream only offers video, Curiousity can clip it without audio and will say so. It cannot guarantee capture of every broadcast. YouTube may reject media requests, especially on some VPS IPs, or may not expose a compatible feed. Update yt-dlp with `npm run setup`; if the error persists, try the replay after it becomes available. Curiousity does not bypass private, regional, login, or other access restrictions.
- **Local** ranks moments using timestamped speech, audio activity, and replay heatmaps when available. It does not send frames, excerpts, or audio to a remote AI provider.
- **AI** sends actual footage evidence from the authorized download or captured window to your selected model. Gemini receives a small MP4 with audio for sources up to 90 seconds when a preview can be built. For longer sources and other providers, the model receives timestamped frames sampled across the timeline and around likely highlights, plus available transcripts and signals. Use a model that accepts the relevant video or multi-image inputs. Sampling can miss brief moments. Returned rankings are limited to real candidate windows; invalid or failed AI rankings do not silently become Local results. The results label the engine and evidence used. Transcription remains separate, using source captions or a configured speech engine.
- **Auto** under **Number of clips** keeps strong, non-overlapping highlights (up to 20). If nothing stands out, it picks only the best available moment and says so. Scores estimate highlight strength, not views or virality. Fixed and custom counts still work; a short source may yield fewer clips than requested.

## Export formats and languages

- **Platform preset** picks the recommended canvas: TikTok, Instagram Reels, Facebook Reels, and YouTube Shorts default to **9:16 (720 × 1280)**; YouTube video defaults to **16:9 (1280 × 720)**. Universal starts at 9:16. Presets are not account connections and do not publish anything. Exported MP4s can be uploaded manually, or sent as reviewed video drafts using a compatible Buffer channel.
- Choose 9:16, 4:5, 1:1, 16:9, or enter a **Custom ratio** such as `3:2`. Use whole-number terms from 1 to 100 between 1:4 and 4:1. Dimensions round to even pixels, with 1280 pixels on the long edge. The original picture stays centered and uncropped over a blurred background when it doesn't match the frame. Check the destination's requirements if overriding a preset.
- **Caption language** can keep original speech or request another language. Curiousity prefers a usable YouTube caption track in the chosen language. If none exists, it can translate the transcript with the project’s AI chat model; local Whisper also supports speech-to-English translation. Transcription uses original YouTube captions when available, then local Whisper in Local mode, or your configured timestamped speech model (with Local Whisper as a speech-only fallback) in AI mode. If the requested language cannot be produced, the project reports the fallback and labels the actual caption language. The demo ships English, Urdu, Roman Urdu, and Spanish tracks.
- **Roman Urdu** is Urdu written in Latin letters, separate from Urdu script. Curiousity uses an available Roman Urdu track, asks your selected chat model to romanize or translate cues, or converts available Urdu text locally without a key. Local spellings are approximate, especially for names and omitted vowels. For other source languages with neither a usable Urdu track nor an AI chat model, Curiousity keeps the original captions and reports that fallback.
- **Caption style → Customize** previews the font, size and effect. Choose an entrance or cue effect (Fade in, Pop, Rise, or Word highlight) and an optional exit (Fade out or Shrink out). Word highlight estimates timing within each cue; it is not word-level speech alignment. These choices burn into the MP4, not the SRT. To try them without a key, choose **Auto**, **Roman Urdu**, and a style, then click **Try demo** in Studio.
- **Hashtag language** is separate. Choose a language, **Match source**, or **Off**. Each clip shows copyable suggestions, using local terms and transcript keywords when available in that language. If the source language is unknown or unsupported for tags, **Match source** uses English. Tags aren't claims about what is trending; review them before posting.
- Burning subtitles into the MP4 needs FFmpeg with `libass`. [DejaVu sans, serif and mono](server/assets/DEJAVU-FONTS-LICENSE.txt) are bundled for Latin-script styles. Curiousity uses bundled [Noto fonts](server/assets/NOTO-FONTS-LICENSE.txt) for Arabic/Urdu script, Hindi, and Bengali so the text remains readable. Install fonts for other scripts on the host as needed, e.g. `fonts-noto-cjk` for Chinese, Japanese, and Korean on Debian/Ubuntu. If a font is missing or FFmpeg lacks `libass`, the SRT still contains the caption text.

## Captions from your device

1. Open **Captions**. Choose **Video** for a playable MP4, MOV, WebM, MKV, or AVI with speech. Or choose **Picture + audio** and add one JPG, PNG or WebP and one MP3, WAV, M4A, AAC, FLAC or Ogg. The first frame of the picture stays on screen for the audio duration; no generated footage, slideshow or stock clips are added.
2. Choose **Local** (Whisper on your server) or **AI** (the timestamped **Caption engine** in **Settings → AI Providers**). AI transcription sends prepared audio, not the picture or original video. Choose **Original speech** or any of the Studio caption languages. For other output languages, AI mode can also use a selected chat model to translate the timed cues. Local can translate to English and romanize recognized Urdu. If an AI translator cannot produce English captions, the server can translate the audio with multilingual Local Whisper when installed. If no engine can produce the requested language, the project retains and labels the original captions and explains why.
3. Pick a caption style and click **Generate captions**. The browser waits for a receipt, then shows the saved project moving through the caption queue, speech processing, and rendering. Captions have a separate worker, so a running live monitor does not hold up the caption queue. Download the styled **MP4** and plain **SRT**. **Render style** reuses the saved transcript without transcribing again. FFmpeg must include `libass` for styled MP4; without it, only SRT is available.

Device video uploads stream to disk without a fixed app size cap. Picture + audio uses the configured source size and duration limits for audio, and accepts one picture up to 12 MiB and 16 megapixels. Both preserve the display aspect ratio (up to 1920 pixels on the long edge). Plan, queue, disk and proxy limits still apply. `CAPTION_TASK_MINUTES` (default 240) bounds each processing stage; it is not an upload size limit. Local Whisper may download its weights on first use; prefetch with `npm run setup -- --download-model` if model loading is slow. Input files stay private and are retained for re-styling; delete the project to remove them.

If you see **Waiting for the upload receipt** and it times out, check **Caption projects** first. If there is no project, verify the exact `/api/captions/upload` proxy route, request streaming, and available disk space. A saved project shows a separate processing status and any engine errors. Preserve the existing data directory and use the Nginx upload snippet above rather than increasing the limit for all API routes.

## AI providers

Any signed-in member can use **Settings → AI providers → Add provider** to save a personal profile for each key, model or endpoint. Premium is not needed to save, discover, or use personal models. There is no fixed profile count limit, and you can save several profiles for the same service. Search or filter the list to find them. Presets cover OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, DeepSeek, Mistral AI, xAI, Fireworks AI, Cerebras, NVIDIA NIM, Ollama, and LM Studio, plus a custom OpenAI-compatible endpoint. Use **Fetch models** or type a supported chat model ID directly. Choose **Use model** to set your default chat model, or select **AI → AI video model** in Clip Studio for the project’s visual ranking and timed caption translation. Select **Local** to work without model requests.

Select a separate **Caption engine** for transcription if desired. A remote transcription profile must support `/audio/transcriptions` with timestamped `verbose_json` segments, like OpenAI `whisper-1`. Member custom endpoints must use public HTTPS reachable from the VPS, including their API path (often `/v1`). Explicit HTTPS ports are supported. Pasting an OpenAI-compatible operation URL such as `/v1/chat/completions` uses its API base `/v1`. To connect Ollama or LM Studio as a member, provide a public HTTPS endpoint you control and secure it with authentication; `localhost` would refer to the VPS, not your device. Only the host administrator can set up a loopback AI service on the VPS. The browser never calls these endpoints directly. Private and reserved addresses and redirects are blocked on outbound member connections. API keys are encrypted at rest; a saved key isn’t reused when an editable endpoint changes. External providers receive frames, a compressed video preview, excerpts, cues, or audio as appropriate and may charge for usage. Keep Local analysis and Local Whisper selected to avoid sending this material to AI providers.

### Troubleshoot ranking and translated captions

- **AI ranking:** Choose a vision-capable model in **Clip Studio → AI video model**. If its reply is cut off or unusable, Curiousity retries once with the same footage evidence and a shorter output request. Explicit AI mode does not switch to Local; use **Try Local instead** if you want that fallback.
- **Translated captions:** Cues are translated in batches, and missing cue IDs get one repair attempt without changing their timings. For English, Curiousity can use an English source track or multilingual Local Whisper if the AI translation fails. If none works, the export keeps its original language and shows the cause rather than labeling it English.
- **Provider errors:** `401` usually means the key needs attention; `429` indicates a limit or quota. A `400`, `413`, or `422` in AI ranking can mean the model does not accept the video or the number of images supplied. Check the model ID and input support. After deploying a fix, start a **new** project: warnings and rendered captions on completed projects do not change in place.

### Chat with a saved model

Open **Chat** and choose a personal profile or a model your administrator shares with your plan. Send a message and follow up in the same conversation. Curiousity forwards recent text turns to the selected model; it does not save conversations to disk. Reloading the page, signing out, starting a new chat, or switching profiles clears the conversation in that tab. Provider data and billing policies apply. The **Conversation** tab does not use connected apps or read your projects. Switch to **Workflows** for n8n, or **Reach** to find video sources. Reach AI review uses personal models only.

### Reach

Reach is a signed-in **Chat** tool, separate from the model conversation. Inspired by [Agent Reach](https://github.com/EdisonChenAI/agent-reach), it uses public search providers without logging into social platforms or running arbitrary search tools. Curiousity does not store searches on the server. Search and verification are limited per account and instance; provider quotas also apply.

- **Date range:** Choose the last **1, 2, 4, or 7 days**, or **Custom days** (1–365). The backend enforces a rolling UTC lookback using the reported source date. Undated, future, or out-of-window items are excluded. **New search** clears the current results and filters, or stops an in-progress search. It doesn't delete files you already downloaded or change projects or Chat history.
- **Reach:** Enter a topic or hashtag and select YouTube, TikTok and/or Instagram Reels. Each source shows the matches and why candidates were skipped. The search requests fresh page evidence, or uses the official YouTube Data API when configured. Private or unverifiable items are not shown. YouTube API results can be ranked by **total views** within the date range; this is not view growth or a global trending chart. Other platforms are ranked by relevance. **Use in Clip Studio** prefills a YouTube link without starting a project. Access and playback can vary by viewer or region; use only authorized media.
- **AI review:** When a personal Chat model is selected, the review switch is on by default. The model sees the query, its filters, and brief public evidence for every match that passes the source checks, **not** your Chat history or projects. Its decisions can reject matches but cannot add or alter records or override a failed date or availability check. If the model can't review every match, those results are withheld. You can fix the model or try again with the switch off. Without a personal model, Reach still uses source checks and labels results **Source checks only**. Usual provider usage charges apply.

#### Server setup for public search

Curiousity uses the [hosted Exa MCP](https://exa.ai/docs/get-started/exa-mcp) at its no-key rate limit by default. The VPS must be able to reach `mcp.exa.ai` over HTTPS. Configure `EXA_API_KEY` privately in `.env` (or the actual service environment) to use `api.exa.ai` and your Exa quota instead. Optional `YOUTUBE_DATA_API_KEY` enables the YouTube Data API v3 for Reach (`www.googleapis.com`); enable that API in Google Cloud and restrict the key to the YouTube Data API where possible. If YouTube lookup fails, Reach tries the index with fresh-source checks and labels the fallback. Exa is asked for fresh page text. Explicitly cached results, missing evidence and undated pages are skipped. Exa search does not always include per-page crawl metadata, so a source check is not an independent guarantee of playback access. Both keys are server-only and may incur provider usage charges. These are separate from any profile or Google delivery OAuth credentials. Set `DISCOVERY_ENABLED=false` to disable Reach. Rebuild the web assets and restart the Node service after updating this release; recreate the Compose service with the same volume if using Docker. A blocked network or upstream quota is shown as unavailable, never filled with sample results. After deploying, confirm `/api/auth/session` includes `"discoveryVerification":true`; old servers cannot provide verified results.

### Membership and shared AI

| Plan | Monthly price | Projects / UTC month | Shared AI projects / UTC day | Shared Chat messages / UTC day | TikTok accounts |
| --- | --- | ---: | ---: | ---: | ---: |
| Free | Free, no expiration | 1 | 1 | 3 | 1 |
| Basic | PKR 3,000 | 20 | 3 | 5 | 3 |
| Premium | PKR 5,000 | Unlimited | 5 | 10 | 5 |
| Elite | Contact for price | Unlimited | Unlimited | 30 | 10 |

- **Settings → Account → Activate Premium** opens the plan picker. Each paid selection opens WhatsApp for `03174541414` (international form `+92 317 4541414`) with a message naming the plan. Curiousity does not take payment, collect billing details, or grant access from the link. The administrator activates a paid plan or extends it by one calendar month in **Admin → Plan & limits**. Unrenewed plans return to Free. Per-member overrides can raise limits without resetting usage or extending a term.
- A new Studio project (including the demo), completed Captions upload, or saved copy of a shared clip counts toward the monthly total. Deleting a project or stopping processing does not refund its slot. Restyling a caption project, switching a live mode, and opening an existing copy do not create new projects. Shared AI is metered per project that selects a shared model and per Chat request sent to one; the server reserves capacity at acceptance. Personal keys do not consume either shared AI allowance, but total project and service limits still apply. Unlimited plan entries still have concurrency, media, and provider limits.
- From **AI Providers → Share model**, the administrator chooses paid members only or all plans, including Free. Shared models can score Studio and Auto clips, translate captions, and answer Chat. Members cannot see the model’s endpoint or key, edit it, browse its catalog, use it for discovery review or transcription, or access the administrator’s integrations. Unsharing or membership expiry blocks new calls where the profile is no longer available; an in-flight call may finish. The administrator pays their model provider’s charges.
- Before upgrading, back up the data directory and `.key`. Legacy active Premium accounts receive a one-month Premium term on first startup; the old same-day AI meter is carried forward. Personal themes are retired, existing media is kept, and a saved TikTok connection becomes the first account in the list. The old `PREMIUM_DAILY_JOBS` setting is replaced by plan limits and member overrides. Check `/api/auth/session` after re-deploying: the server should report `membershipPlans` and `liveMonitorModes` as true.

## n8n Workflows in Chat

1. Create a workflow in your n8n instance with a **Webhook** trigger, method **POST**, and **Header Auth**. Use `X-Curiousity-Token` as the header name and a secret of at least 16 non-space characters. Publish the workflow and copy the **Production URL** (`https://…/webhook/…`, not `/webhook-test/…`). The Curiousity server must reach it over public HTTPS; private endpoints and redirects are blocked.
2. In **Settings → Admin → n8n workflow**, enter its name, URL and matching secret, then enable it for members. One published workflow can be configured per Curiousity instance. Its secret stays on the server. Only enable a workflow appropriate for all workspace members; validate inputs, authorize the supplied member ID as needed, and keep downstream accounts and permissions scoped in n8n. This is not an app catalog or access to the n8n administration API.
3. In **Chat → Workflows**, enter a message. The preview shows the exact JSON fields sent after approval: `message`, `memberId`, and `requestId`. No model, Chat history, or saved app tokens are sent. Approvals expire after five minutes and can only be used once by the member session that made them. n8n can return `{ "reply": "Done" }` or plain text. If no result is confirmed within 45 seconds, check n8n executions before submitting again: a workflow may have started. Use `requestId` for deduplication in n8n if the workflow has side effects.

Composio and the LinkedIn/Google Maps Finder are retired. Old Composio credentials and grants are not used or copied to n8n. Revoke any unused external grants in the old project/provider consoles and remove the unused `COMPOSIO_API_KEY` environment setting. Reach and model Conversation remain available.

## Google and TikTok delivery accounts

1. Set `PUBLIC_ORIGIN` to the production HTTPS origin and configure trusted proxy forwarding. In **Settings → Admin → Google and TikTok OAuth apps**, copy the exact callback URLs into the provider portals: `/api/google/callback` and `/api/tiktok/callback` under that origin. Open the site as a top-level tab for authorization. Forward the callback routes and their query strings unchanged; avoid logging OAuth codes.
2. For **Google**, register a Web application OAuth client and configure the consent screen. Enable Google Drive API and/or YouTube Data API v3, and set up the correct OAuth scopes and test users or production verification. Save its client ID and secret in Admin. For **TikTok**, register a web app with Login Kit and Content Posting API upload access (`user.info.basic`, `video.upload`), then save its client key and secret. Provider app approval or sandbox/test-user access may be required. Existing server `GOOGLE_*` and `TIKTOK_*` app credentials can supply these registrations instead.
3. Members open **Settings → Integrations**, choose **Connect Google** (Drive and/or YouTube) or **Connect TikTok**, and authorize their own accounts. This does not change the member’s Curiousity login. Curiousity stores each member’s grants separately; it never shares the administrator’s account tokens. Grants from a changed app registration may require reconnecting. Existing per-account app configurations remain usable when still authorized.
4. Review your finished clip and destination before sending. Google saves to My Drive or uploads private YouTube videos. TikTok sends reviewed videos to the selected creator’s inbox for completion in TikTok. Plan limits apply to connected TikTok accounts. You can disconnect in Integrations and revoke access with the provider. Disconnecting does not delete delivered files.

Previously saved Buffer credentials can still create reviewed drafts. If `PUBLIC_ORIGIN` is configured, a Buffer draft can use a generated **3-day media link**; anyone with the link can fetch that MP4 until it expires or the project is deleted. Archived MCP and Buffer connections can be removed in Integrations. `ENABLE_LEGACY_INTEGRATION_API` is only for the older MCP/Buffer setup API and is not required for direct OAuth or n8n.

## Public legal pages

[Terms of Service](https://ai.devzard.online/terms) and [Privacy Policy](https://ai.devzard.online/privacy) are standalone HTML pages. They do not require a login or JavaScript. The documents live in `public/terms/index.html` and `public/privacy/index.html` and are included in the web build and Docker image. Sign-in, sign-up, and the workspace navigation link to them.

After building and restarting the deployed app, verify that the public URLs serve the actual documents, not the app shell or a sign-in redirect:

```sh
curl -fsS https://ai.devzard.online/terms | grep -F '<h1>Terms of Service</h1>'
curl -fsS https://ai.devzard.online/privacy | grep -F '<h1>Privacy Policy</h1>'
```

If you deploy on another domain or change how the service handles data, review the domain, operator contact, and policy text in both documents before publishing them. Forward `/terms` and `/privacy` unchanged if your proxy has custom routing.

## Tests

```sh
npm test
npm run build
```

The suite covers cookie sessions, account isolation, plan limits, library sharing, model profiles, Reach, and reviewed delivery. FFmpeg tests render real clips and captioned MP4s, check caption pixels and picture/audio duration, test independent live/caption workers and re-styling, and exercise same-broadcast replay. Network fixtures check the actual visual model payload, per-member OAuth and replay protection, and n8n review/execution without contacting real YouTube, model, workflow, or social accounts.
