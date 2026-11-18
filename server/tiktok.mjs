import { randomBytes } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError, text } from './validation.mjs';
import { jobDir } from './store.mjs';

const apiRoot = 'https://open.tiktokapis.com/v2';
const authorize = 'https://www.tiktok.com/v2/auth/authorize/';
const scopes = ['user.info.basic', 'video.upload'];
const MiB = 1024 * 1024;
const persistedConfig = process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET && process.env.TIKTOK_REDIRECT_URI
  ? { clientKey: process.env.TIKTOK_CLIENT_KEY, clientSecret: process.env.TIKTOK_CLIENT_SECRET, redirectUri: process.env.TIKTOK_REDIRECT_URI }
  : null;

export function chunkPlan(total) {
  const chunkSize = Math.min(total, 10 * MiB);
  const count = Math.max(1, Math.floor(total / chunkSize));
  return { chunkSize, chunks: Array.from({ length: count }, (_, i) => ({ start: i * chunkSize, end: i + 1 === count ? total - 1 : (i + 1) * chunkSize - 1 })) };
}

async function tiktokApi(route, { headers = {}, body, token } = {}) {
  let res, payload;
  try {
    if (token) headers = { ...headers, Authorization: `Bearer ${token}` };
    if (body && !(body instanceof URLSearchParams)) headers['Content-Type'] = 'application/json; charset=UTF-8';
    res = await fetch(`${apiRoot}${route}`, { headers, method: body ? 'POST' : 'GET', body: body instanceof URLSearchParams ? body : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000), redirect: 'error' });
    payload = await res.json();
  } catch { throw new HttpError(502, 'Could not reach TikTok’s API. Check the server’s connection.'); }
  const code = typeof payload.error === 'string' ? payload.error : payload.error?.code;
  if (!res.ok || (code && code !== 'ok')) {
    const safe = /^[a-z0-9_]{1,80}$/i.test(code || '') ? `: ${code.replaceAll('_', ' ')}` : ` (HTTP ${res.status})`;
    throw new HttpError(502, `TikTok declined the request${safe}.`);
  }
  return payload.data ?? payload;
}

export function createTikTok(store) {
  const state = store.state.tiktok;
  const pending = new Map();
  let refreshing, processing = false;
  const readConfig = () => persistedConfig || (state.config && { ...state.config, clientSecret: store.unseal(state.config.clientSecret) });
  const enabled = () => Boolean(persistedConfig || state.config);
  const currentAccount = () => state.account && { id: state.account.id, name: state.account.name };
  const stamp = () => JSON.stringify(readConfig());

  function describe() {
    const config = persistedConfig || state.config;
    return { configured: Boolean(config), managedByEnv: Boolean(persistedConfig), clientKey: config?.clientKey || '', redirectUri: config?.redirectUri || '', connected: Boolean(state.account && config), account: currentAccount() || null };
  }
  function configure(body) {
    if (persistedConfig) throw new HttpError(409, 'This integration is managed by server environment variables.');
    const clientKey = text(body.clientKey, 180), secret = text(body.clientSecret, 500);
    if (!clientKey || (!secret && (!state.config || state.config.clientKey !== clientKey))) throw new HttpError(400, 'Enter your app’s client key and client secret.');
    let redirect;
    try { redirect = new URL(text(body.redirectUri, 500)); } catch { throw new HttpError(400, 'Enter a valid HTTPS redirect URL.'); }
    if (redirect.protocol !== 'https:' || redirect.pathname !== '/api/tiktok/callback' || redirect.search || redirect.hash || redirect.username || redirect.password) throw new HttpError(400, 'The redirect URL must be HTTPS and end in /api/tiktok/callback.');
    if (state.config && state.config.clientKey !== clientKey) delete state.account;
    state.config = { clientKey, clientSecret: secret ? store.seal(secret) : state.config.clientSecret, redirectUri: redirect.toString() };
    store.save();
    return describe();
  }
  function connect() {
    const config = readConfig();
    if (!config) throw new HttpError(409, 'Save TikTok app credentials first.');
    for (const [id, entry] of pending) if (entry.expiresAt < Date.now()) pending.delete(id);
    if (pending.size >= 30) throw new HttpError(429, 'Too many pending connections. Try again in a few minutes.');
    const csrfState = randomBytes(24).toString('base64url');
    pending.set(csrfState, { expiresAt: Date.now() + 10 * 60_000, config: stamp() });
    const url = new URL(authorize);
    url.search = new URLSearchParams({ client_key: config.clientKey, scope: scopes.join(','), response_type: 'code', redirect_uri: config.redirectUri, state: csrfState }).toString();
    return url.toString();
  }
  async function callback(query) {
    const id = text(query.state, 100);
    const entry = pending.get(id);
    pending.delete(id);
    if (!entry || entry.expiresAt < Date.now() || entry.config !== stamp()) throw new HttpError(400, 'This TikTok connection link expired. Start again from Integrations.');
    if (!query.code || query.error) throw new HttpError(400, 'TikTok authorization was cancelled or declined.');
    const config = readConfig();
    const tokens = await tiktokApi('/oauth/token/', { body: new URLSearchParams({ client_key: config.clientKey, client_secret: config.clientSecret, code: text(query.code, 2000), grant_type: 'authorization_code', redirect_uri: config.redirectUri }) });
    if (!tokens.scope?.split(',').includes('video.upload') || !tokens.open_id || !tokens.access_token || !tokens.refresh_token) throw new HttpError(400, 'Authorize video upload for this account and try connecting again.');
    const profile = await tiktokApi('/user/info/?fields=open_id,display_name', { token: tokens.access_token });
    if (profile.user?.open_id !== tokens.open_id) throw new HttpError(400, 'The connected TikTok account could not be verified.');
    if (entry.config !== stamp()) throw new HttpError(409, 'TikTok settings changed. Connect the account again.');
    state.account = { id: tokens.open_id, name: text(profile.user?.display_name, 80, 'TikTok creator'), access: store.seal(tokens.access_token), refresh: store.seal(tokens.refresh_token), expiry: Date.now() + Number(tokens.expires_in || 0) * 1000 };
    store.save();
  }
  function disconnect() {
    delete state.account;
    pending.clear();
    store.save();
  }
  async function tokenFor(accountId) {
    const account = state.account;
    const config = readConfig();
    if (!config || !account || account.id !== accountId) throw new HttpError(409, 'Connect the same TikTok account to finish this upload.');
    if (account.expiry > Date.now() + 120_000) return store.unseal(account.access);
    if (!refreshing) {
      refreshing = tiktokApi('/oauth/token/', { body: new URLSearchParams({ client_key: config.clientKey, client_secret: config.clientSecret, grant_type: 'refresh_token', refresh_token: store.unseal(account.refresh) }) }).then((tokens) => {
        if (!tokens.access_token || (tokens.open_id && tokens.open_id !== account.id) || state.account !== account) throw new HttpError(409, 'Reconnect TikTok to continue.');
        account.access = store.seal(tokens.access_token);
        if (tokens.refresh_token) account.refresh = store.seal(tokens.refresh_token);
        account.expiry = Date.now() + Number(tokens.expires_in || 0) * 1000;
        store.save();
        return tokens.access_token;
      }).finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  function update(clip, patch) {
    Object.assign(clip.tiktok, patch, { updatedAt: new Date().toISOString() });
    store.save();
  }
  async function upload(job, clip) {
    const item = clip.tiktok;
    update(clip, { state: 'uploading', reason: '' });
    const token = await tokenFor(item.accountId);
    const path = join(jobDir(job.id), clip.id, 'video.mp4');
    const { size } = await stat(path);
    if (size < 1 || size > 1024 * MiB) throw new HttpError(400, 'This MP4 is outside the upload size limit.');
    const { chunkSize, chunks } = chunkPlan(size);
    const init = await tiktokApi('/post/publish/inbox/video/init/', { token, body: { source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: chunks.length } } });
    let destination;
    try { destination = new URL(init.upload_url); } catch { /* Missing or invalid URL. */ }
    if (!destination || destination.protocol !== 'https:' || !/(^|\.)(tiktokapis\.com|tiktokcdn\.com|tiktok\.com|tiktokv\.com)$/.test(destination.hostname) || !init.publish_id) {
      throw new HttpError(502, 'TikTok did not return a valid upload destination.');
    }
    const file = await open(path, 'r');
    try {
      for (const { start, end } of chunks) {
        const buffer = Buffer.alloc(end - start + 1);
        const read = await file.read(buffer, 0, buffer.length, start);
        if (read.bytesRead !== buffer.length) throw new HttpError(500, 'The clip changed during upload.');
        let result;
        try {
          result = await fetch(destination, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(buffer.length), 'Content-Range': `bytes ${start}-${end}/${size}` }, body: buffer, signal: AbortSignal.timeout(120_000), redirect: 'error' });
        } catch { throw new HttpError(502, 'TikTok upload was interrupted. Check the connection and try again.'); }
        if (!result.ok) throw new HttpError(502, `TikTok upload returned HTTP ${result.status}.`);
      }
    } finally { await file.close(); }
    update(clip, { state: 'processing', publishId: init.publish_id, nextCheck: Date.now() + 4000, attempts: 0 });
  }
  async function check(clip) {
    const item = clip.tiktok;
    try {
      const token = await tokenFor(item.accountId);
      const payload = await tiktokApi('/post/publish/status/fetch/', { token, body: { publish_id: item.publishId } });
      if (['SEND_TO_USER_INBOX', 'PUBLISH_COMPLETE'].includes(payload.status)) return update(clip, { state: 'sent', reason: '' });
      if (payload.status === 'FAILED') {
        const reason = /^[a-z0-9_]{1,80}$/i.test(payload.fail_reason || '') ? `: ${payload.fail_reason.replaceAll('_', ' ')}` : '';
        return update(clip, { state: 'failed', reason: `TikTok could not process this draft${reason}.` });
      }
      if (item.state === 'unconfirmed') return update(clip, { state: 'unconfirmed', reason: 'TikTok is still processing this draft. Check again or look in the TikTok inbox.', nextCheck: null });
      if (item.attempts >= 20) return update(clip, { state: 'unconfirmed', reason: 'TikTok has not confirmed delivery yet. Check the status or your TikTok inbox.', nextCheck: null });
      update(clip, { attempts: item.attempts + 1, nextCheck: Date.now() + 8000 });
    } catch (error) {
      update(clip, { state: 'unconfirmed', nextCheck: null, reason: error.status ? error.message : 'Could not check TikTok’s upload status.' });
    }
  }
  async function tick() {
    if (processing) return;
    processing = true;
    try {
      for (const job of [...store.state.jobs].reverse()) {
        for (const clip of job.clips || []) {
          if (clip.tiktok?.state === 'queued') {
            try { await upload(job, clip); } catch (error) { update(clip, { state: 'failed', reason: error.status ? error.message : 'Could not read the clip or send it to TikTok.' }); }
          } else if (['processing', 'unconfirmed'].includes(clip.tiktok?.state) && clip.tiktok.nextCheck && clip.tiktok.nextCheck <= Date.now()) await check(clip);
        }
      }
    } finally { processing = false; }
  }
  const timer = setInterval(() => { tick().catch(() => {}); }, 4500);
  timer.unref();
  let recovered = false;
  for (const job of store.state.jobs) for (const clip of job.clips || []) {
    if (clip.tiktok?.state === 'uploading') {
      Object.assign(clip.tiktok, { state: 'unconfirmed', reason: 'The server restarted mid-upload. Check your TikTok inbox before sending again.' });
      recovered = true;
    }
  }
  if (recovered) store.save();
  return {
    describe, configure, connect, callback, disconnect,
    queue(job, { clipIds, consent, accountId }) {
      const account = currentAccount();
      if (!enabled() || !account || account.id !== accountId) throw new HttpError(409, 'Connect and confirm the destination TikTok account first.');
      if (job.options.demo || job.status !== 'ready') throw new HttpError(400, 'Only finished, non-demo projects can be sent to TikTok.');
      const ids = new Set(Array.isArray(clipIds) ? clipIds : []);
      const clips = job.clips.filter((clip) => ids.has(clip.id));
      if (consent !== true || !ids.size || ids.size !== clips.length) throw new HttpError(400, 'Select and review the clips, then confirm upload consent.');
      if (clips.some((clip) => clip.tiktok && !['failed'].includes(clip.tiktok.state))) throw new HttpError(409, 'Some clips are already queued, uploaded, or not yet confirmed.');
      for (const clip of clips) clip.tiktok = { state: 'queued', accountId: account.id, updatedAt: new Date().toISOString() };
      store.save();
      queueMicrotask(() => { tick().catch(() => {}); });
    },
    checkStatus(clip) {
      if (!clip.tiktok?.publishId || !['unconfirmed', 'processing'].includes(clip.tiktok.state)) throw new HttpError(409, 'There is no TikTok status to check for this clip.');
      update(clip, { nextCheck: Date.now() });
      queueMicrotask(() => { tick().catch(() => {}); });
    },
  };
}
