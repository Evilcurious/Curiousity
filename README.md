# Curiousity

Curiousity is a self-hosted studio for turning YouTube videos and livestreams you have permission to use into shareable H.264 clips. Preview and download MP4s and SRT subtitles, use private AI and delivery connections, and reuse clips that other members have shared. **Try demo** runs a full export without YouTube or an API key.

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

If upgrading a clone on this branch, stop the running server, back up as above, run `git pull --ff-only origin arena/e2b88358-curiousity`, then `npm ci`, `npm run setup`, the admin command, and restart. On a normal startup after provisioning, **no admin password environment variable is needed**.

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

If sign-in still reports an HTTPS error, check the public route without submitting a password:

```sh
curl -fsS https://clips.example.com/api/auth/session
```

The response should contain `"passwordTransport":"https"`. A `blocked` or `local` result at the public URL means the app is not seeing a trusted TLS connection. Verify the proxy forwards a single `X-Forwarded-Proto: https` on actual TLS requests, connects to `127.0.0.1` for `TRUST_PROXY=loopback`, and that the app picked up the setting. If a CDN sits in front of Nginx, use TLS from the CDN to the VPS as well; don't hard-code the forwarded scheme. If one trusted proxy connects over a private non-loopback network (for example the Compose HTTPS overlay), use `TRUST_PROXY=1` instead. Never enable proxy trust on a public backend port.

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

Use one app process per data directory. Back up `.clipforge/` (or `DATA_DIR` / the Docker `/data` volume) **including `.key`**. The key lives alongside encrypted integration credentials; protect access to both, and to `.env` and backups. `MAX_SOURCE_MINUTES` defaults to 180 and `MAX_SOURCE_MB` to 2048. Temporary working media is removed after a job; delete old projects to reclaim export space. Saved library copies keep their media even after the original is removed.

## Accounts, themes, and the Clip Library

- **Settings → Appearance** offers 14 themes. Choose a personal palette or **Use workspace default**. The administrator sets the default theme and uploads or restores the workspace logo under **Settings → Admin**.
- A finished project is private until its owner opens it and chooses **Share to library → Share exports**. Only share media and captions other members have permission to reuse. Shared listings include rendered exports and metadata such as clip title and duration, not project controls, source links, or connections.
- In **Clip Library → Shared clips**, any signed-in member can preview, download, and select **Save to my projects** to keep a private reusable export. This does not include the original full source or delivery settings. The owner can stop sharing and the administrator can unlist the exports without deleting the project. Copies already saved or downloaded are not recalled. Only the original project can re-list its exports.

## YouTube sources and live capture

- **Auto-detect** handles video URLs, completed replays, and active streams. **Video / replay** refuses a still-running live feed. **Live monitor** requires one. To capture a channel that's live now, use its YouTube `/live` link or the stream's watch URL.
- Choose a **Live capture limit** (2, 5, 10, 15, or 30 minutes, capped by your server setting). Curiousity starts near the live edge and analyzes that window when recording ends. Click **Analyze now** once at least 6 seconds have been saved to use a shorter window. **Stop project** cancels and discards the recording.
- Capture tries the available public HLS variants, including separate video/audio and master playlists, then checks for alternative formats such as DASH. If an HLS stream only offers video, Curiousity can clip it without audio and will say so. It cannot guarantee capture of every broadcast. YouTube may reject media requests, especially on some VPS IPs, or may not expose a compatible feed. Update yt-dlp with `npm run setup`; if the error persists, try the replay after it becomes available. Curiousity does not bypass private, regional, login, or other access restrictions.
- Analysis uses timestamped speech, audio activity, and replay heatmaps when available. Scores estimate highlight strength, not views or virality. **Auto** under **Number of clips** keeps strong, non-overlapping highlights (up to 20). If nothing stands out, it returns only the best available moment and says so. This is separate from source-mode Auto-detect. Fixed and custom counts still work; a short source may yield fewer clips than requested.

## Export formats and languages

- **Platform preset** picks the recommended canvas: TikTok, Instagram Reels, Facebook Reels, and YouTube Shorts default to **9:16 (720 × 1280)**; YouTube video defaults to **16:9 (1280 × 720)**. Universal starts at 9:16. Presets are not account connections and do not publish anything. Exported MP4s can be uploaded manually, or sent as reviewed video drafts using a compatible Buffer channel.
- Choose 9:16, 4:5, 1:1, 16:9, or enter a **Custom ratio** such as `3:2`. Use whole-number terms from 1 to 100 between 1:4 and 4:1. Dimensions round to even pixels, with 1280 pixels on the long edge. The original picture stays centered and uncropped over a blurred background when it doesn't match the frame. Check the destination's requirements if overriding a preset.
- **Caption language** can keep original speech or request another language. Curiousity prefers a usable YouTube caption track in the chosen language. If none exists, it can translate the transcript with the project’s AI chat model; local Whisper also supports speech-to-English translation. Transcription uses original YouTube captions when available, then your chosen speech model or local Whisper. If the requested language cannot be produced, the project reports the fallback and labels the actual caption language. The demo ships English, Urdu, Roman Urdu, and Spanish tracks.
- **Roman Urdu** is Urdu written in Latin letters, separate from Urdu script. Curiousity uses an available Roman Urdu track, asks your selected chat model to romanize or translate cues, or converts available Urdu text locally without a key. Local spellings are approximate, especially for names and omitted vowels. For other source languages with neither a usable Urdu track nor an AI chat model, Curiousity keeps the original captions and reports that fallback.
- **Caption style → Customize** previews the font, size and effect. Choose an entrance or cue effect (Fade in, Pop, Rise, or Word highlight) and an optional exit (Fade out or Shrink out). Word highlight estimates timing within each cue; it is not word-level speech alignment. These choices burn into the MP4, not the SRT. To try them without a key, choose **Auto**, **Roman Urdu**, and a style, then click **Try demo** in Studio.
- **Hashtag language** is separate. Choose a language, **Match source**, or **Off**. Each clip shows copyable suggestions, using local terms and transcript keywords when available in that language. If the source language is unknown or unsupported for tags, **Match source** uses English. Tags aren't claims about what is trending; review them before posting.
- Burning subtitles into the MP4 needs FFmpeg with `libass`. [DejaVu sans, serif and mono](server/assets/DEJAVU-FONTS-LICENSE.txt) are bundled for Latin-script styles. Curiousity uses bundled [Noto fonts](server/assets/NOTO-FONTS-LICENSE.txt) for Arabic/Urdu script, Hindi, and Bengali so the text remains readable. Install fonts for other scripts on the host as needed, e.g. `fonts-noto-cjk` for Chinese, Japanese, and Korean on Debian/Ubuntu. If a font is missing or FFmpeg lacks `libass`, the SRT still contains the caption text.

## AI providers

In **Settings → AI Providers → Add provider**, save a named profile for each key, model or endpoint. There is no fixed profile count limit, and you can save several profiles for the same service. Search or filter the list to find them. Presets cover OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, DeepSeek, Mistral AI, xAI, Fireworks AI, Cerebras, NVIDIA NIM, Ollama, and LM Studio, plus a custom OpenAI-compatible endpoint. Use **Fetch models** or type a supported chat model ID directly. Choose **Use model** to set your default chat model, or choose a profile under **AI engine** in Studio to override it for that project’s highlight ranking and caption translation. Local analysis needs no key and is used when a remote ranker fails.

Select a separate **Caption engine** for transcription if desired. A remote transcription profile must support `/audio/transcriptions` with timestamped `verbose_json` segments, like OpenAI `whisper-1`. Member endpoints must use public HTTPS on port 443 and include the provider’s API path (often `/v1`). Only the host administrator can configure a loopback AI endpoint, such as LM Studio or Ollama on the server; the browser never calls it directly. Private and reserved addresses and redirects are blocked on outbound member connections. API keys are encrypted at rest; a saved key isn’t reused when an editable endpoint changes. External providers receive excerpts, cues, or audio as appropriate and may charge for usage. Keep Local analysis and Local Whisper selected to avoid sending this material to AI providers.

### Premium AI

From **Settings → Account**, a member can request Premium. The administrator sees the request in **Settings → Admin** and can grant or remove access. From **Settings → AI Providers**, the administrator then chooses **Share to premium** on specific chat profiles. Premium members can select those models in Studio or set one as their default. They cannot see the endpoint or key, edit the profile, run its model catalog, or use it for transcription. Admin MCP servers and delivery accounts are never shared. Removing a member’s access or unsharing a provider blocks new uses immediately; an already-running model call may finish. The administrator pays any model usage charges. `PREMIUM_DAILY_JOBS` defaults to 10 projects per Premium member per UTC day for shared AI. Demo projects always use the bundled tracks and local analysis.

## Integrations and MCP

Open **Settings → Integrations** for destination accounts, or **Settings → MCP servers** to add MCP connections. All connections are private to the Curiousity account that saved them. No connection is required to render or download a clip. For Google or TikTok OAuth, open Curiousity in its own browser tab at the exact redirect origin; the provider’s login page may not work in an embedded preview.

### Buffer drafts via MCP

1. Create a [personal Buffer API key](https://publish.buffer.com/settings/api) for an account with the organization and channel you want to use. In **Settings → MCP servers**, choose **Connect Buffer** and paste the key. **Discover tools** tests the connection to Buffer’s [official MCP endpoint](https://developers.buffer.com/guides/integrations/mcp.md). The tool explorer supports Buffer reads, not publishing or scheduling.
2. Open a finished project and click **Buffer draft** on a clip. Choose the connection, organization, and a supported channel. Review the destination, video, and post text. Some channels require extra metadata (e.g. YouTube title and made-for-kids choice); Buffer still enforces its own limits and permissions.
3. With `PUBLIC_ORIGIN` configured on an internet-reachable HTTPS host, Curiousity can attach its own MP4 using an unguessable **3-day media link**. **Anyone with that link can fetch that MP4 while it is valid.** Do not share the URL separately. Without a public host, paste a direct HTTPS URL to the MP4 you reviewed. Buffer fetches the video from that URL without your Curiousity session, so the link must be reachable from Buffer’s servers. Removing the local project invalidates its temporary links.
4. Confirm and click **Create Buffer draft**. Curiousity calls `create_post` with `saveToDraft: true` and verifies the returned draft status. It does not schedule or publish. If a result comes back unconfirmed, check Buffer before creating another draft. Removing a connection locally does not revoke its API key at Buffer or delete existing drafts.

### Custom MCP servers

Choose **Add MCP server**, give it a name, and enter a public `https://…` Streamable HTTP endpoint and optional bearer token. **Discover tools** shows the tool catalog. Select a tool, check its JSON schema, enter the arguments as a JSON object, and approve each call. This supports JSON and SSE responses from Streamable HTTP servers, not old SSE-only transports, local commands/stdio, or browser OAuth for arbitrary MCP servers. Tool calls are manual; AI models cannot invoke them or read their results. Use servers you trust: approved tools may read or change data in the remote account.

### Google Drive and YouTube

1. In [Google Cloud Console](https://console.cloud.google.com/), enable the **Google Drive API**, **YouTube Data API v3**, or both. Configure the OAuth consent screen. Add your account as a test user if the app is in Testing.
2. Create a Google OAuth client of type **Web application**. Add `http://localhost:5173/api/google/callback` (local) or `https://clips.example.com/api/google/callback` (VPS) as an authorized redirect URI. Open Curiousity on the **same origin** and enter the client ID, secret, and exact redirect URI under **Settings → Integrations → Google**. The three `GOOGLE_…` environment options are for the administrator’s connection only.
3. Select the permissions you need and click **Connect Google**. Drive uses `drive.file`, which allows access to files created or explicitly opened by the app; Curiousity does not browse your existing files. YouTube uses `youtube.upload` to upload to the authorized channel. Google's scope verification, API quota, and project restrictions still apply. An External app in Testing may require you to reconnect after its refresh token expires.
4. In a finished project use **Send to…**, review the clip, and approve the destination. Drive saves an MP4 to **My Drive** without changing file sharing. YouTube uploads to the authorized channel as a **private video**, with subscriber notifications off; choose the made-for-kids setting during review. The upload's status and link appear on the clip. Public publishing is done separately in YouTube Studio. The demo can go to Drive but not to YouTube or TikTok.

Disconnecting removes local tokens. To revoke the app's permission completely, also remove its access in your Google account. Already uploaded files and videos stay where they were sent.

### TikTok inbox drafts

1. Create a [TikTok developer app](https://developers.tiktok.com/) with Login Kit and the Content Posting API. Request `user.info.basic` and `video.upload`. Approval and platform limits apply; personal utility apps aren't guaranteed access.
2. Register `https://clips.example.com/api/tiktok/callback` and open Curiousity on that same **HTTPS** origin. Save the client key, secret, and callback in **Settings → Integrations → TikTok**. The three `TIKTOK_…` environment options are for the administrator’s connection only. Click **Connect account**.
3. Select the clips on a finished project, then **Review selected**. The studio toggle only preselects them; it never sends them. Confirm you reviewed the batch and accept the music usage terms. Curiousity queues inbox drafts and tracks delivery. Finish editing, add your description and hashtags, and publish in TikTok itself.

Curiousity uses TikTok's [official inbox upload API](https://developers.tiktok.com/doc/content-posting-api-reference-upload-video/). It does not automate public posts or use a TikTok password. Test streaming and account connections on the eventual host with your own authorized sources and credentials.

## Tests

```sh
npm test
npm run build
```

The suite covers cookie sessions and legacy admin migration, account isolation, Premium authorization, shared video downloads and reusable copies, and Streamable HTTP/Buffer behavior against mock responses. It also renders real MP4s with FFmpeg, checks frame dimensions and caption pixels, records local HLS/DASH fixtures, and tests Google and TikTok flows with mocks. It does not contact real YouTube broadcasts or social accounts.
