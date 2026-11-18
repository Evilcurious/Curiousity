import express from 'express';
import { createServer } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createStore, activeStatuses, jobDir, maxSourceSeconds } from './store.mjs';
import { processProject } from './media.mjs';
import { HttpError, jobOptions, maxClips, liveLimits, text } from './validation.mjs';
import { compatibleProvider, listModels, providerInput, publicProvider } from './providers.mjs';
import { createTikTok } from './tiktok.mjs';
import { createGoogle, googleUploadActive, publicGoogleUploads } from './google.mjs';
import { ROOT, toolsStatus } from './tools.mjs';

const dev = process.argv.includes('--dev');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 5173);
const user = process.env.AUTH_USER || 'clipforge';
const password = process.env.AUTH_PASSWORD;
if (!dev && !['127.0.0.1', '::1', 'localhost'].includes(host) && !password) {
  console.error('Set a strong AUTH_PASSWORD before binding Clipforge to a network interface. Use HTTPS on a VPS.');
  process.exit(1);
}

const app = express();
const server = createServer(app);
const store = createStore();
let recovering = false;
for (const job of store.state.jobs) {
  if (activeStatuses.has(job.status) && job.status !== 'queued') {
    job.status = 'failed';
    job.detail = 'The server restarted before this project finished.';
    job.error = job.detail;
    await rm(join(jobDir(job.id), 'work'), { recursive: true, force: true });
    recovering = true;
  }
}
if (recovering) store.save();
const tiktok = createTikTok(store);
const google = createGoogle(store);
let current;
let closing = false;
const deleting = new Set();
const absoluteMedia = join(ROOT, 'dist');

const hash = (value) => createHash('sha256').update(value).digest();
const jobById = (id) => {
  const job = store.state.jobs.find((item) => item.id === id);
  if (!job || deleting.has(id)) throw new HttpError(404, 'This project could not be found.');
  return job;
};
const clipById = (job, id) => {
  const clip = job.clips.find((item) => item.id === id);
  if (!clip) throw new HttpError(404, 'This clip could not be found.');
  return clip;
};
const profileById = (id) => {
  const profile = store.state.providers.find((item) => item.id === id);
  if (!profile) throw new HttpError(404, 'This provider profile could not be found.');
  return profile;
};
function jobPublic(job) {
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
  const job = [...store.state.jobs].reverse().find((item) => item.status === 'queued');
  if (!job) return;
  const ctrl = new AbortController();
  const session = { signal: ctrl.signal, finishCapture: null };
  current = { ctrl, job, session };
  try {
    await processProject(job, store, session, (changes) => touch(job, changes));
  } catch (error) {
    if (ctrl.signal.aborted) touch(job, { status: 'cancelled', detail: 'Project stopped.' });
    else touch(job, { status: 'failed', error: error.message || 'Project processing failed.', detail: error.message || 'Project processing failed.' });
  } finally {
    current = null;
    queueMicrotask(work);
  }
}

app.disable('x-powered-by');
app.get('/api/tiktok/callback', async (req, res) => {
  let result = 'TikTok connected.';
  try {
    const cookie = (req.get('cookie') || '').split(/;\s*/).find((item) => item.startsWith('cf_tiktok_state='))?.slice('cf_tiktok_state='.length);
    if (!cookie || cookie !== req.query.state) throw new HttpError(400, 'This TikTok connection was not started in this browser. Try again from Integrations.');
    await tiktok.callback(req.query);
  } catch (error) { result = error.status ? error.message : 'TikTok connection failed.'; }
  res.clearCookie('cf_tiktok_state', { httpOnly: true, sameSite: 'lax', secure: true, path: '/api/tiktok/callback' });
  res.set('Referrer-Policy', 'no-referrer').set('Cache-Control', 'no-store').redirect(303, `/#/integrations?notice=${encodeURIComponent(result)}`);
});
app.get('/api/google/callback', async (req, res) => {
  let result = 'Google connected.';
  try {
    const cookie = (req.get('cookie') || '').split(/;\s*/).find((item) => item.startsWith('cf_google_state='))?.slice('cf_google_state='.length);
    if (!cookie || cookie !== req.query.state) throw new HttpError(400, 'This Google connection was not started in this browser. Try again from Integrations.');
    await google.callback(req.query);
  } catch (error) { result = error instanceof HttpError ? error.message : 'Google connection failed.'; }
  res.clearCookie('cf_google_state', { httpOnly: true, sameSite: 'lax', path: '/api/google/callback' });
  res.set('Referrer-Policy', 'no-referrer').set('Cache-Control', 'no-store').redirect(303, `/#/integrations?notice=${encodeURIComponent(result)}`);
});
if (password) {
  const expected = hash(`${user}:${password}`);
  app.use((req, res, next) => {
    const match = req.get('authorization')?.match(/^Basic ([A-Za-z0-9+/=]+)$/i);
    if (match && timingSafeEqual(hash(Buffer.from(match[1], 'base64')), expected)) return next();
    res.set('WWW-Authenticate', 'Basic realm="Clipforge workspace", charset="UTF-8"').status(401).send('Sign in to the Clipforge workspace.');
  });
}
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD'].includes(req.method)) {
    const origin = req.get('origin');
    let sameHost = !origin;
    if (origin) {
      try {
        const actual = new URL(origin).host;
        const forwarded = req.get('x-forwarded-host')?.split(',')[0]?.trim();
        sameHost = actual === req.get('host') || (dev && actual.endsWith('.e2b.app') && actual === forwarded);
      } catch { /* Reject malformed origins. */ }
    }
    if (req.get('x-clipforge') !== 'workspace' || !sameHost || ['cross-site', 'same-site'].includes(req.get('sec-fetch-site'))) return next(new HttpError(403, 'Requests must come from this workspace.'));
  }
  next();
});
app.use('/api', express.json({ limit: '96kb' }));

app.get('/api/workspace', async (_req, res) => {
  const { providers, activeProviderId, captions } = store.state;
  res.json({ online: true, tools: await toolsStatus(), providers: providers.map(publicProvider), activeProviderId, captions,
    tiktok: tiktok.describe(), google: google.describe(), maxClips, liveLimits, maxSourceMinutes: Math.round(maxSourceSeconds / 60) });
});
app.get('/api/projects', (_req, res) => res.json(store.state.jobs.map(jobPublic)));
app.post('/api/projects', async (req, res) => {
  const options = jobOptions(req.body || {});
  const tools = await toolsStatus();
  if (!tools.ffmpeg || (!options.demo && !tools.ytDlp)) throw new HttpError(503, 'Media tools are missing. Open the Setup guide and run npm run setup.');
  if (options.tiktok && !tiktok.describe().connected) throw new HttpError(409, 'Connect a TikTok account before adding drafts to this project.');
  if (store.state.jobs.filter((item) => activeStatuses.has(item.status)).length >= 10) throw new HttpError(429, 'The project queue is full. Wait for a project to finish.');
  const now = new Date().toISOString();
  const job = { id: randomUUID(), title: options.demo ? 'The anatomy of a great hook' : 'YouTube project', options, status: 'queued', detail: 'Waiting for the media worker.', progress: 0, clips: [], createdAt: now, updatedAt: now };
  store.state.jobs.unshift(job);
  store.save();
  res.status(202).json(jobPublic(job));
  queueMicrotask(work);
});
app.get('/api/projects/:id', (req, res) => res.json(jobPublic(jobById(req.params.id))));
app.post('/api/projects/:id/cancel', (req, res) => {
  const job = jobById(req.params.id);
  if (current?.job === job && activeStatuses.has(job.status)) {
    if (!current.ctrl.signal.aborted) current.ctrl.abort(new Error('Project stopped.'));
  } else if (job.status === 'queued') touch(job, { status: 'cancelled', detail: 'Project removed from the queue.' });
  res.json(jobPublic(job));
});
app.post('/api/projects/:id/finish-capture', (req, res) => {
  const job = jobById(req.params.id);
  if (current?.job !== job || !current.session.finishCapture) throw new HttpError(409, 'This project is not capturing a livestream right now.');
  if (job.capturedSeconds < 6) throw new HttpError(409, 'Wait until at least six seconds have been captured.');
  current.session.finishCapture();
  touch(job, { detail: 'Closing the live recording and preparing to analyze it.' });
  res.json(jobPublic(job));
});
app.delete('/api/projects/:id', async (req, res) => {
  const job = jobById(req.params.id);
  if (activeStatuses.has(job.status) || job.clips.some((clip) => googleUploadActive(clip) || ['queued', 'uploading', 'processing'].includes(clip.tiktok?.state))) throw new HttpError(409, 'Wait for the project and any uploads to finish before deleting it.');
  deleting.add(job.id);
  try {
    await rm(jobDir(job.id), { recursive: true, force: true });
    store.state.jobs = store.state.jobs.filter((item) => item !== job);
    store.save();
  } finally { deleting.delete(job.id); }
  res.status(204).end();
});
app.get('/api/projects/:id/clips/:clip/:file', (req, res, next) => {
  const job = jobById(req.params.id);
  const clip = clipById(job, req.params.clip);
  const file = req.params.file;
  if (!['video.mp4', 'poster.jpg', 'captions.srt'].includes(file)) throw new HttpError(404, 'File not found.');
  if (file === 'captions.srt') res.type('application/x-subrip');
  const path = join(jobDir(job.id), clip.id, file);
  const filename = `clipforge-${job.id.slice(0, 8)}-${clip.id}.${file.split('.').at(-1)}`;
  if (req.query.download === '1') res.download(path, filename, { dotfiles: 'allow' }, (error) => { if (error) next(error); });
  else res.sendFile(path, { dotfiles: 'allow' }, (error) => { if (error) next(error); });
});
app.post('/api/projects/:id/google', (req, res) => {
  const job = jobById(req.params.id);
  google.queue(job, req.body || {});
  res.status(202).json(jobPublic(job));
});
app.post('/api/projects/:id/tiktok', (req, res) => {
  const job = jobById(req.params.id);
  tiktok.queue(job, req.body || {});
  res.status(202).json(jobPublic(job));
});
app.post('/api/projects/:id/clips/:clip/tiktok/check', (req, res) => {
  const job = jobById(req.params.id);
  tiktok.checkStatus(clipById(job, req.params.clip));
  res.status(202).json(jobPublic(job));
});

app.post('/api/providers', (req, res) => {
  const profile = { id: randomUUID(), ...providerInput(req.body || {}, null, store) };
  store.state.providers.push(profile);
  store.save();
  res.status(201).json(publicProvider(profile));
});
app.put('/api/providers/:id', (req, res) => {
  const profile = profileById(req.params.id);
  const next = providerInput(req.body || {}, profile, store);
  if (store.state.activeProviderId === profile.id && !next.model) store.state.activeProviderId = null;
  if (store.state.captions.providerId === profile.id && !compatibleProvider(next)) store.state.captions = { providerId: null, model: '' };
  Object.assign(profile, next);
  store.save();
  res.json(publicProvider(profile));
});
app.delete('/api/providers/:id', (req, res) => {
  const profile = profileById(req.params.id);
  store.state.providers = store.state.providers.filter((item) => item !== profile);
  if (store.state.activeProviderId === profile.id) store.state.activeProviderId = null;
  if (store.state.captions.providerId === profile.id) store.state.captions = { providerId: null, model: '' };
  store.save();
  res.status(204).end();
});
app.post("/api/providers/catalog", async (req, res) => {
  const input = req.body || {};
  const existing = input.id ? profileById(input.id) : null;
  const profile = providerInput(input, existing, store);
  res.json({ models: await listModels(profile, store) });
});
app.get('/api/providers/:id/models', async (req, res) => res.json({ models: await listModels(profileById(req.params.id), store) }));
app.put('/api/settings/ranking', (req, res) => {
  const id = req.body?.providerId;
  if (id && !profileById(id).model) throw new HttpError(400, 'Choose a chat model for this profile first.');
  store.state.activeProviderId = id || null;
  store.save();
  res.json({ activeProviderId: store.state.activeProviderId });
});
app.put('/api/settings/captions', (req, res) => {
  const id = req.body?.providerId || null;
  const model = id ? text(req.body?.model, 160) : '';
  if (id && (!compatibleProvider(profileById(id)) || !model)) throw new HttpError(400, 'Choose an OpenAI-compatible profile and a timestamped transcription model.');
  store.state.captions = { providerId: id, model };
  store.save();
  res.json(store.state.captions);
});
app.put('/api/google/config', (req, res) => res.json(google.configure(req.body || {})));
app.post('/api/google/connect', (req, res) => {
  const origin = req.get('origin') || `${req.protocol}://${req.get('host')}`;
  const link = google.connect(req.body?.targets, origin);
  res.cookie('cf_google_state', link.state, { secure: link.secure, httpOnly: true, sameSite: 'lax', maxAge: 600_000, path: '/api/google/callback' });
  res.json({ url: link.url });
});
app.post('/api/google/disconnect', (_req, res) => { google.disconnect(); res.json(google.describe()); });
app.put('/api/tiktok/config', (req, res) => res.json(tiktok.configure(req.body || {})));
app.post('/api/tiktok/connect', (_req, res) => {
  const url = tiktok.connect();
  const state = new URL(url).searchParams.get('state');
  res.cookie('cf_tiktok_state', state, { secure: true, httpOnly: true, sameSite: 'lax', maxAge: 600_000, path: '/api/tiktok/callback' });
  res.json({ url });
});
app.post('/api/tiktok/disconnect', (_req, res) => { tiktok.disconnect(); res.json(tiktok.describe()); });
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'API route not found.')));

const watcher = dev ? await (await import('../scripts/build.mjs')).buildWeb({ watch: true }) : null;
app.use(express.static(absoluteMedia, { dotfiles: 'deny' }));
app.get('/{*path}', (_req, res) => res.sendFile(join(absoluteMedia, 'index.html')));
app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
  const message = error instanceof HttpError ? error.message : status === 404 || error.code === 'ENOENT' ? 'File not found.' : status === 400 ? 'Invalid request body.' : status === 413 ? 'Request is too large.' : 'The workspace could not complete this request.';
  if (status >= 500 && !(error instanceof HttpError)) console.error('Request failed:', error.code || error.name);
  res.status(error.code === 'ENOENT' ? 404 : status).json({ error: message });
});
server.listen(port, host, () => {
  console.log(`Clipforge listening on http://${host}:${server.address().port}`);
  queueMicrotask(work);
});
for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => {
  closing = true;
  current?.ctrl.abort(new Error('Server is stopping.'));
  server.close(() => { if (watcher) watcher.dispose().finally(() => process.exit(0)); else process.exit(0); });
  setTimeout(() => process.exit(0), 4500).unref();
});
