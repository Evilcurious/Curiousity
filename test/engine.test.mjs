import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpeg } from '../server/tools.mjs';

const password = 'integration-test-only';
const headers = { Authorization: `Basic ${Buffer.from(`clipforge:${password}`).toString('base64')}`, 'X-Clipforge': 'workspace' };

async function boot(env, t) {
  const child = spawn(process.execPath, ['server/main.mjs'], { env: { ...process.env, HOST: '127.0.0.1', PORT: '0', AUTH_USER: 'clipforge', AUTH_PASSWORD: password, ...env } });
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
  if (!workspace.tools.ffmpeg) { t.diagnostic('FFmpeg is not installed; validated the HTTP API, skipping the media portion.'); return; }
  const res = await app.post('/projects', { demo: true, count: 1, captions: true });
  assert.equal(res.status, 202);
  let job = await done(app.request, (await res.json()).id);
  assert.equal(job.status, 'ready', job.error);
  assert.equal(job.clips.length, 1);
  assert.equal(job.clips[0].burnedCaptions, workspace.tools.subtitles);
  const [clip] = job.clips;
  const mp4 = await fetch(`${app.url}${clip.videoUrl}?download=1`, { headers: { ...headers, Range: 'bytes=0-15' } });
  assert.equal(mp4.status, 206);
  assert.match(mp4.headers.get('content-disposition'), /^attachment/);
  assert.equal(Buffer.from(await mp4.arrayBuffer()).toString('ascii', 4, 8), 'ftyp');
  const srt = await fetch(`${app.url}${clip.captionsUrl}`, { headers });
  assert.equal(srt.status, 200);
  assert.match(await srt.text(), /^1\n\d{2}:\d{2}:\d{2},\d{3} --> /);
  const poster = await fetch(`${app.url}${clip.posterUrl}`, { headers });
  assert.equal(poster.status, 200);
  assert.equal(poster.headers.get('content-type'), 'image/jpeg');
  await poster.arrayBuffer();
  const replay = await boot({ DATA_DIR: join(root, 'replay'), YTDLP_BIN: join(import.meta.dirname, 'fixtures', 'ytdlp.mjs'),
    FIXTURE_INPUT: join(root, '.hidden-workspace', 'projects', job.id, clip.id, 'video.mp4'),
    FFMPEG_BIN: join(import.meta.dirname, 'fixtures', 'ffmpeg.mjs'), FIXTURE_FFMPEG: ffmpeg, PYTHON_BIN: '/bin/false',
  }, t);
  const video = await replay.post('/projects', { url: 'https://youtu.be/dQw4w9WgXcQ', count: 1, mode: 'auto' });
  assert.equal(video.status, 202);
  job = await done(replay.request, (await video.json()).id);
  assert.equal(job.status, 'ready', job.error);
  assert.equal(job.sourceKind, 'replay');
  assert.equal(job.captionsSource, 'YouTube transcript');
  assert.ok(job.signals.includes('Replay heatmap'));
  assert.equal(job.clips[0].withCaptions, true);
  const stopped = await replay.post('/projects', { url: 'https://youtu.be/dQw4w9WgXcQ', count: 1, mode: 'live', liveMinutes: 5 });
  const notLive = await done(replay.request, (await stopped.json()).id);
  assert.equal(notLive.status, 'failed');
  assert.match(notLive.detail, /not currently live/);
  assert.equal((await replay.request(`/projects/${job.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await replay.request(`/projects/${job.id}`)).status, 404);
  const live = await replay.post('/projects', { url: 'https://www.youtube.com/live/Q1L2M3N4O56', count: 1, mode: 'auto' });
  assert.equal(live.status, 202);
  const liveId = (await live.json()).id;
  let sawCapture = false;
  for (let i = 0; i < 40; i++) {
    const filming = await (await replay.request(`/projects/${liveId}`)).json();
    if (filming.status === 'capturing' && filming.capturedSeconds >= 6) { sawCapture = true; break; }
    assert.notEqual(filming.status, 'failed', filming.error);
    await setTimeout(250);
  }
  assert.equal(sawCapture, true);
  const finish = await replay.post(`/projects/${liveId}/finish-capture`, {});
  assert.equal(finish.status, 200);
  const window = await done(replay.request, liveId);
  assert.equal(window.status, 'ready', window.error);
  assert.equal(window.sourceKind, 'live');
  assert.equal(window.clips.length, 1);
  assert.ok(window.duration >= 6 && window.duration <= 14);
});
