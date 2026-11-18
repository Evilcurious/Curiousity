import { frameFor, languages, platforms, romanUrdu } from '../shared/exports.mjs';
import { captionStyleOptions, resolveCaptionStyle } from '../shared/captions.mjs';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const maxClips = 20;
export const liveLimits = [2, 5, 10, 15, 30];
const videoId = /^[a-zA-Z0-9_-]{11}$/;

export function captionStyleInput(style) {
  if (style !== undefined && (!style || typeof style !== 'object' || Array.isArray(style) || Object.entries(style).some(([key, value]) => !Object.hasOwn(captionStyleOptions, key) || typeof value !== 'string' || !Object.hasOwn(captionStyleOptions[key], value)))) {
    throw new HttpError(400, 'Choose a supported caption font, effect, size and animation.');
  }
  return resolveCaptionStyle(style);
}
export function youtubeSource(raw) {
  let input;
  try { input = new URL(typeof raw === 'string' ? raw.trim() : ''); } catch { /* Report the common message below. */ }
  let id;
  if (input && ['http:', 'https:'].includes(input.protocol) && !input.username && !input.password && !input.port) {
    const parts = input.pathname.split('/').filter(Boolean);
    const host = input.hostname.toLowerCase();
    if (host === 'youtu.be' && parts.length === 1) id = parts[0];
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
      if (parts.length === 1 && parts[0] === 'watch') id = input.searchParams.get('v');
      if (parts.length === 2 && ['shorts', 'live', 'embed', 'v'].includes(parts[0])) id = parts[1];
      if (parts.length === 2 && parts[1] === 'live') {
        let handle;
        try { handle = decodeURIComponent(parts[0]); } catch { /* Malformed URL. */ }
        if (handle && /^@[\p{L}\p{N}._-]{3,40}$/u.test(handle)) return { id: null, url: `https://www.youtube.com/@${encodeURIComponent(handle.slice(1))}/live` };
      }
      if (parts.length === 3 && parts[0] === 'channel' && /^UC[\w-]{22}$/.test(parts[1]) && parts[2] === 'live') return { id: null, url: `https://www.youtube.com/channel/${parts[1]}/live` };
    }
  }
  if (!id || !videoId.test(id)) throw new HttpError(400, 'Enter a link to a single YouTube video or livestream.');
  return { id, url: `https://www.youtube.com/watch?v=${id}` };
}

export function jobOptions(body = {}) {
  const demo = body.demo === true;
  const source = demo ? null : youtubeSource(body.url);
  const count = body.count === 'auto' ? 'auto' : ['string', 'number'].includes(typeof body.count) ? Number(body.count) : NaN;
  if (count !== 'auto' && (!Number.isInteger(count) || count < 1 || count > maxClips)) throw new HttpError(400, `Choose Auto or enter a clip count from 1 to ${maxClips}.`);
  const mode = ['auto', 'recorded', 'live', 'replay'].includes(body.mode) ? body.mode : 'auto';
  const liveMinutes = liveLimits.includes(Number(body.liveMinutes)) ? Number(body.liveMinutes) : 2;
  const platform = body.platform ?? 'universal';
  if (typeof platform !== 'string' || !Object.hasOwn(platforms, platform)) throw new HttpError(400, 'Choose a supported export platform.');
  const frame = frameFor(body.aspectRatio ?? platforms[platform].ratio);
  if (!frame) throw new HttpError(400, 'Enter a ratio like 3:2. Use whole numbers from 1 to 100 and stay between 1:4 and 4:1.');
  const romanCode = (value) => typeof value === 'string' && value.toLowerCase() === 'ur-latn' ? romanUrdu : value;
  const captionLanguage = romanCode(body.captionLanguage ?? 'source');
  const hashtagLanguage = romanCode(body.hashtagLanguage ?? 'source');
  if (captionLanguage !== 'source' && (typeof captionLanguage !== 'string' || !Object.hasOwn(languages, captionLanguage))) throw new HttpError(400, 'Choose a supported caption language.');
  if (!['source', 'off'].includes(hashtagLanguage) && (typeof hashtagLanguage !== 'string' || !Object.hasOwn(languages, hashtagLanguage))) throw new HttpError(400, 'Choose a supported hashtag language.');
  const captionStyle = captionStyleInput(body.captionStyle);
  const aiProfile = demo ? 'local' : body.aiProfile ?? 'workspace';
  if (typeof aiProfile !== 'string' || (!['workspace', 'local'].includes(aiProfile) && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(aiProfile))) {
    throw new HttpError(400, 'Select a saved AI profile, Workspace default, or Local analysis.');
  }
  return { demo, ...source, count, mode, liveMinutes, captions: body.captions !== false, tiktok: !demo && body.tiktok === true,
    platform, aspectRatio: frame.ratio, captionLanguage, hashtagLanguage, captionStyle, aiProfile };
}

export function text(value, max, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, max) : fallback;
}
