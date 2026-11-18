import { createHash, randomBytes } from 'node:crypto';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { HttpError, text } from './validation.mjs';
import { jobDir } from './store.mjs';

const tokenUrl = 'https://oauth2.googleapis.com/token';
const authorizer = 'https://accounts.google.com/o/oauth2/v2/auth';
export const googleScopes = Object.freeze({ drive: 'https://www.googleapis.com/auth/drive.file', youtube: 'https://www.googleapis.com/auth/youtube.upload' });
export const googleUploadTargets = Object.freeze({
  drive: { label: 'Google Drive', endpoint: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id' },
  youtube: { label: 'YouTube', endpoint: 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=false' },
});
const chunkBytes = 4 * 1024 * 1024;
const active = new Set(['queued', 'uploading']);
export const googleUploadActive = (clip) => Object.values(clip.googleUploads || {}).some((item) => active.has(item.state));
export const publicGoogleUploads = (uploads) => Object.fromEntries(Object.entries(uploads || {}).map(([target, item]) => [target, { state: item.state, link: item.link, reason: item.reason }]));

function redirectUrl(raw) {
  let url;
  try { url = new URL(text(raw, 500)); } catch { /* Inform the user below. */ }
  const loopback = url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!url || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.pathname !== '/api/google/callback' || url.username || url.password || url.search || url.hash) {
    throw new HttpError(400, 'Use HTTPS or HTTP localhost and end the Google redirect URL in /api/google/callback.');
  }
  return url;
}

async function request(url, options = {}, timeout = 28_000) {
  try { return await fetch(url, { redirect: 'error', ...options, signal: AbortSignal.timeout(timeout) }); }
  catch { throw new HttpError(502, 'Could not reach Google. Check this server’s outbound connection.'); }
}
async function jsonResponse(response) {
  const body = await response.json().catch(() => null);
  if (response.ok && body) return body;
  const code = typeof body?.error === 'string' ? body.error : body?.error?.errors?.[0]?.reason;
  const why = /^[a-z0-9_]{1,60}$/i.test(code || '') ? ` (${code})` : '';
  throw new HttpError(502, `Google rejected the request: HTTP ${response.status}${why}. Check account permissions and enabled APIs.`);
}
const exchange = async (args) => jsonResponse(await request(tokenUrl, { method: 'POST', body: new URLSearchParams(args) }));

function uploadSession(value) {
  let url;
  try { url = new URL(value); } catch { /* Invalid location. */ }
  const trusted = ['www.googleapis.com', 'content.googleapis.com', 'youtube.googleapis.com', 'upload.youtube.com', 'upload.google.com'];
  if (!url || url.protocol !== 'https:' || url.port || url.username || url.password || !trusted.includes(url.hostname)) {
    throw new HttpError(502, 'Google returned an invalid upload location.');
  }
  return url.href;
}

class DeliveryUnknown extends HttpError {
  constructor(target) { super(502, `Delivery was not confirmed. Check ${googleUploadTargets[target].label} before trying another upload.`); }
}

async function transferFile({ target, path, token, metadata }) {
  const file = await open(path, 'r');
  try {
    const size = (await file.stat()).size;
    if (!size || size > 1024 * 1024 * 1024) throw new HttpError(400, 'This MP4 is outside the workspace upload size limit.');
    const init = await request(googleUploadTargets[target].endpoint, { method: 'POST', headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/mp4',
    }, body: JSON.stringify(metadata) });
    if (!init.ok) await jsonResponse(init);
    const session = uploadSession(init.headers.get('location'));
    await init.body?.cancel();
    let offset = 0, probe = false, failures = 0;
    while (failures < 3) {
      let buffer;
      if (!probe) {
        buffer = Buffer.alloc(Math.min(chunkBytes, size - offset));
        if (!buffer.length) throw new DeliveryUnknown(target);
        const result = await file.read(buffer, 0, buffer.length, offset);
        if (result.bytesRead !== buffer.length) throw new HttpError(500, 'The clip changed during upload.');
      }
      let response;
      try {
        response = await request(session, { method: 'PUT', redirect: 'manual', headers: {
          Authorization: `Bearer ${token}`, 'Content-Type': 'video/mp4', 'Content-Length': String(buffer?.length || 0),
          'Content-Range': probe ? `bytes */${size}` : `bytes ${offset}-${offset + buffer.length - 1}/${size}`,
        }, body: buffer }, 120_000);
      } catch {
        failures++;
        probe = true;
        await pause(failures * 250);
        continue;
      }
      if (response.ok) {
        const payload = await response.json().catch(() => null);
        if (!/^[a-zA-Z0-9_-]{1,220}$/.test(payload?.id || '')) throw new DeliveryUnknown(target);
        return target === 'drive' ? `https://drive.google.com/file/d/${payload.id}/view` : `https://studio.youtube.com/video/${payload.id}/edit`;
      }
      if (response.status === 308) {
        const match = response.headers.get('range')?.match(/^bytes=0-(\d+)$/i);
        const next = match ? Number(match[1]) + 1 : 0;
        await response.body?.cancel();
        if (!Number.isSafeInteger(next) || next < offset || next > size) throw new DeliveryUnknown(target);
        failures = next > offset ? 0 : failures + 1;
        offset = next;
        probe = offset === size;
        continue;
      }
      if ([408, 429, 500, 502, 503, 504].includes(response.status)) {
        await response.body?.cancel();
        failures++;
        probe = true;
        await pause(failures * 250);
        continue;
      }
      if (probe) { await response.body?.cancel(); throw new DeliveryUnknown(target); }
      await jsonResponse(response);
    }
    throw new DeliveryUnknown(target);
  } finally { await file.close(); }
}

export function createGoogle(store, { useEnv = true, background = true } = {}) {
  const state = store.state.google ||= {};
  const envConfig = useEnv && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI
    ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, redirectUri: process.env.GOOGLE_REDIRECT_URI } : null;
  const config = () => envConfig || (state.config && { ...state.config, clientSecret: store.unseal(state.config.clientSecret) });
  const fingerprint = () => createHash('sha256').update(JSON.stringify(config() || null)).digest('hex');
  const currentAccount = () => state.account?.configId === fingerprint() ? state.account : null;
  const pending = new Map();
  let revision = 0, working = false;

  function describe() {
    const configured = envConfig || state.config;
    const account = currentAccount();
    return { configured: Boolean(configured), managedByEnv: Boolean(envConfig), clientId: configured?.clientId || '', redirectUri: configured?.redirectUri || '', connected: Boolean(account),
      account: account ? { id: account.id, name: account.name } : null, grants: Object.fromEntries(Object.keys(googleScopes).map((target) => [target, Boolean(account?.targets.includes(target))])) };
  }
  function configure(body) {
    if (envConfig) throw new HttpError(409, 'Google integration is configured with environment variables.');
    const clientId = text(body.clientId, 300), secret = text(body.clientSecret, 500);
    if (!clientId || (!secret && state.config?.clientId !== clientId)) throw new HttpError(400, 'Enter the Google OAuth client ID and secret.');
    const redirect = redirectUrl(body.redirectUri);
    const before = fingerprint();
    state.config = { clientId, clientSecret: secret ? store.seal(secret) : state.config.clientSecret, redirectUri: redirect.href };
    if (before !== fingerprint()) { delete state.account; pending.clear(); revision++; }
    store.save();
    return describe();
  }
  function connect(targets, origin) {
    const creds = config();
    if (!creds) throw new HttpError(409, 'Save your Google OAuth app settings first.');
    const selected = [...new Set(Array.isArray(targets) ? targets.filter((target) => typeof target === 'string' && Object.hasOwn(googleScopes, target)) : [])];
    if (!selected.length) throw new HttpError(400, 'Select Google Drive, YouTube, or both.');
    const redirect = redirectUrl(creds.redirectUri);
    if (origin && origin !== redirect.origin) throw new HttpError(400, `Open Curiousity at ${redirect.origin} to start this Google sign-in.`);
    for (const [id, entry] of pending) if (entry.expiry < Date.now()) pending.delete(id);
    if (pending.size >= 30) throw new HttpError(429, 'Too many pending sign-ins. Wait a few minutes and try again.');
    const id = randomBytes(24).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    pending.set(id, { expiry: Date.now() + 10 * 60_000, verifier, configId: fingerprint(), revision, selected });
    const url = new URL(authorizer);
    url.search = new URLSearchParams({ client_id: creds.clientId, redirect_uri: redirect.href, response_type: 'code', access_type: 'offline', prompt: 'consent select_account',
      scope: ['openid', 'profile', ...selected.map((target) => googleScopes[target])].join(' '), state: id, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }).toString();
    return { url: url.href, state: id, secure: redirect.protocol === 'https:' };
  }
  async function callback(query) {
    const id = text(query.state, 100), entry = pending.get(id);
    pending.delete(id);
    if (!entry || entry.expiry < Date.now() || entry.configId !== fingerprint() || entry.revision !== revision) throw new HttpError(400, 'The Google sign-in expired. Connect again from Integrations.');
    const code = text(query.code, 2500);
    if (!code || query.error) throw new HttpError(400, 'Google sign-in was cancelled or declined.');
    const creds = config();
    const token = await exchange({ code, code_verifier: entry.verifier, grant_type: 'authorization_code', client_id: creds.clientId, client_secret: creds.clientSecret, redirect_uri: creds.redirectUri });
    const granted = new Set((token.scope || '').split(/\s+/));
    const targets = entry.selected.filter((target) => granted.has(googleScopes[target]));
    if (!targets.length || !token.access_token || !token.refresh_token) throw new HttpError(400, 'Grant at least one selected permission and allow offline access, then connect again.');
    const profile = await jsonResponse(await request('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } }));
    if (typeof profile.sub !== 'string' || !profile.sub) throw new HttpError(502, 'Google did not identify the connected account.');
    if (entry.configId !== fingerprint() || entry.revision !== revision) throw new HttpError(409, 'Google settings changed. Connect again from Integrations.');
    state.account = { id: String(profile.sub), name: text(profile.name, 100) || 'Google account', targets, configId: entry.configId,
      access: store.seal(token.access_token), refresh: store.seal(token.refresh_token), expiry: Date.now() + Number(token.expires_in || 0) * 1000 };
    store.save();
  }
  function disconnect() {
    delete state.account; pending.clear(); revision++;
    store.save();
  }
  async function tokenFor(item, target) {
    const account = currentAccount(), creds = config();
    if (!account || account.id !== item.accountId || account.configId !== item.configId || !account.targets.includes(target)) throw new HttpError(409, 'Connect the Google account and grant the same destination again.');
    if (account.expiry > Date.now() + 120_000) return store.unseal(account.access);
    const token = await exchange({ grant_type: 'refresh_token', refresh_token: store.unseal(account.refresh), client_id: creds.clientId, client_secret: creds.clientSecret });
    if (!token.access_token || currentAccount() !== account) throw new HttpError(409, 'Reconnect Google to continue.');
    if (token.scope && !token.scope.split(/\s+/).includes(googleScopes[target])) throw new HttpError(409, 'Reconnect Google and grant upload permission for this destination.');
    account.access = store.seal(token.access_token);
    if (token.refresh_token) account.refresh = store.seal(token.refresh_token);
    account.expiry = Date.now() + Number(token.expires_in || 0) * 1000;
    store.save();
    return token.access_token;
  }
  async function tick() {
    if (working) return;
    working = true;
    try {
      for (const job of [...store.state.jobs].reverse()) for (const clip of job.clips || []) for (const [target, item] of Object.entries(clip.googleUploads || {})) {
        if (item.state !== 'queued') continue;
        item.state = 'uploading'; store.save();
        try {
          const token = await tokenFor(item, target);
          const metadata = target === 'drive' ? { name: `${item.title}.mp4`, description: item.description, mimeType: 'video/mp4' }
            : { snippet: { title: item.title, description: item.description, categoryId: '22' }, status: { privacyStatus: 'private', selfDeclaredMadeForKids: item.madeForKids } };
          item.link = await transferFile({ target, path: join(jobDir(job.id), clip.id, 'video.mp4'), token, metadata });
          item.state = 'sent';
        } catch (error) {
          item.state = error instanceof DeliveryUnknown ? 'unconfirmed' : 'failed';
          item.reason = error instanceof HttpError ? error.message : 'Could not read or upload this clip.';
        }
        store.save();
      }
    } finally { working = false; }
  }
  let recovered = false;
  for (const job of store.state.jobs) for (const clip of job.clips || []) for (const [target, item] of Object.entries(clip.googleUploads || {})) {
    if (item.state === 'uploading') { item.state = 'unconfirmed'; item.reason = `The server restarted during upload. Check ${googleUploadTargets[target].label} for the clip.`; recovered = true; }
  }
  if (recovered) store.save();
  const wake = () => tick().catch(() => {});
  if (background) setInterval(wake, 2600).unref();
  return {
    describe, configure, connect, callback, disconnect, wake,
    queue(job, body) {
      const target = typeof body.target === 'string' && Object.hasOwn(googleScopes, body.target) ? body.target : null;
      const account = currentAccount();
      if (!target) throw new HttpError(400, 'Select Google Drive or YouTube.');
      if (!account || account.id !== body.accountId || !account.targets.includes(target)) throw new HttpError(409, 'Connect and confirm the account for this destination first.');
      if (job.status !== 'ready' || (job.options.demo && target === 'youtube')) throw new HttpError(400, 'This project cannot be uploaded to the selected destination.');
      const ids = new Set(Array.isArray(body.clipIds) ? body.clipIds : []);
      const clips = job.clips.filter((clip) => ids.has(clip.id));
      if (body.consent !== true || !clips.length || ids.size !== clips.length) throw new HttpError(400, 'Select and review the clips before confirming upload.');
      if (target === 'youtube' && typeof body.madeForKids !== 'boolean') throw new HttpError(400, 'Choose whether these YouTube clips are made for kids.');
      if (clips.some((clip) => clip.googleUploads?.[target] && clip.googleUploads[target].state !== 'failed')) throw new HttpError(409, 'A clip is already queued, uploaded, or awaiting confirmation for this destination.');
      const edits = body.edits && typeof body.edits === 'object' ? body.edits : {};
      const items = clips.map((clip) => {
        const edited = Object.hasOwn(edits, clip.id) ? edits[clip.id] : null;
        const title = text(edited?.title ?? clip.title, 100).replace(/[<>\u0000-\u001f]/g, '').trim();
        if (!title) throw new HttpError(400, 'Enter a title for each selected clip.');
        const description = text(edited?.description ?? (clip.hashtags || []).join(' '), 1000).replace(/[<>\u0000]/g, '');
        return { clip, item: { state: 'queued', accountId: account.id, configId: account.configId, title, description, madeForKids: body.madeForKids } };
      });
      for (const { clip, item } of items) (clip.googleUploads ||= {})[target] = item;
      store.save();
      queueMicrotask(wake);
    },
  };
}
