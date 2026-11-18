import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpeg, run } from '../server/tools.mjs';

const password = 'integration-test-only';
const headers = { Authorization: `Basic ${Buffer.from(`clipforge:${password}`).toString('base64')}`, 'X-Clipforge': 'workspace' };

async function boot(env, t) {
  const child = spawn(process.execPath, ['server/main.mjs'], { env: { ...process.env, HOST: '127.0.0.1', PORT: '0', AUTH_USER: 'clipforge', AUTH_PASSWORD: password, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REDIRECT_URI: '', ...env } });
  const exit = new Promise((resolve) => child.once('close', resolve));
  t.after(async () => { child.kill('SIGTERM'); await exit; });
  const url = await new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error('Engine did not start.')), 10000);
    timer.unref();
    let log = '';
    child.stderr.on('data', (chunk) => { log += chunk.toString(); });
    child.stdout.on('data', (chunk) => {
      const match = chunk.toString().match(/listening on (http:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Engine exited (${code}): ${log}`)); });
    child.once('error', reject);
  });
  const request = (path, options = {}) => fetch(`${url}/api${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const post = (path, body) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { url, post, request };
}
async function done(request, id) {
  const timeout = Date.now() + 45_000;
  while (Date.now() < timeout) {
    const job = await (await request(`/projects/${id}`)).json();
    if (['ready', 'failed', 'cancelled'].includes(job.status)) return job;
    await setTimeout(250);
  }
  throw new Error('Project did not finish.');
}

async function waitForCapture(request, id) {
  for (let i = 0; i < 40; i++) {
    const filming = await (await request(`/projects/${id}`)).json();
    if (filming.status === 'capturing' && filming.capturedSeconds >= 6) return filming;
    assert.notEqual(filming.status, 'failed', filming.error);
    await setTimeout(180);
  }
  throw new Error('Live capture did not report media progress.');
}

test('engine validates and authenticates writes, renders MP4/SRT, and handles replay and live-capture fixtures', { timeout: 120_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cf-engine-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await boot({ DATA_DIR: join(root, '.hidden-workspace') }, t);
  assert.equal((await fetch(`${app.url}/api/workspace`)).status, 401);
  const domain = await app.request('/projects', { method: 'POST', headers: { Origin: 'https://unrelated.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(domain.status, 403);
  const malformed = await app.post('/projects', { url: 'https://example.net/video', count: 3 });
  assert.equal(malformed.status, 400);
  const workspace = await (await app.request('/workspace')).json();
  assert.deepEqual(workspace.google.grants, { drive: false, youtube: false });
  const google = await app.request('/google/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: 'demo-client-id', clientSecret: 'dummy-secret', redirectUri: `${app.url}/api/google/callback` }) });
  assert.equal(google.status, 200);
  assert.equal((await google.json()).clientSecret, undefined);
  const signed = await app.post('/google/connect', { targets: ['drive'] });
  assert.equal(signed.status, 200);
  const cookie = signed.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  const auth = new URL((await signed.json()).url);
  const result = `${app.url}/api/google/callback?state=${auth.searchParams.get('state')}&error=access_denied`;
  const noCookie = await fetch(result, { redirect: 'manual' });
  assert.equal(noCookie.status, 303);
  assert.match(decodeURIComponent(noCookie.headers.get('location')), /not started in this browser/);
  const cancelled = await fetch(result, { redirect: 'manual', headers: { Cookie: cookie.split(';')[0] } });
  assert.equal(cancelled.status, 303);
  assert.match(decodeURIComponent(cancelled.headers.get('location')), /cancelled or declined/);
  if (!workspace.tools.ffmpeg) { t.diagnostic('FFmpeg is not installed; validated the HTTP API, skipping the media portion.'); return; }
  const res = await app.post('/projects', { demo: true, count: 1, captions: true, platform: 'instagram', aspectRatio: '6:4', captionLanguage: 'ur', hashtagLanguage: 'es' });
  assert.equal(res.status, 202);
  let job = await done(app.request, (await res.json()).id);
  assert.equal(job.status, 'ready', job.error);
  assert.equal(job.clips.length, 1);
  assert.equal(job.clips[0].burnedCaptions, workspace.tools.subtitles);
  const [clip] = job.clips;
  assert.deepEqual(job.frame, { ratio: '3:2', width: 1280, height: 854 });
  assert.equal(clip.captionLanguage, 'ur');
  assert.equal(clip.hashtagLanguage, 'es');
  assert.ok(clip.hashtags.includes('#MejoresMomentos'));
  assert.equal(job.captionsSource, 'Bundled translation');
  assert.doesNotMatch(job.warnings.join(' '), /could not be drawn/);
  const mediaDir = join(root, '.hidden-workspace', 'projects', job.id, clip.id);
  const probe = async (filename) => (await run(ffmpeg, ['-hide_banner', '-i', filename, '-t', '0', '-f', 'null', '-'], { cwd: mediaDir })).err;
  assert.match(await probe('video.mp4'), /Video: h264[^\n]*\b1280x854\b/);
  assert.match(await probe('poster.jpg'), /Video: mjpeg[^\n]*\b640x426\b/);
  const mp4 = await fetch(`${app.url}${clip.videoUrl}?download=1`, { headers: { ...headers, Range: 'bytes=0-15' } });
  assert.equal(mp4.status, 206);
  assert.match(mp4.headers.get('content-disposition'), /^attachment/);
  assert.equal(Buffer.from(await mp4.arrayBuffer()).toString('ascii', 4, 8), 'ftyp');
  const srt = await fetch(`${app.url}${clip.captionsUrl}`, { headers });
  assert.equal(srt.status, 200);
  const text = await srt.text();
  assert.match(text, /^1\n\d{2}:\d{2}:\d{2},\d{3} --> /);
  assert.match(text, /\p{Script=Arabic}/u);
  const poster = await fetch(`${app.url}${clip.posterUrl}`, { headers });
  assert.equal(poster.status, 200);
  assert.equal(poster.headers.get('content-type'), 'image/jpeg');
  await poster.arrayBuffer();
  const data = join(root, 'replay');
  const replay = await boot({ DATA_DIR: data, YTDLP_BIN: join(import.meta.dirname, 'fixtures', 'ytdlp.mjs'),
    FIXTURE_INPUT: join(root, '.hidden-workspace', 'projects', job.id, clip.id, 'video.mp4'),
    FFMPEG_BIN: join(import.meta.dirname, 'fixtures', 'ffmpeg.mjs'), FIXTURE_FFMPEG: ffmpeg, PYTHON_BIN: '/bin/false', MAX_SOURCE_MINUTES: '1', FIXTURE_LIVE_LIMIT_SECONDS: '60', MAX_SOURCE_MB: '10',
  }, t);
  const video = await replay.post('/projects', { url: 'https://youtu.be/dQw4w9WgXcQ', count: 1, mode: 'auto', platform: 'youtube-landscape', captionLanguage: 'es', hashtagLanguage: 'off' });
  assert.equal(video.status, 202);
  job = await done(replay.request, (await video.json()).id);
  assert.equal(job.status, 'ready', job.error);
  assert.equal(job.sourceKind, 'replay');
  assert.equal(job.captionsSource, 'YouTube transcript');
  assert.ok(job.signals.includes('Replay heatmap'));
  assert.equal(job.clips[0].withCaptions, true);
  assert.equal(job.clips[0].captionLanguage, 'es');
  assert.equal(job.frame.ratio, '16:9');
  assert.deepEqual(job.clips[0].hashtags, []);
  assert.match(await (await fetch(`${replay.url}${job.clips[0].captionsUrl}`, { headers })).text(), /un gancho/);
  const untranslated = await replay.post('/projects', { url: 'https://youtu.be/dQw4w9WgXcQ', count: 1, aspectRatio: '1:1', captionLanguage: 'ja' });
  const fallback = await done(replay.request, (await untranslated.json()).id);
  assert.equal(fallback.status, 'ready', fallback.error);
  assert.equal(fallback.clips[0].captionLanguage, 'en');
  assert.match(fallback.warnings.join(' '), /Could not produce Japanese captions/);
  const stopped = await replay.post('/projects', { url: 'https://youtu.be/dQw4w9WgXcQ', count: 1, mode: 'live', liveMinutes: 5 });
  const notLive = await done(replay.request, (await stopped.json()).id);
  assert.equal(notLive.status, 'failed');
  assert.match(notLive.detail, /not currently live/);
  assert.equal((await replay.request(`/projects/${job.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await replay.request(`/projects/${job.id}`)).status, 404);
  const live = await replay.post('/projects', { url: 'https://www.youtube.com/live/Q1L2M3N4O56', count: 1, mode: 'auto' });
  assert.equal(live.status, 202);
  const liveId = (await live.json()).id;
  const filming = await waitForCapture(replay.request, liveId);
  assert.equal(filming.captureLimitSeconds, 60);
  assert.match(filming.detail, /separate audio/);
  const finish = await replay.post(`/projects/${liveId}/finish-capture`, {});
  assert.equal(finish.status, 200);
  const window = await done(replay.request, liveId);
  assert.equal(window.status, 'ready', window.error);
  assert.equal(window.sourceKind, 'live');
  assert.equal(window.clips.length, 1);
  assert.ok(window.duration >= 6 && window.duration <= 14);
  assert.equal(window.liveInput, 'HLS with separate audio');

  async function startLive(id, options = {}) {
    const response = await replay.post('/projects', { url: `https://www.youtube.com/live/${id}`, count: 1, liveMinutes: 30, ...options });
    assert.equal(response.status, 202);
    return (await response.json()).id;
  }
  const dash = await done(replay.request, await startLive('DASHonly001'));
  assert.equal(dash.status, 'ready', dash.error);
  assert.equal(dash.liveInput, 'DASH manifest');
  const silent = await done(replay.request, await startLive('SilentLive1'));
  assert.equal(silent.status, 'ready', silent.error);
  assert.equal(silent.liveInput, 'video-only HLS');
  assert.equal(silent.clips[0].withCaptions, false);
  assert.match(silent.warnings.join(' '), /no audio track/);
  const cancelledId = await startLive('Q1L2M3N4O56');
  await waitForCapture(replay.request, cancelledId);
  assert.equal((await replay.post(`/projects/${cancelledId}/cancel`, {})).status, 200);
  const cancelledLive = await done(replay.request, cancelledId);
  assert.equal(cancelledLive.status, 'cancelled');
  await assert.rejects(access(join(data, 'projects', cancelledId, 'work')), { code: 'ENOENT' });
  const oversize = await done(replay.request, await startLive('SizeLimit01'));
  assert.equal(oversize.status, 'failed');
  assert.match(oversize.error, /size limit/);
  const rejected = await done(replay.request, await startLive('Rejected001'));
  assert.equal(rejected.status, 'failed');
  assert.match(rejected.error, /declined the public live media requests/);
  const noFormats = await done(replay.request, await startLive('NoFormats01'));
  assert.equal(noFormats.status, 'failed');
  assert.match(noFormats.error, /HLS or DASH/);
});
