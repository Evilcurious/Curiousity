# Clipforge

Clipforge is a single-user, self-hosted studio for clipping YouTube videos and livestreams you have permission to use. Pick **1, 3, 4, 5, 10** clips or a custom count up to 20, then review the highest-scored moments. Download H.264 MP4s, optional burned captions, and SRT files. Use **Try demo** for a full render without YouTube or an API key.

## Run locally — no Docker required

Install **Node.js 22.13+** and **Python 3.10+**. On Debian/Ubuntu, `sudo apt install git python3-venv ffmpeg fontconfig fonts-dejavu-core` provides the system tools and base fonts. On Windows, run `wsl --install -d Ubuntu`, then use the Ubuntu terminal for the commands below (not PowerShell). Install Node.js and the prerequisites inside WSL.

```sh
git clone --branch arena/e2b88358-curiousity --single-branch https://github.com/Evilcurious/Curiousity.git clipforge
cd clipforge
npm ci
npm run setup
npm run dev
```

Open <http://localhost:5173>. If you already cloned this branch, stop the running server, run `git pull --ff-only origin arena/e2b88358-curiousity` from the checkout, rerun `npm ci` and `npm run setup`, then start it again. Your workspace stays in `.clipforge/`.

`npm run setup` installs or updates yt-dlp, its JavaScript support, and faster-whisper in `.venv`. It installs a portable FFmpeg if it can't find a system build and a wheel is available. It does **not** create developer accounts or provide API keys. Use `npm run setup -- --no-whisper` if you only need source captions or remote transcription.

Local Whisper downloads model weights from Hugging Face on first use. To fetch them ahead of time, run `npm run setup -- --download-model`. `WHISPER_MODEL` defaults to `base`; `tiny` is faster on a small CPU. It can also point to a local faster-whisper/CTranslate2 model directory. Restart Clipforge after changing tools. The **Setup Guide** shows which tools are detected.

## Deploy on a VPS

Install the same prerequisites. Set a strong `AUTH_PASSWORD` in `.env`, then build and run the Node service:

```sh
cp .env.example .env
# Edit .env to set AUTH_PASSWORD (and optionally AUTH_USER).
npm ci
npm run setup
npm run build
npm start
```

Use a process manager such as systemd to keep `npm start` running. Keep port 5173 private and put it behind an HTTPS reverse proxy that preserves the original `Host` header. For example, with Caddy and a domain pointing to your VPS:

```caddyfile
clips.example.com {
    reverse_proxy 127.0.0.1:5173
}
```

Don't expose `npm run dev` to the internet. Clipforge needs a persistent Node worker, FFmpeg, and writable storage; it is not a static or serverless site. Docker Compose is optional: set `AUTH_PASSWORD` in `.env` and run `docker compose up -d --build` if you prefer a container. Compose binds to `127.0.0.1:5173`; set `CLIPFORGE_PORT` to change that port.

Run one instance per data directory. Back up `.clipforge/` (or `DATA_DIR` / the Docker `/data` volume), **including `.key`**. The encryption key lives alongside the encrypted credentials; protect both and restrict access to `.env`. `MAX_SOURCE_MINUTES` defaults to 180 and `MAX_SOURCE_MB` to 2048. Temporary media is removed after a job; delete old projects from the library to reclaim export space.

## YouTube sources and live capture

- **Auto-detect** handles video URLs, completed replays, and active streams. **Video / replay** refuses a still-running live feed. **Live monitor** requires one. To capture a channel that's live now, use its YouTube `/live` link or the stream's watch URL.
- Choose a **Live capture limit** (2, 5, 10, 15, or 30 minutes, capped by your server setting). Clipforge starts near the live edge and analyzes that window when recording ends. Click **Analyze now** once at least 6 seconds have been saved to use a shorter window. **Stop project** cancels and discards the recording.
- Capture tries the available public HLS variants, including separate video/audio and master playlists, then checks for alternative formats such as DASH. If an HLS stream only offers video, Clipforge can clip it without audio and will say so. It cannot guarantee capture of every broadcast. YouTube may reject media requests, especially on some VPS IPs, or may not expose a compatible feed. Update yt-dlp with `npm run setup`; if the error persists, try the replay after it becomes available. Clipforge does not bypass private, regional, login, or other access restrictions.
- Analysis uses timestamped speech, audio activity, and replay heatmaps when available. Scores estimate relative highlight strength, not views or virality. Short sources may yield fewer distinct clips than requested.

## Export formats and languages

- **Platform preset** picks the recommended canvas: TikTok, Instagram Reels, Facebook Reels, and YouTube Shorts default to **9:16 (720 × 1280)**; YouTube video defaults to **16:9 (1280 × 720)**. Universal starts at 9:16. Presets are not account connections and do not publish anything. Instagram and Facebook exports are MP4 downloads for manual upload.
- Choose 9:16, 4:5, 1:1, 16:9, or enter a **Custom ratio** such as `3:2`. Use whole-number terms from 1 to 100 between 1:4 and 4:1. Dimensions round to even pixels, with 1280 pixels on the long edge. The original picture stays centered and uncropped over a blurred background when it doesn't match the frame. Check the destination's requirements if overriding a preset.
- **Caption language** can keep original speech or request another language. Clipforge prefers a usable YouTube caption track in the chosen language. If none exists, it can translate the transcript with the active AI chat model; local Whisper also supports speech-to-English translation. Transcription uses original YouTube captions when available, then your chosen speech model or local Whisper. If the requested language cannot be produced, the project reports the fallback and labels the actual caption language. The demo ships English, Urdu, and Spanish tracks.
- **Hashtag language** is separate. Choose a language, **Match source**, or **Off**. Each clip shows copyable suggestions, using local terms and transcript keywords when available in that language. If the source language is unknown or unsupported for tags, **Match source** uses English. Tags aren't claims about what is trending; review them before posting.
- Burning subtitles into the MP4 needs FFmpeg with `libass`. Noto fonts for Urdu/Arabic, Hindi, and Bengali are bundled under the [SIL Open Font License](server/assets/NOTO-FONTS-LICENSE.txt) ([source](https://github.com/notofonts/noto-fonts)). Install fonts for other scripts on the host as needed, e.g. `fonts-noto-cjk` for Chinese, Japanese, and Korean on Debian/Ubuntu. If a font is missing or FFmpeg lacks `libass`, the SRT still contains the caption text.

## AI providers

In **AI Providers**, add a named profile for each key or endpoint. Presets include OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, and Ollama, plus an OpenAI-compatible URL. Use **Fetch models** or type the chat model ID directly, then save and choose **Use model** for highlight ranking and translation. Local analysis needs no key and is used when a remote ranker fails.

Select a separate **Caption engine** for transcription if desired. A remote transcription profile must support `/audio/transcriptions` with timestamped `verbose_json` segments, like OpenAI `whisper-1`. The Ollama base URL must be reachable from the Clipforge server. External providers receive excerpts, cues, or audio as appropriate and may charge for usage. Keep Local analysis and Local Whisper selected to avoid sending this material to AI providers.

## Integrations: the self-hosted connection hub

Use **Integrations** to connect your accounts. Connections belong to this Clipforge instance, not to your browser's other apps. None of them is required to import public YouTube sources, render clips, or download exports.

### Google Drive and YouTube

1. In [Google Cloud Console](https://console.cloud.google.com/), enable the **Google Drive API**, **YouTube Data API v3**, or both. Configure the OAuth consent screen. Add your account as a test user if the app is in Testing.
2. Create a Google OAuth client of type **Web application**. Add `http://localhost:5173/api/google/callback` (local) or `https://clips.example.com/api/google/callback` (VPS) as an authorized redirect URI. Open Clipforge on the **same origin** and enter the client ID, secret, and exact redirect URI under **Integrations → Google**, or set the three `GOOGLE_…` variables in `.env`.
3. Select the permissions you need and click **Connect Google**. Drive uses `drive.file`, which allows access to files created or explicitly opened by the app; Clipforge does not browse your existing files. YouTube uses `youtube.upload` to upload to the authorized channel. Google's scope verification, API quota, and project restrictions still apply. An External app in Testing may require you to reconnect after its refresh token expires.
4. In a finished project use **Send to…**, review the clip, and approve the destination. Drive saves an MP4 to **My Drive** without changing file sharing. YouTube uploads to the authorized channel as a **private video**, with subscriber notifications off; choose the made-for-kids setting during review. The upload's status and link appear on the clip. Public publishing is done separately in YouTube Studio. The demo can go to Drive but not to YouTube or TikTok.

Disconnecting removes local tokens. To revoke the app's permission completely, also remove its access in your Google account. Already uploaded files and videos stay where they were sent.

### TikTok inbox drafts

1. Create a [TikTok developer app](https://developers.tiktok.com/) with Login Kit and the Content Posting API. Request `user.info.basic` and `video.upload`. Approval and platform limits apply; personal utility apps aren't guaranteed access.
2. Register `https://clips.example.com/api/tiktok/callback` and open Clipforge on that same **HTTPS** origin. Save the client key, secret, and callback in **Integrations → TikTok**, or set all three `TIKTOK_…` variables in `.env`. Click **Connect account**.
3. Select the clips on a finished project, then **Review selected**. The studio toggle only preselects them; it never sends them. Confirm you reviewed the batch and accept the music usage terms. Clipforge queues inbox drafts and tracks delivery. Finish editing, add your description and hashtags, and publish in TikTok itself.

Clipforge uses TikTok's [official inbox upload API](https://developers.tiktok.com/doc/content-posting-api-reference-upload-video/). It does not automate public posts or use a TikTok password. Test streaming and account connections on the eventual host with your own authorized sources and credentials.

## Tests

```sh
npm test
npm run build
```

The suite renders real MP4s with FFmpeg, checks their frame dimensions and caption files, records a local split-HLS feed, and tests replay, fallback, and upload flows using mocks and fixtures. It does not contact real YouTube livestreams or social accounts.
