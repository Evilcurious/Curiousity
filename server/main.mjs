import './environment.mjs';
import express from 'express';
import ipaddr from 'ipaddr.js';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createStore, activeStatuses, boundedEnv, jobDir, maxSourceSeconds } from './store.mjs';
import { processProject } from './media.mjs';
import { captionFiles, captionInputPath, captionJobPublic, isCaptionJob, processCaptionJob } from './device-captions.mjs';
import { receiveVideo, responseSignal } from './caption-upload.mjs';
import { chatInput } from './chat.mjs';
import { discover, discoveryEnabled, discoveryInput } from './discovery.mjs';
import { finderWorkbook } from './finder-xlsx.mjs';
import { HttpError, captionStyleInput, jobOptions, maxClips, liveLimits, text } from './validation.mjs';
import { chatWithProvider, compatibleProvider, listModels, providerInput, publicProvider, reviewDiscoveryWithProvider } from './providers.mjs';
import { createTikTok } from './tiktok.mjs';
import { createGoogle, googleUploadActive, publicGoogleUploads } from './google.mjs';
import { canUsePremium, createAuth, initializeAdmin, limiter, mustChangePassword, publicAccount } from './accounts.mjs';
import { publicBrand, repairWorkspace, scopedStore, sharedProviders, updateBrand } from './workspaces.mjs';
import { browseShared, mediaNames, saveSharedClip, sharedJob } from './library.mjs';
import { inspectMcp, mcpInput, publicMcp, runMcp } from './mcp.mjs';
import { allocateVideoLink, bufferId, bufferMediaUrl, bufferOrganizations, bufferPostArgs, listBufferChannels, submitBufferDraft, videoLink } from './buffer.mjs';
import { externalUrl } from './outbound.mjs';
import { hasTheme } from '../shared/themes.mjs';
import { ROOT, toolsStatus } from './tools.mjs';
import { replayWaitMinutes, replayWaiting } from './replay.mjs';

const dev = process.argv.includes('--dev');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 5173);
const loopbackHost = /^(?:127\.0\.0\.1|\[::1\]|localhost)(?::\d{1,5})?$/i;
const isLoopback = (address) => ipaddr.isValid(address || '') && ipaddr.process(address).range() === 'loopback';
const proxyMode = process.env.TRUST_PROXY?.trim().toLowerCase() || '0';
let publicOrigin = '';
if (process.env.PUBLIC_ORIGIN) {
  const url = externalUrl(process.env.PUBLIC_ORIGIN);
  if (url.pathname !== '/') throw new Error('PUBLIC_ORIGIN must be only the HTTPS origin, without a path.');
  publicOrigin = url.origin;
}

const app = express();
app.disable('x-powered-by');
if (proxyMode === 'loopback') app.set('trust proxy', (address, hop) => hop === 0 && isLoopback(address));
else if (proxyMode === '1') app.set('trust proxy', 1);
else if (proxyMode !== '0') throw new Error('TRUST_PROXY must be 0, loopback, or 1.');
if (publicOrigin && proxyMode === '0') console.warn('PUBLIC_ORIGIN is set but proxy trust is off. For a host-local HTTPS reverse proxy, set TRUST_PROXY=loopback.');
// There is no total request-body deadline on streamed video uploads. Tight
// timeouts still apply to request headers, other bodies and stalled uploads.
const server = createServer({ requestTimeout: 0, headersTimeout: 30_000 }, app);
const webRoot = join(ROOT, 'dist');
const store = createStore();
await initializeAdmin(store);
const preview = (req) => dev && [req.get('host'), req.get('x-forwarded-host')?.split(',')[0]?.trim()].some((value) => /^[a-z0-9-]+\.e2b\.app$/i.test(value || ''));
const proxyTrusted = (req) => app.get('trust proxy fn')(req.socket.remoteAddress, 0);
const secure = (req) => req.socket.encrypted === true || (proxyTrusted(req) && req.get('x-forwarded-proto')?.trim().toLowerCase() === 'https') ||
  (preview(req) && (req.get('x-forwarded-proto') === 'https' || req.get('origin')?.startsWith('https://')));
function passwordTransport(req) {
  const origin = req.get('origin');
  if (secure(req)) return !origin || origin.startsWith('https://') ? 'https' : 'blocked';
  const host = req.get('host');
  const local = loopbackHost.test(host || '') && loopbackHost.test(req.host || '') &&
    (!origin || origin.toLowerCase() === `http://${host.toLowerCase()}`) &&
    (proxyMode !== 'loopback' || proxyTrusted(req)) &&
    (!proxyTrusted(req) || !req.get('x-forwarded-for') || isLoopback(req.ip));
  return local ? 'local' : 'blocked';
}
const auth = createAuth(store, { secure, embedded: preview });
const networkLimit = limiter(60_000);
const dailySharedLimit = Math.floor(boundedEnv('PREMIUM_DAILY_JOBS', 10, 1, 200));
const services = new Map();
const deleting = new Set(), copying = new Set(), chatting = new Set();
const searching = new Map();
let current, replayTimer, closing = false, recovering = false;

for (const account of store.state.users) if (repairWorkspace(account)) recovering = true;
for (const job of store.state.jobs) {
  if (job.status === 'fetching' && job.replayWait) {
    job.status = replayWaiting;
    job.detail = 'Waiting for the next replay check.';
    await rm(join(jobDir(job.id), 'work'), { recursive: true, force: true });
    recovering = true;
  } else if (activeStatuses.has(job.status) && !['queued', replayWaiting].includes(job.status)) {
    job.status = 'failed';
    job.detail = 'The server restarted before this project finished.';
    job.error = job.detail;
    const dir = jobDir(job.id);
    await rm(isCaptionJob(job) && !job.trackReady ? dir : join(dir, 'work'), { recursive: true, force: true });
    recovering = true;
  }
  for (const clip of job.clips || []) if (clip.bufferDraft?.state === 'sending') {
    Object.assign(clip.bufferDraft, { state: 'unconfirmed', reason: 'The server restarted while making this draft. Check your Buffer drafts before sending again.' });
    recovering = true;
  }
}
if (recovering) store.save();
function connections(account) {
  let value = services.get(account.id);
  if (!value) {
    const scoped = scopedStore(store, account);
    const options = { useEnv: account.role === 'admin', background: false };
    value = { google: createGoogle(scoped, options), tiktok: createTikTok(scoped, options) };
    services.set(account.id, value);
  }
  return value;
}
const uploadBusy = (clip) => googleUploadActive(clip) || ['queued', 'uploading', 'processing'].includes(clip.tiktok?.state) || clip.bufferDraft?.state === 'sending';
function uploadOwners() {
  const owners = new Set(store.state.jobs.filter((job) => job.clips.some((clip) => googleUploadActive(clip) || ['queued', 'uploading', 'processing'].includes(clip.tiktok?.state) || (clip.tiktok?.state === 'unconfirmed' && clip.tiktok.nextCheck))).map((job) => job.ownerId));
  return store.state.users.filter((user) => owners.has(user.id));
}
// Normalize interrupted delivery states before the first API read. Resume only
// queued uploads and status checks; never resend an interrupted upload.
for (const account of uploadOwners()) connections(account);
setInterval(() => {
  if (closing) return;
  for (const account of uploadOwners()) {
    const { google, tiktok } = connections(account);
    google.wake(); tiktok.wake();
  }
}, 2700).unref();

const ownedJob = (req) => store.state.jobs.find((job) => job.id === req.params.id && job.ownerId === req.account.id && !deleting.has(job.id));
const jobById = (req) => {
  const job = ownedJob(req);
  if (!job || isCaptionJob(job)) throw new HttpError(404, 'This project could not be found.');
  return job;
};
const captionById = (req) => {
  const job = ownedJob(req);
  if (!job || !isCaptionJob(job) || job.status === 'uploading') throw new HttpError(404, 'This caption project could not be found.');
  return job;
};
const clipById = (job, id) => {
  const clip = job.clips.find((item) => item.id === id);
  if (!clip) throw new HttpError(404, 'This clip could not be found.');
  return clip;
};
const profileById = (req, id) => {
  const profile = req.scoped.state.providers.find((item) => item.id === id);
  if (!profile) throw new HttpError(404, 'This provider profile could not be found.');
  return profile;
};
const mcpById = (req, id = req.params.id) => {
  const profile = req.scoped.state.mcps.find((item) => item.id === id);
  if (!profile) throw new HttpError(404, 'This MCP server could not be found.');
  return profile;
};
const bufferFor = (req, id) => {
  const profile = mcpById(req, id);
  if (profile.kind !== 'buffer') throw new HttpError(400, 'Connect a Buffer MCP profile first.');
  return { ...profile };
};
const publicProviderFor = (profile) => ({ ...publicProvider(profile), premiumShared: Boolean(profile.premiumShared) });
const sharedProviderCard = ({ id, name, model, type }) => ({ id, name, model, type, managed: true });
function jobPublic({ ownerId, chatProviderId, libraryOrigin, ...job }) {
  return { ...job, clips: job.clips.map(({ tiktok: posting, googleUploads, ...clip }) => {
    const base = `/api/projects/${job.id}/clips/${clip.id}`;
    return { ...clip, videoUrl: `${base}/video.mp4`, posterUrl: clip.withPoster ? `${base}/poster.jpg` : null, captionsUrl: clip.withCaptions ? `${base}/captions.srt` : null,
      googleUploads: publicGoogleUploads(googleUploads), tiktok: posting ? { state: posting.state, reason: posting.reason, canCheck: Boolean(posting.publishId) } : null };
  }) };
}
function touch(job, changes) {
  Object.assign(job, changes, { updatedAt: new Date().toISOString() });
  store.save();
}
async function work() {
  if (current || closing) return;
  clearTimeout(replayTimer);
  const now = Date.now();
  const checkAt = (item) => Number(item.replayWait?.nextCheckAt) || 0;
  const queue = [...store.state.jobs].reverse().filter((item) => item.ownerId && ['queued', replayWaiting].includes(item.status));
  const job = queue.find((item) => item.status === 'queued' || checkAt(item) <= now);
  if (!job) {
    // Waiting replays survive a restart and do not hold the media worker.
    if (queue.length) replayTimer = setTimeout(work, Math.max(1, Math.min(...queue.map(checkAt)) - now)).unref();
    return;
  }
  const account = store.state.users.find((user) => user.id === job.ownerId);
  if (!account) { touch(job, { status: 'failed', detail: 'The project owner no longer exists.' }); queueMicrotask(work); return; }
  const ctrl = new AbortController();
  const session = { signal: ctrl.signal, finishCapture: null };
  current = { ctrl, job, session };
  try {
    const process = isCaptionJob(job) ? processCaptionJob : processProject;
    await process(job, scopedStore(store, account), session, (changes) => touch(job, changes));
  }
  catch (error) {
    if (ctrl.signal.aborted) {
      if (closing && job.status === 'fetching' && job.replayWait) touch(job, { status: replayWaiting, detail: 'Waiting for the next replay check.' });
      else touch(job, { status: 'cancelled', detail: 'Project stopped.' });
    } else {
      const detail = (isCaptionJob(job) && (error.code || error instanceof SyntaxError)) ? 'Video processing failed. Check the source and available disk space.' : error.message || 'Project processing failed.';
      touch(job, { status: 'failed', error: detail, detail });
    }
  } finally { current = null; queueMicrotask(work); }
}

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff').set('Referrer-Policy', 'no-referrer');
  const framing = dev ? '' : "; frame-ancestors 'self'";
  if (req.method === 'POST' && req.path === '/api/captions/upload') {
    res.set('Connection', 'close');
  } else if (req.get('transfer-encoding') || Number(req.get('content-length')) > 0) {
    const bodyDeadline = setTimeout(() => req.destroy(), 30_000).unref();
    const received = () => clearTimeout(bodyDeadline);
    req.once('end', received).once('close', received);
  }
  res.set('Content-Security-Policy', `default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'self'${framing}`);
  next();
});
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(req.method)) {
    const origin = req.get('origin');
    let sameHost = !origin;
    if (origin) {
      try {
        const actual = new URL(origin).host;
        const forwarded = req.get('x-forwarded-host')?.trim();
        sameHost = publicOrigin === origin || actual === req.get('host') ||
          (proxyTrusted(req) && secure(req) && actual === forwarded) ||
          (preview(req) && actual.endsWith('.e2b.app') && actual === forwarded?.split(',')[0]?.trim());
      } catch { /* Reject malformed origins. */ }
    }
    if (req.get('x-clipforge') !== 'workspace' || !sameHost || ['cross-site', 'same-site'].includes(req.get('sec-fetch-site'))) return next(new HttpError(403, 'Requests must come from this workspace.'));
  }
  next();
});
const jsonBody = express.json({ limit: '192kb' });
app.use('/api', (req, res, next) => req.method === 'POST' && req.path === '/captions/upload' ? next() : jsonBody(req, res, next));

const authResponse = (account) => ({ user: publicAccount(account), branding: publicBrand(store), allowSignup: auth.allowSignup });
function allowPassword(req) {
  if (passwordTransport(req) !== 'blocked') return;
  let hint = 'If your HTTPS proxy runs on this VPS, start Curiousity with TRUST_PROXY=loopback.';
  if (proxyTrusted(req)) hint = 'The reverse proxy must overwrite X-Forwarded-Proto with the actual connection scheme.';
  else if (proxyMode === 'loopback') hint = 'With TRUST_PROXY=loopback, the proxy must connect to Curiousity at 127.0.0.1 or ::1.';
  throw new HttpError(403, `Password requests require HTTPS. ${hint}`);
}
// Route support only; media tools and a configured chat model are checked separately.
const apiFeatures = Object.freeze({ deviceCaptions: true, personalChat: true, chatDiscovery: true, discoveryVerification: true, liveReplay: true });
app.get('/api/auth/session', (req, res) => res.json({ ...authResponse(auth.identify(req)), httpsOrigin: publicOrigin || null, passwordTransport: passwordTransport(req), apiFeatures }));
app.post('/api/auth/signup', async (req, res) => { allowPassword(req); const account = await auth.signup(req, res); res.status(201).json(authResponse(account)); });
app.post('/api/auth/signin', async (req, res) => { allowPassword(req); res.json(authResponse(await auth.login(req, res))); });
app.post('/api/auth/signout', (req, res) => { auth.logout(req, res); res.status(204).end(); });
app.get('/api/brand/logo', (_req, res) => {
  if (!store.state.branding.logo) throw new HttpError(404, 'Logo not found.');
  res.type('png').send(Buffer.from(store.state.branding.logo, 'base64'));
});

async function oauthCallback(service, req, res) {
  const account = auth.identify(req);
  let result = `${service === 'google' ? 'Google' : 'TikTok'} connected.`;
  try {
    if (!account) throw new HttpError(401, 'Sign in again before connecting an integration.');
    if (mustChangePassword(account)) throw new HttpError(403, 'Replace your temporary password first.');
    const prefix = `cf_${service}_state=`;
    const state = (req.get('cookie') || '').split(/;\s*/).find((item) => item.startsWith(prefix))?.slice(prefix.length);
    if (!state || state !== req.query.state) throw new HttpError(400, 'This connection was not started in this browser. Try again from Settings → Integrations.');
    await connections(account)[service].callback(req.query);
  } catch (error) { result = error instanceof HttpError ? error.message : 'The connection could not be completed.'; }
  res.clearCookie(`cf_${service}_state`, { httpOnly: true, sameSite: 'lax', secure: service === 'tiktok' || secure(req), path: `/api/${service}/callback` });
  res.redirect(303, `/#/settings/integrations?notice=${encodeURIComponent(result)}`);
}
app.get('/api/google/callback', (req, res) => oauthCallback('google', req, res));
app.get('/api/tiktok/callback', (req, res) => oauthCallback('tiktok', req, res));
app.use('/api', (req, _res, next) => {
  const account = auth.identify(req);
  if (!account) return next(new HttpError(401, 'Sign in to your Curiousity account.'));
  req.account = account;
  req.scoped = scopedStore(store, account);
  next();
});
app.put('/api/account/password', async (req, res) => {
  allowPassword(req);
  await auth.changePassword(req, res, req.account);
  res.status(204).end();
});
// A temporary credential is only for setting a private password, not for
// administering the workspace or opening any signed-in project or integration.
app.use('/api', (req, _res, next) => mustChangePassword(req.account) ? next(new HttpError(403, 'Replace your temporary password in Account settings first.')) : next());
app.use('/api/admin', (req, _res, next) => req.account.role === 'admin' ? next() : next(new HttpError(403, 'Administrator access is required.')));

app.get('/api/workspace', async (req, res) => {
  const { providers, activeProviderId, captions, mcps } = req.scoped.state;
  const { google, tiktok } = connections(req.account);
  res.json({ online: true, tools: await toolsStatus(), user: publicAccount(req.account), branding: publicBrand(store),
    providers: providers.map(publicProviderFor), sharedProviders: sharedProviders(store, req.account).map(sharedProviderCard),
    activeProviderId: req.scoped.chatProfile(activeProviderId) ? activeProviderId : null, captions, mcps: mcps.map(publicMcp),
    tiktok: tiktok.describe(), google: google.describe(), discoveryEnabled, bufferCanHost: Boolean(publicOrigin), maxClips, liveLimits, replayWaitMinutes, maxSourceMinutes: Math.round(maxSourceSeconds / 60) });
});
app.put('/api/account/theme', (req, res) => {
  const theme = req.body?.theme;
  if (theme !== null && !hasTheme(theme)) throw new HttpError(400, 'Choose one of the available themes, or use the workspace default.');
  req.account.theme = theme;
  store.save();
  res.json(authResponse(req.account));
});
app.post('/api/account/premium', (req, res) => {
  if (!canUsePremium(req.account)) { req.account.premiumRequested = true; store.save(); }
  res.json(authResponse(req.account));
});
app.get('/api/admin/accounts', (req, res) => {
  const query = text(req.query.q, 120).toLowerCase(), offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const users = store.state.users.filter((user) => user.email.includes(query)).sort((a, b) => Number(b.premiumRequested) - Number(a.premiumRequested) || b.createdAt.localeCompare(a.createdAt));
  res.json({ users: users.slice(offset, offset + 40).map(publicAccount), next: users.length > offset + 40 ? offset + 40 : null });
});
app.put('/api/admin/accounts/:id/premium', (req, res) => {
  const user = store.state.users.find((value) => value.id === req.params.id);
  if (!user) throw new HttpError(404, 'Account not found.');
  if (user.role !== 'member' || typeof req.body?.premium !== 'boolean') throw new HttpError(400, 'Choose a member and a valid premium status.');
  user.premium = req.body.premium;
  user.premiumRequested = false;
  store.save();
  res.json(publicAccount(user));
});
app.put('/api/admin/branding', (req, res) => res.json(updateBrand(store, req.body || {})));
app.put('/api/admin/providers/:id/share', (req, res) => {
  const profile = profileById(req, req.params.id);
  if (typeof req.body?.shared !== 'boolean' || (req.body.shared && !profile.model)) throw new HttpError(400, 'Select a valid chat model before sharing this provider.');
  profile.premiumShared = req.body.shared;
  store.save();
  res.json(publicProviderFor(profile));
});

function reserveSharedUse(account) {
  const today = new Date().toISOString().slice(0, 10);
  const meter = account.premiumMeter?.day === today ? account.premiumMeter : { day: today, jobs: 0 };
  if (meter.jobs >= dailySharedLimit) throw new HttpError(429, 'You reached today’s premium AI project limit. Use a personal profile or local analysis.');
  meter.jobs++;
  account.premiumMeter = meter;
}
function checkQueue(account) {
  const active = store.state.jobs.filter((item) => item.ownerId && activeStatuses.has(item.status));
  if (active.length >= 10 || active.filter((item) => item.ownerId === account.id).length >= 2) throw new HttpError(429, 'The project queue is full. Wait for an active project to finish.');
}

app.get('/api/projects', (req, res) => res.json(req.scoped.state.jobs.filter((job) => !isCaptionJob(job) && !deleting.has(job.id)).map(jobPublic)));
app.post('/api/projects', async (req, res) => {
  const options = jobOptions(req.body || {});
  const tools = await toolsStatus();
  if (!tools.ffmpeg || (!options.demo && !tools.ytDlp)) throw new HttpError(503, 'Media tools are missing. Open the Setup guide and run npm run setup.');
  if (options.tiktok && !connections(req.account).tiktok.describe().connected) throw new HttpError(409, 'Connect a TikTok account before adding drafts to this project.');
  const selection = options.aiProfile === 'workspace' ? req.scoped.state.activeProviderId : options.aiProfile === 'local' ? null : options.aiProfile;
  const profile = selection ? req.scoped.chatProfile(selection) : null;
  if (selection && !profile && options.aiProfile !== 'workspace') throw new HttpError(404, 'This AI model is not available to your account.');
  if (profile && !profile.model) throw new HttpError(400, 'Choose a chat model for this AI profile first.');
  checkQueue(req.account);
  if (profile && !req.scoped.state.providers.includes(profile)) reserveSharedUse(req.account);
  const now = new Date().toISOString();
  const job = { id: randomUUID(), ownerId: req.account.id, chatProviderId: profile?.id || null, title: options.demo ? 'The anatomy of a great hook' : 'YouTube project', options, status: 'queued', detail: 'Waiting for the media worker.', progress: 0, clips: [], createdAt: now, updatedAt: now };
  store.state.jobs.unshift(job);
  store.save();
  res.status(202).json(jobPublic(job));
  queueMicrotask(work);
});
app.get('/api/projects/:id', (req, res) => res.json(jobPublic(jobById(req))));
app.post('/api/projects/:id/cancel', (req, res) => {
  const job = jobById(req);
  if (job.status === replayWaiting) {
    touch(job, { status: 'cancelled', detail: 'Stopped waiting for this replay.' });
    queueMicrotask(work);
  } else if (current?.job === job && activeStatuses.has(job.status)) {
    if (!current.ctrl.signal.aborted) current.ctrl.abort(new Error('Project stopped.'));
  } else if (job.status === 'queued') touch(job, { status: 'cancelled', detail: 'Project removed from the queue.' });
  res.json(jobPublic(job));
});
app.post('/api/projects/:id/finish-capture', (req, res) => {
  const job = jobById(req);
  if (current?.job !== job || !current.session.finishCapture) throw new HttpError(409, 'This project is not capturing a livestream right now.');
  if (job.capturedSeconds < 6) throw new HttpError(409, 'Wait until at least six seconds have been captured.');
  current.session.finishCapture();
  touch(job, { detail: 'Closing the live recording and preparing to analyze it.' });
  res.json(jobPublic(job));
});
async function removeJob(job) {
  if (activeStatuses.has(job.status) || job.clips.some(uploadBusy)) throw new HttpError(409, 'Wait for the project and any uploads to finish before deleting it.');
  deleting.add(job.id);
  try {
    await rm(jobDir(job.id), { recursive: true, force: true });
    store.state.jobs = store.state.jobs.filter((item) => item !== job);
    store.state.bufferLinks = store.state.bufferLinks.filter((entry) => entry.jobId !== job.id);
    store.save();
  } finally { deleting.delete(job.id); }
}
app.delete('/api/projects/:id', async (req, res) => { await removeJob(jobById(req)); res.status(204).end(); });
function respondMedia(req, res, next, job, clip, file) {
  if (!mediaNames.has(file) || (file === 'captions.srt' && !clip.withCaptions) || (file === 'poster.jpg' && !clip.withPoster)) throw new HttpError(404, 'File not found.');
  if (file === 'captions.srt') res.type('application/x-subrip');
  const path = join(jobDir(job.id), clip.id, file);
  const filename = `curiousity-${job.id.slice(0, 8)}-${clip.id}.${file.split('.').at(-1)}`;
  if (req.query.download === '1') res.download(path, filename, { dotfiles: 'allow' }, (error) => { if (error) next(error); });
  else res.sendFile(path, { dotfiles: 'allow' }, (error) => { if (error) next(error); });
}
app.get('/api/projects/:id/clips/:clip/:file', (req, res, next) => {
  const job = jobById(req);
  respondMedia(req, res, next, job, clipById(job, req.params.clip), req.params.file);
});
app.get('/api/library', (req, res) => res.json(browseShared(store, req.account, deleting, req.query)));
app.put('/api/projects/:id/sharing', (req, res) => {
  const job = jobById(req);
  if (job.status !== 'ready' || !job.clips.length || typeof req.body?.shared !== 'boolean') throw new HttpError(400, 'Only finished exports can be shared.');
  if (req.body.shared && job.sourceKind === 'shared') throw new HttpError(409, 'Only the original project can be listed in the shared library.');
  if (req.body.shared && req.body.consent !== true) throw new HttpError(400, 'Confirm that you have permission to share these clips for others to reuse.');
  touch(job, { sharedAt: req.body.shared ? job.sharedAt || new Date().toISOString() : null });
  res.json(jobPublic(job));
});
app.delete('/api/admin/library/:id', (req, res) => {
  const job = sharedJob(store, req.params.id, deleting);
  if (!job) throw new HttpError(404, 'This project is not shared.');
  touch(job, { sharedAt: null });
  res.status(204).end();
});
app.get('/api/library/:id/clips/:clip/:file', (req, res, next) => {
  const job = sharedJob(store, req.params.id, deleting);
  if (!job) throw new HttpError(404, 'This clip is not shared.');
  respondMedia(req, res, next, job, clipById(job, req.params.clip), req.params.file);
});
app.post('/api/library/:id/clips/:clip/save', async (req, res) => {
  const job = sharedJob(store, req.params.id, deleting);
  if (!job) throw new HttpError(404, 'This clip is not shared.');
  const clip = clipById(job, req.params.clip), key = `${req.account.id}/${job.id}/${clip.id}`;
  if (copying.has(key)) throw new HttpError(409, 'This clip is already being saved.');
  networkLimit(`save:${req.account.id}`, 20);
  copying.add(key);
  try { res.json(jobPublic(await saveSharedClip(store, req.account, job, clip, () => sharedJob(store, job.id, deleting) === job))); }
  finally { copying.delete(key); }
});

app.post('/api/projects/:id/google', (req, res) => {
  const job = jobById(req);
  connections(req.account).google.queue(job, req.body || {});
  res.status(202).json(jobPublic(job));
});
app.post('/api/projects/:id/tiktok', (req, res) => {
  const job = jobById(req);
  connections(req.account).tiktok.queue(job, req.body || {});
  res.status(202).json(jobPublic(job));
});
app.post('/api/projects/:id/clips/:clip/tiktok/check', (req, res) => {
  const job = jobById(req);
  connections(req.account).tiktok.checkStatus(clipById(job, req.params.clip));
  res.status(202).json(jobPublic(job));
});
app.post('/api/projects/:id/clips/:clip/buffer', async (req, res) => {
  networkLimit(`mcp:${req.account.id}`, 16);
  const job = jobById(req), clip = clipById(job, req.params.clip), input = req.body || {};
  if (job.status !== 'ready' || (clip.bufferDraft && clip.bufferDraft.state !== 'failed')) throw new HttpError(409, 'This clip is not ready or already has a Buffer draft. Check Buffer before sending again.');
  const profile = bufferFor(req, input.profileId);
  if (!bufferId(input.organizationId)) throw new HttpError(400, 'Choose a Buffer organization.');
  if (!['link', 'external'].includes(input.mediaMode)) throw new HttpError(400, 'Choose how to attach the video.');
  if (input.mediaMode === 'link' && !publicOrigin) throw new HttpError(409, 'Temporary media links need a public HTTPS origin. Paste a hosted MP4 URL instead.');
  const args = bufferPostArgs({ input, clip, mediaUrl: input.mediaMode === 'link' ? null : bufferMediaUrl(input.mediaUrl) });
  const link = input.mediaMode === 'link' ? allocateVideoLink(store, publicOrigin, job, clip) : null;
  if (link) args.assets[0].video.url = link.url;
  clip.bufferDraft = { state: 'sending', linkExpiry: link?.expiry || null };
  store.save();
  try {
    const result = await submitBufferDraft(profile, store, args, { organizationId: input.organizationId, service: input.service });
    Object.assign(clip.bufferDraft, { state: 'draft', id: result.id });
  } catch (error) {
    clip.bufferDraft.state = error.safeToRetry ? 'failed' : 'unconfirmed';
    clip.bufferDraft.reason = error.safeToRetry ? error.message : 'Delivery was not confirmed. Check your Buffer drafts before trying again.';
    if (link && clip.bufferDraft.state === 'failed') store.state.bufferLinks = store.state.bufferLinks.filter((item) => item !== link.entry);
  }
  store.save();
  res.json(jobPublic(job));
});
app.get('/media/buffer/:token.mp4', (req, res, next) => {
  const entry = videoLink(store, req.params.token);
  const job = entry && store.state.jobs.find((item) => item.id === entry.jobId && item.status === 'ready' && !deleting.has(item.id));
  if (!job) throw new HttpError(404, 'This video link has expired or was removed.');
  res.set('Cache-Control', 'private, no-store').set('X-Robots-Tag', 'noindex, nofollow').set('Content-Disposition', 'inline');
  respondMedia(req, res, next, job, clipById(job, entry.clipId), 'video.mp4');
});

app.get('/api/captions', (req, res) => res.json(req.scoped.state.jobs.filter((job) => isCaptionJob(job) && job.status !== 'uploading' && !deleting.has(job.id)).map(captionJobPublic)));
app.post('/api/captions/upload', async (req, res) => {
  if (!req.is('application/octet-stream') || ![undefined, 'identity'].includes(req.get('content-encoding'))) throw new HttpError(415, 'Send an uncompressed video file.');
  let setting;
  if (req.query.style !== undefined) {
    if (typeof req.query.style !== 'string' || req.query.style.length > 800) throw new HttpError(400, 'Choose a valid video caption style.');
    try { setting = JSON.parse(req.query.style); } catch { throw new HttpError(400, 'Choose a valid video caption style.'); }
  }
  const style = captionStyleInput(setting);
  const filename = typeof req.query.name === 'string' ? req.query.name.split(/[\\/]/).at(-1).replace(/\p{C}/gu, '') : '';
  const title = text(filename, 180) || 'Untitled video';
  const request = responseSignal(res);
  let job;
  try {
    const tools = await toolsStatus();
    request.signal.throwIfAborted();
    if (!tools.ffmpeg) throw new HttpError(503, 'Install FFmpeg using the Setup guide to caption device videos.');
    const choice = req.scoped.state.captions;
    const profile = choice.model && req.scoped.state.providers.find((item) => item.id === choice.providerId && compatibleProvider(item));
    if (!profile && !tools.whisper) throw new HttpError(503, 'Install local Whisper or select a timestamped Caption engine in AI provider settings.');
    checkQueue(req.account);
    const uploading = store.state.jobs.filter((item) => item.status === 'uploading');
    if (uploading.length >= 3 || uploading.some((item) => item.ownerId === req.account.id)) throw new HttpError(429, 'Another video is uploading. Wait for the upload to finish.');
    const now = new Date().toISOString();
    const captionEngine = profile ? { providerId: profile.id, type: profile.type, baseUrl: profile.baseUrl, model: choice.model } : null;
    job = { id: randomUUID(), kind: 'captions', ownerId: req.account.id, title, style, captionEngine, status: 'uploading', progress: 0, clips: [], createdAt: now, updatedAt: now };
    store.state.jobs.unshift(job);
    store.save();
    await mkdir(jobDir(job.id), { recursive: true, mode: 0o700 });
    await receiveVideo(req, captionInputPath(job.id), request.signal);
    request.signal.throwIfAborted();
    touch(job, { status: 'queued', detail: 'Waiting for the media worker.' });
    res.status(202).json(captionJobPublic(job));
    queueMicrotask(work);
  } catch (error) {
    if (job) {
      store.state.jobs = store.state.jobs.filter((item) => item !== job);
      await rm(jobDir(job.id), { recursive: true, force: true });
      store.save();
    }
    if (request.signal.aborted) return;
    if (['ENOSPC', 'EDQUOT'].includes(error.code)) throw new HttpError(507, 'The server is out of disk space. Free some space and retry the upload.');
    throw error;
  } finally { request.release(); }
});
app.post('/api/captions/:id/render', async (req, res) => {
  const job = captionById(req);
  const style = captionStyleInput(req.body?.style);
  const tools = await toolsStatus();
  if (!store.state.jobs.includes(job) || deleting.has(job.id)) throw new HttpError(404, 'This caption project could not be found.');
  if (!job.trackReady || current?.job === job || activeStatuses.has(job.status)) throw new HttpError(409, 'Wait for the current caption task to finish.');
  if (!tools.subtitles) throw new HttpError(503, 'Install FFmpeg with libass to render a styled MP4.');
  checkQueue(req.account);
  touch(job, { style, status: 'queued', detail: 'Waiting to render the new style.', progress: 0, error: null });
  res.status(202).json(captionJobPublic(job));
  queueMicrotask(work);
});
app.post('/api/captions/:id/cancel', async (req, res) => {
  const job = captionById(req);
  if (current?.job === job && activeStatuses.has(job.status)) current.ctrl.abort(new Error('Caption task stopped.'));
  else if (job.status === 'queued') {
    touch(job, { status: 'cancelled', detail: 'Caption task removed from the queue.' });
    if (!job.trackReady) await rm(jobDir(job.id), { recursive: true, force: true });
  }
  res.json(captionJobPublic(job));
});
app.delete('/api/captions/:id', async (req, res) => { await removeJob(captionById(req)); res.status(204).end(); });
app.get('/api/captions/:id/:file', (req, res, next) => {
  const job = captionById(req), file = req.params.file;
  if (!captionFiles.has(file) || (file === 'video.mp4' ? !job.renderVersion : !job.trackReady)) throw new HttpError(404, 'File not found.');
  if (file === 'captions.srt') res.type('application/x-subrip');
  const path = join(jobDir(job.id), file);
  const done = (error) => { if (error) next(error); };
  if (req.query.download === '1') res.download(path, `curiousity-${job.id.slice(0, 8)}.${file.split('.').at(-1)}`, { dotfiles: 'allow' }, done);
  else res.sendFile(path, { dotfiles: 'allow' }, done);
});

for (const skill of ['reach', 'finder']) app.post(`/api/chat/${skill}`, async (req, res) => {
  if (!discoveryEnabled) throw new HttpError(503, 'Public search is disabled by the server administrator.');
  const input = discoveryInput(skill, req.body);
  const { reviewProfileId, reviewRevision } = req.body;
  let review;
  if (reviewProfileId !== undefined) {
    if (typeof reviewProfileId !== 'string' || !reviewProfileId || reviewProfileId.length > 80) throw new HttpError(400, 'Choose one of your saved models for AI review.');
    const saved = profileById(req, reviewProfileId);
    if (reviewRevision !== undefined && (saved.revision || saved.id) !== reviewRevision) throw new HttpError(409, 'This AI profile changed. Refresh your workspace before searching again.');
    if (!saved.model) throw new HttpError(400, 'Choose a chat model for AI review in Settings.');
    const profile = { ...saved };
    review = (criteria, candidates, signal) => reviewDiscoveryWithProvider(profile, store, criteria, candidates, signal);
  }
  const { id } = req.account;
  if (searching.has(id) || searching.size >= 6) throw new HttpError(429, 'Discovery is busy. Wait for the current search to finish.');
  networkLimit(`discovery:${id}`, 6);
  networkLimit('discovery:server', 30);
  const request = responseSignal(res);
  if (request.signal.aborted) { request.release(); return; }
  const releaseSearch = () => { if (searching.get(id) === request) searching.delete(id); };
  searching.set(id, request);
  // A reset can start a new search before a cancelled provider call unwinds.
  request.signal.addEventListener('abort', releaseSearch, { once: true });
  try {
    const result = await discover(input, request.signal, review);
    if (!request.signal.aborted) res.json({ ...result, ...(skill === 'finder' && result.records.length ? { workbook: finderWorkbook(result) } : {}) });
  } catch (error) { if (!request.signal.aborted) throw error; }
  finally { request.release(); request.signal.removeEventListener('abort', releaseSearch); releaseSearch(); }
});

app.post('/api/chat', async (req, res) => {
  const { providerId, messages } = chatInput(req.body);
  const profile = profileById(req, providerId);
  if (req.body.revision !== undefined && (profile.revision || profile.id) !== req.body.revision) throw new HttpError(409, 'This AI profile changed. Refresh your workspace before sending any messages.');
  if (!profile.model) throw new HttpError(400, 'Choose a chat model for this profile in Settings.');
  if (chatting.has(req.account.id) || chatting.size >= 12) throw new HttpError(429, 'Chat is busy. Wait for a reply before sending another message.');
  networkLimit(`chat:${req.account.id}`, 16);
  const request = responseSignal(res);
  chatting.add(req.account.id);
  try {
    const reply = await chatWithProvider({ ...profile }, store, messages, request.signal);
    if (!request.signal.aborted) res.json(reply);
  } catch (error) { if (!request.signal.aborted) throw error; }
  finally { request.release(); chatting.delete(req.account.id); }
});

const providerOptions = (req) => ({ allowLocal: req.account.role === 'admin' });
app.post('/api/providers', (req, res) => {
  const profile = { id: randomUUID(), ...providerInput(req.body || {}, null, store, providerOptions(req)) };
  req.scoped.state.providers.push(profile);
  store.save();
  res.status(201).json(publicProviderFor(profile));
});
app.put('/api/providers/:id', (req, res) => {
  const profile = profileById(req, req.params.id), state = req.scoped.state;
  const next = providerInput(req.body || {}, profile, store, providerOptions(req));
  if (state.activeProviderId === profile.id && !next.model) state.activeProviderId = null;
  if (!next.model || next.baseUrl !== profile.baseUrl || next.model !== profile.model || next.type !== profile.type) profile.premiumShared = false;
  if (state.captions.providerId === profile.id && !compatibleProvider(next)) state.captions = { providerId: null, model: '' };
  if (['type', 'baseUrl', 'model', 'apiKey'].some((key) => profile[key] !== next[key])) profile.revision = randomUUID();
  Object.assign(profile, next);
  store.save();
  res.json(publicProviderFor(profile));
});
app.delete('/api/providers/:id', (req, res) => {
  const profile = profileById(req, req.params.id), state = req.scoped.state;
  state.providers = state.providers.filter((item) => item !== profile);
  if (state.activeProviderId === profile.id) state.activeProviderId = null;
  if (state.captions.providerId === profile.id) state.captions = { providerId: null, model: '' };
  store.save();
  res.status(204).end();
});
app.post('/api/providers/catalog', async (req, res) => {
  networkLimit(`models:${req.account.id}`, 12);
  const input = req.body || {};
  const existing = input.id ? profileById(req, input.id) : null;
  const profile = providerInput(input, existing, store, providerOptions(req));
  res.json({ models: await listModels(profile, store) });
});
app.get('/api/providers/:id/models', async (req, res) => {
  networkLimit(`models:${req.account.id}`, 12);
  res.json({ models: await listModels(profileById(req, req.params.id), store) });
});
app.put('/api/settings/ranking', (req, res) => {
  const id = req.body?.providerId || null;
  if (id && !req.scoped.chatProfile(id)?.model) throw new HttpError(404, 'This chat model is not available to your account.');
  req.scoped.state.activeProviderId = id;
  store.save();
  res.json({ activeProviderId: id });
});
app.put('/api/settings/captions', (req, res) => {
  const id = req.body?.providerId || null;
  const model = id ? text(req.body?.model, 160) : '';
  if (id && (!compatibleProvider(profileById(req, id)) || !model)) throw new HttpError(400, 'Choose one of your OpenAI-compatible profiles and a timestamped transcription model.');
  req.scoped.state.captions = { providerId: id, model };
  store.save();
  res.json(req.scoped.state.captions);
});
app.get('/api/mcp', (req, res) => res.json(req.scoped.state.mcps.map(publicMcp)));
app.post('/api/mcp', (req, res) => {
  const profile = mcpInput(req.body || {}, null, store);
  req.scoped.state.mcps.push(profile);
  store.save();
  res.status(201).json(publicMcp(profile));
});
app.put('/api/mcp/:id', (req, res) => {
  const profile = mcpById(req);
  Object.assign(profile, mcpInput(req.body || {}, profile, store));
  store.save();
  res.json(publicMcp(profile));
});
app.delete('/api/mcp/:id', (req, res) => {
  const item = mcpById(req);
  req.scoped.state.mcps = req.scoped.state.mcps.filter((profile) => profile !== item);
  store.save();
  res.status(204).end();
});
app.post('/api/mcp/:id/inspect', async (req, res) => {
  networkLimit(`mcp:${req.account.id}`, 16);
  const profile = mcpById(req), snapshot = { ...profile };
  const tools = await inspectMcp(snapshot, store);
  if (profile.secret === snapshot.secret && profile.url === snapshot.url && req.scoped.state.mcps.includes(profile)) {
    profile.checkedAt = new Date().toISOString();
    store.save();
  }
  res.json(tools);
});
app.post('/api/mcp/:id/run', async (req, res) => {
  networkLimit(`mcp:${req.account.id}`, 16);
  res.json(await runMcp({ ...mcpById(req) }, store, req.body || {}));
});
app.post('/api/mcp/:id/organizations', async (req, res) => {
  networkLimit(`mcp:${req.account.id}`, 16);
  res.json(await bufferOrganizations(bufferFor(req, req.params.id), store));
});
app.post('/api/mcp/:id/channels', async (req, res) => {
  networkLimit(`mcp:${req.account.id}`, 16);
  res.json(await listBufferChannels(bufferFor(req, req.params.id), store, req.body?.organizationId));
});

const sites = ['google', 'tiktok'];
for (const site of sites) {
  app.put(`/api/${site}/config`, (req, res) => res.json(connections(req.account)[site].configure(req.body || {})));
  app.post(`/api/${site}/connect`, (req, res) => {
    const origin = req.get('origin') || publicOrigin || `${secure(req) ? 'https' : 'http'}://${req.get('host')}`;
    const service = connections(req.account)[site];
    const result = site === 'google' ? service.connect(req.body?.targets, origin) : { url: service.connect(origin), secure: true };
    res.cookie(`cf_${site}_state`, result.state || new URL(result.url).searchParams.get('state'), { secure: result.secure, httpOnly: true, sameSite: 'lax', maxAge: 600_000, path: `/api/${site}/callback` });
    res.json({ url: result.url });
  });
  app.post(`/api/${site}/disconnect`, (req, res) => { const service = connections(req.account)[site]; service.disconnect(); res.json(service.describe()); });
}
app.use('/api', (_req, res) => res.status(404).json({ error: 'No Curiousity API route matches this path and HTTP method.', code: 'API_ROUTE_NOT_FOUND' }));

const watcher = dev ? await (await import('../scripts/build.mjs')).buildWeb({ watch: true }) : null;
// Serve complete public documents at the clean paths, before the SPA fallback.
for (const page of ['terms', 'privacy']) app.get(`/${page}`, (_req, res) => res.sendFile(join(ROOT, 'public', page, 'index.html')));
app.use(express.static(webRoot, { dotfiles: 'deny' }));
app.get('/{*path}', (_req, res) => res.sendFile(join(webRoot, 'index.html')));
app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
  const message = error instanceof HttpError ? error.message : status === 404 || error.code === 'ENOENT' ? 'File not found.' : status === 400 ? 'Invalid request body.' : status === 413 ? 'Request is too large.' : 'The workspace could not complete this request.';
  if (status >= 500 && !(error instanceof HttpError)) console.error('Request failed:', error.code || error.name);
  res.status(error.code === 'ENOENT' ? 404 : status).json({ error: message });
});
server.listen(port, host, () => {
  console.log(`Curiousity listening on http://${host}:${server.address().port}`);
  queueMicrotask(work);
});
for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => {
  closing = true;
  clearTimeout(replayTimer);
  current?.ctrl.abort(new Error('Server is stopping.'));
  server.close(() => { if (watcher) watcher.dispose().finally(() => process.exit(0)); else process.exit(0); });
  setTimeout(() => process.exit(0), 4500).unref();
});
