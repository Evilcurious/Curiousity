import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpeg, run } from '../server/tools.mjs';
import { defaultCaptionStyle } from '../shared/captions.mjs';

import { exampleAdmin, startEngine } from './helpers/http.mjs';

async function boot(env, t) {
  const engine = await startEngine(t, { env: { ADMIN_EMAIL: exampleAdmin.email, ADMIN_PASSWORD: exampleAdmin.password, ...env } });
  const app = engine.agent();
  const session = await app.signin();
  assert.equal(session.status, 200, await session.text());
  return { ...app, agent: engine.agent };
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
    if (filming.status === 'capturing' && filming.monitor?.canAnalyze) return filming;
    assert.notEqual(filming.status, 'failed', filming.error);
    await setTimeout(180);
  }
  throw new Error('Live capture did not report media progress.');
}

test('API saves repeated provider profiles, keeps distinct keys, and separates ranking from transcription', { timeout: 25_000 }, async (t) => {
  const data = await mkdtemp(join(tmpdir(), 'cf-profile-api-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const app = await boot({ DATA_DIR: data }, t);
  const profiles = [];
  for (let i = 0; i < 22; i++) {
    const type = i % 2 ? 'custom' : 'deepseek';
    const body = { name: 'Same display name', type, baseUrl: type === 'custom' ? 'https://chat.example/v1/' : 'https://ignored.example/v1', apiKey: `ephemeral-test-key-${i}`, model: `chat-model-${i}` };
    const response = await app.post('/providers', body);
    assert.equal(response.status, 201);
    const profile = await response.json();
    assert.equal(profile.hasKey, true);
    assert.equal(profile.apiKey, undefined);
    assert.equal(profile.baseUrl, type === 'custom' ? 'https://chat.example/v1' : 'https://api.deepseek.com/v1');
    profiles.push(profile);
  }
  assert.equal(new Set(profiles.map(({ id }) => id)).size, 22);
  const settings = (path, body) => app.request(`/settings/${path}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await settings('ranking', { providerId: profiles[0].id })).status, 200);
  assert.equal((await settings('captions', { providerId: profiles[1].id, model: 'timestamped-audio' })).status, 200);
  const workspace = await (await app.request('/workspace')).json();
  assert.equal(workspace.providers.length, 22);
  assert.equal(workspace.activeProviderId, profiles[0].id);
  assert.deepEqual(workspace.captions, { providerId: profiles[1].id, model: 'timestamped-audio' });
  const disk = await readFile(join(data, 'workspace.json'), 'utf8');
  assert.doesNotMatch(disk, /ephemeral-test-key-/);
  assert.equal(new Set(JSON.parse(disk).users[0].workspace.providers.map(({ apiKey }) => apiKey)).size, 22);
  assert.equal((await app.request(`/providers/${profiles[0].id}`, { method: 'DELETE' })).status, 204);
  const changed = await (await app.request('/workspace')).json();
  assert.equal(changed.activeProviderId, null);
  assert.equal(changed.captions.providerId, profiles[1].id);
  assert.equal(changed.providers.length, 21);
});

test('engine validates and authenticates writes, renders MP4/SRT, and handles replay and live-capture fixtures', { timeout: 120_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cf-engine-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await boot({ DATA_DIR: join(root, '.hidden-workspace'), ENABLE_LEGACY_INTEGRATION_API: 'true' }, t);
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
  const noCookie = await fetch(result, { redirect: 'manual', headers: app.getHeaders() });
  assert.equal(noCookie.status, 303);
  assert.match(decodeURIComponent(noCookie.headers.get('location')), /not started in this browser/);
  const cancelled = await fetch(result, { redirect: 'manual', headers: { Cookie: `${app.getHeaders().Cookie}; ${cookie.split(';')[0]}` } });
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
  const mp4 = await fetch(`${app.url}${clip.videoUrl}?download=1`, { headers: { ...app.getHeaders(), Range: 'bytes=0-15' } });
  assert.equal(mp4.status, 206);
  assert.match(mp4.headers.get('content-disposition'), /^attachment/);
  assert.equal(Buffer.from(await mp4.arrayBuffer()).toString('ascii', 4, 8), 'ftyp');
  const srt = await fetch(`${app.url}${clip.captionsUrl}`, { headers: app.getHeaders() });
  assert.equal(srt.status, 200);
  const text = await srt.text();
  assert.match(text, /^1\n\d{2}:\d{2}:\d{2},\d{3} --> /);
  assert.match(text, /\p{Script=Arabic}/u);
  const poster = await fetch(`${app.url}${clip.posterUrl}`, { headers: app.getHeaders() });
  assert.equal(poster.status, 200);
  assert.equal(poster.headers.get('content-type'), 'image/jpeg');
  await poster.arrayBuffer();
  const style = { font: 'serif', effect: 'glow', size: 'large', animation: 'pop', exitAnimation: 'fade' };
  const styledDemo = await app.post('/projects', { demo: true, count: 'auto', captionLanguage: 'ur-Latn', captionStyle: style, hashtagLanguage: 'es' });
  assert.equal(styledDemo.status, 202);
  const themed = await done(app.request, (await styledDemo.json()).id);
  assert.equal(themed.status, 'ready', themed.error);
  assert.deepEqual(themed.autoSelection, { count: 2, fallback: false });
  assert.deepEqual(themed.options.captionStyle, style);
  assert.equal(themed.options.aiProfile, 'local');
  assert.equal(themed.captionsSource, 'Bundled translation');
  for (const shot of themed.clips) {
    assert.equal(shot.captionLanguage, 'ur-Latn');
    assert.ok(shot.hashtags.includes('#MejoresMomentos'));
    assert.equal(shot.burnedCaptions, workspace.tools.subtitles);
    const srt = await (await fetch(`${app.url}${shot.captionsUrl}`, { headers: app.getHeaders() })).text();
    assert.match(srt, /[A-Za-z]{3,} [A-Za-z]{3,}/);
    assert.doesNotMatch(srt, /\p{Script=Arabic}|\{\\/u);
  }
  if (workspace.tools.subtitles) {
    const shot = themed.clips[0];
    const input = join(root, '.hidden-workspace', 'projects', themed.id, shot.id, 'video.mp4');
    let rgb = Buffer.alloc(0);
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', '0.45', '-i', input, '-an', '-frames:v', '1', '-threads', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], {
      onData: (chunk) => { rgb = Buffer.concat([rgb, chunk]); },
    });
    assert.equal(rgb.length, 720 * 1280 * 3);
    let lime = 0;
    for (let i = 3 * 720 * 880; i < 3 * 720 * 1070; i += 3) {
      if (rgb[i] > 185 && rgb[i + 1] > 228 && rgb[i + 1] > rgb[i + 2] + 70) lime++;
    }
    assert.ok(lime > 40, 'exported MP4 pixels contain the selected lime caption color');
  }
  const off = await app.post('/projects', { demo: true, count: 1, captions: false, captionLanguage: 'ur-Latn', captionStyle: style, aspectRatio: '4:1' });
  const clean = await done(app.request, (await off.json()).id);
  assert.equal(clean.status, 'ready', clean.error);
  assert.equal(clean.clips.length, 1);
  assert.equal(clean.clips[0].captionsUrl, null);
  assert.equal(clean.clips[0].burnedCaptions, false);
  assert.equal(clean.autoSelection, undefined);
  const data = join(root, 'replay');
  const replay = await boot({ DATA_DIR: data, YTDLP_BIN: join(import.meta.dirname, 'fixtures', 'ytdlp.mjs'),
    FIXTURE_INPUT: join(root, '.hidden-workspace', 'projects', job.id, clip.id, 'video.mp4'),
    FFMPEG_BIN: join(import.meta.dirname, 'fixtures', 'ffmpeg.mjs'), FIXTURE_FFMPEG: ffmpeg, PYTHON_BIN: '/bin/false', MAX_SOURCE_MINUTES: '1', FIXTURE_LIVE_LIMIT_SECONDS: '60', MAX_SOURCE_MB: '10',
  }, t);
  const calls = [];
  const mock = createServer(async (req, res) => {
    let data = '';
    for await (const chunk of req) data += chunk;
    const payload = JSON.parse(data);
    calls.push({ route: req.url, key: req.headers.authorization, model: payload.model });
    const rows = JSON.parse(payload.messages[1].content).map(({ id }) => ({ id, score: 85 }));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(rows) } }] }));
  });
  mock.listen(0, '127.0.0.1');
  await once(mock, 'listening');
  t.after(() => new Promise((resolve) => mock.close(resolve)));
  const makeProfile = (name, folder) => replay.post('/providers', { type: 'custom', name, baseUrl: `http://127.0.0.1:${mock.address().port}/${folder}`, model: `${folder}-chat`, apiKey: `fake-${folder}-key` }).then((res) => res.json());
  const current = await makeProfile('Workspace default', 'default');
  const override = await makeProfile('Per-job custom chat', 'override');
  const setting = (id) => replay.request('/settings/ranking', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId: id }) });
  assert.equal((await setting(current.id)).status, 200);
  const videoOptions = { url: 'https://youtu.be/dQw4w9WgXcQ', count: 1, mode: 'auto', platform: 'youtube-landscape', captionLanguage: 'es', hashtagLanguage: 'off' };
  assert.equal((await replay.post('/projects', { ...videoOptions, aiProfile: '12121212-1212-1212-1212-121212121212' })).status, 404);
  const video = await replay.post('/projects', { ...videoOptions, aiProfile: override.id });
  assert.equal(video.status, 202);
  job = await done(replay.request, (await video.json()).id);
  assert.equal(job.status, 'ready', job.error);
  assert.equal(job.sourceKind, 'replay');
  assert.equal(job.engine, 'Per-job custom chat');
  assert.deepEqual(calls, [{ route: '/override/chat/completions', key: 'Bearer fake-override-key', model: 'override-chat' }]);
  assert.equal((await (await replay.request('/workspace')).json()).activeProviderId, current.id);
  assert.equal((await setting(null)).status, 200);
  assert.deepEqual(job.options.captionStyle, defaultCaptionStyle);
  assert.equal(job.captionsSource, 'YouTube transcript');
  assert.ok(job.signals.includes('Replay heatmap'));
  assert.equal(job.clips[0].withCaptions, true);
  assert.equal(job.clips[0].captionLanguage, 'es');
  assert.equal(job.frame.ratio, '16:9');
  assert.deepEqual(job.clips[0].hashtags, []);
  assert.match(await (await fetch(`${replay.url}${job.clips[0].captionsUrl}`, { headers: replay.getHeaders() })).text(), /un gancho/);
  const premium = replay.agent();
  let enrolled = await premium.signup('engine-premium@example.test');
  assert.equal(enrolled.status, 201);
  const memberId = (await enrolled.json()).user.id;
  assert.equal((await replay.put(`/admin/providers/${override.id}/share`, { shared: true })).status, 200);
  assert.equal((await premium.post('/projects', { ...videoOptions, aiProfile: override.id })).status, 404);
  assert.equal((await replay.put(`/admin/accounts/${memberId}/premium`, { premium: true })).status, 200);
  const sharedRun = await premium.post('/projects', { ...videoOptions, aiProfile: override.id });
  assert.equal(sharedRun.status, 202);
  const memberJob = await done(premium.request, (await sharedRun.json()).id);
  assert.equal(memberJob.status, 'ready', memberJob.error);
  assert.equal(memberJob.engine, 'Per-job custom chat');
  assert.deepEqual(calls.at(-1), { route: '/override/chat/completions', key: 'Bearer fake-override-key', model: 'override-chat' });
  assert.equal((await replay.request(`/projects/${memberJob.id}`)).status, 404);
  assert.equal((await replay.put(`/admin/accounts/${memberId}/premium`, { premium: false })).status, 200);
  assert.equal((await premium.post('/projects', { ...videoOptions, aiProfile: override.id })).status, 404);
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
  let snapshot;
  for (let trial = 0; trial < 80; trial++) {
    snapshot = await (await replay.request(`/projects/${liveId}`)).json();
    if (snapshot.clips.length) break;
    await setTimeout(150);
  }
  assert.equal(snapshot.clips.length, 1, snapshot.monitor?.analysis);
  assert.equal(snapshot.status, 'capturing');
  assert.equal(snapshot.monitor.open, true);
  assert.equal((await replay.put(`/projects/${liveId}/sharing`, { shared: true, consent: true })).status, 409);
  assert.equal((await replay.post(`/projects/${liveId}/end`, {})).status, 200);
  const window = await done(replay.request, liveId);
  assert.equal(window.status, 'ready', window.error);
  assert.equal(window.sourceKind, 'live');
  assert.equal(window.clips.length, 1);
  assert.ok(window.capturedSeconds >= 6 && window.capturedSeconds <= 14);
  assert.equal(window.monitor.open, false);
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
