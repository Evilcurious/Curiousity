# Clipforge

Clipforge is a single-user, self-hosted studio for turning authorized YouTube videos and livestreams into vertical clips. Paste a link, select **1, 3, 4, 5, 10**, or a custom count up to 20, and review the best candidate moments. Clips export as **720 × 1280 H.264/AAC MP4s**, with optional burned captions and downloadable SRT files. Try **Run demo** for the complete render flow without a YouTube request or API key.

## Run locally

Install **Node.js 22.13+**, **Python 3.10+** with `venv`, and fonts suitable for your caption languages. On Debian/Ubuntu, install `python3-venv`, `ffmpeg`, `fontconfig`, and `fonts-dejavu-core` (plus other language fonts as needed). On Windows, use WSL or Docker Desktop.

```sh
npm ci
npm run setup
npm run dev
```

Open <http://localhost:5173>. The setup command installs yt-dlp, its JavaScript support, and faster-whisper in `.venv`. It installs a portable FFmpeg build if FFmpeg is not on your `PATH` and a wheel is available for your platform. It does **not** provision paid service accounts or API keys. For a lighter installation with source captions or remote transcription only, run `npm run setup -- --no-whisper`.

Whisper model weights download from Hugging Face on first use. To fetch them now, run `npm run setup -- --download-model`. `WHISPER_MODEL` defaults to `base`; `tiny` is faster on a small CPU. You can also point `WHISPER_MODEL` at a directory containing a faster-whisper/CTranslate2 model. Restart Clipforge after installing or upgrading tools. The **Setup Guide** page shows tool checks.

## Deploy on a VPS

### With Docker Compose

```sh
cp .env.example .env
# Edit .env and set a strong AUTH_PASSWORD (and optionally AUTH_USER).
docker compose up -d --build
```

Compose maps the app to `127.0.0.1:5173` on the VPS. Set `CLIPFORGE_PORT` if that port is occupied. Put it behind a TLS reverse proxy or access it over a private network. Don't expose the app port directly to the internet. For example, on a VPS with Caddy and a domain pointing to the server:

```caddyfile
clips.example.com {
    reverse_proxy 127.0.0.1:5173
}
```

### Without Docker

Install the local prerequisites, set `AUTH_PASSWORD` in `.env`, then run:

```sh
npm ci
npm run setup
npm run build
npm start
```

Use a process manager such as systemd to keep `npm start` running and a reverse proxy that preserves the original `Host` header. Don't expose `npm run dev` on a public server. Clipforge is a persistent Node and FFmpeg worker, not a static site or a serverless function.

Run one instance per data directory. The app keeps project state, clips, and encrypted credentials in `.clipforge/` by default (the Docker named volume mounts at `/data`). Back up the directory **including `.key`**, and restrict access to it and `.env`. The encryption key lives alongside the encrypted settings, so filesystem access to both defeats that encryption. Use a VPS with enough disk for sources and exports. `MAX_SOURCE_MINUTES` defaults to 180 and `MAX_SOURCE_MB` to 2048. Temporary source downloads are removed after each job; delete old projects in the library to reclaim clip storage.

## Source and highlight behavior

- **Auto-detect** handles video URLs, completed replays, and active YouTube streams. **Video / replay** refuses an ongoing broadcast; **Live monitor** requires one.
- Live monitor captures from the live edge of a supported public HLS rendition. It records for 2–30 minutes, or until you click **Analyze now**, then scores and renders the captured window. Auto-detect uses a short 2-minute window by default. It does not wait for the whole broadcast to finish or continuously post all day.
- Analysis uses timestamped speech, audio activity, and YouTube replay heatmaps when available—not private engagement metrics. Scores estimate how strong a highlight is relative to the signals available; they do not predict view counts or guarantee anything will go viral. Too-short sources can produce fewer distinct clips than requested.
- Clipforge tries usable source captions first. If none are available it uses your selected transcription engine, defaulting to local Whisper. If speech recognition is unavailable or there is no speech, video exports can still complete without captions and will show a warning. A build of FFmpeg without `libass` can export SRT but cannot burn subtitles into the MP4.
- YouTube can restrict downloads, including from some data-center IPs; streams may also lack a compatible public rendition. Use content you own or have permission to download, edit, and share, in line with the platforms’ terms. Clipforge does not bypass account, regional, private, or other access restrictions. Update yt-dlp by rerunning `npm run setup`.

## AI providers

In **AI Providers**, add a named profile for each key or endpoint. Supported presets include OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, and Ollama, plus any OpenAI-compatible API with `/models` and `/chat/completions`. Use **Fetch models** or enter a chat model ID, save, and choose **Use model**. The built-in local analysis needs no key and is used when a remote ranker fails.

Select a separate **Caption engine** if desired. A remote transcription profile must support `/audio/transcriptions` with timestamped segments in `verbose_json` (for example, OpenAI `whisper-1`). Ollama runs separately; its base URL must be reachable from the Clipforge server, not just the browser. In Docker, use its service name on a shared network if both are containers. External model providers receive transcript excerpts or audio as appropriate and may charge for usage. Use the local engines if you do not want media sent to an AI service.

## TikTok draft uploads

1. Create a [TikTok developer app](https://developers.tiktok.com/) with Login Kit and the Content Posting API. Request the `user.info.basic` and `video.upload` scopes for the creator you're connecting. Approval and platform limits apply; personal utility apps aren't guaranteed access.
2. Register `https://your-domain.example/api/tiktok/callback` in the app. Open Clipforge on **that same HTTPS domain** and save the client key, client secret, and callback in **Integrations**, then select **Connect account**. You can also set all three `TIKTOK_…` values in `.env`. HTTP localhost works for clipping, but TikTok authorization needs an HTTPS callback.
3. In a finished project, select the clips you want to send. The studio toggle can preselect them for you. **Review and send** opens a preview and consent form; after approval Clipforge uploads the batch in the background and tracks delivery. Once sent, open the inbox notification in TikTok to finish editing and publishing.

Clipforge uses the [official inbox upload API](https://developers.tiktok.com/doc/content-posting-api-reference-upload-video/). It doesn't automate public posts or use a user's TikTok password. YouTube, AI, and TikTok access should be tested on the eventual host with your own account and credentials.

## Tests

```sh
npm test
npm run build
```

The test suite uses local fixtures and mocks for external APIs. With FFmpeg installed, it also renders a demo clip and checks the resulting MP4, caption export, and download behavior.
