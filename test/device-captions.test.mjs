import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { ffmpeg, run, toolsStatus } from '../server/tools.mjs';
import { createStore } from '../server/store.mjs';
import { captionPresets } from '../shared/captions.mjs';
import { memberPassword, startEngine } from './helpers/http.mjs';

const raw = { 'Content-Type': 'application/octet-stream' };
async function json(response, status = 200) {
  const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value));
  return value;
}
async function waitFor(read, until) {
  for (let i = 0; i < 180; i++) {
    const current = await read();
    if (until(current)) return current;
    await delay(50);
  }
  assert.fail('Timed out waiting for caption job');
}
const terminal = new Set(['ready', 'failed', 'cancelled']);

async function captionEngine(t) {
  const root = await mkdtemp(join(tmpdir(), 'curiousity-device-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const trace = join(root, 'provider.jsonl');
  await writeFile(trace, '');
  const engine = await startEngine(t, { env: { DATA_DIR: root, FIXTURE_PROVIDER_TRACE: trace, MAX_SOURCE_MB: '10', MAX_SOURCE_MINUTES: '1', YTDLP_BIN: join(root, 'not-installed') }, imports: ['test/fixtures/providers-network.mjs'] });
  const member = engine.agent();
  await json(await member.signup('captions@example.test'), 201);
  const profile = await json(await member.post('/providers', { type: 'custom', baseUrl: 'https://models.example.test/v1', name: 'Your speech service', apiKey: 'speech-fixture-secret' }), 201);
  await json(await member.put('/settings/captions', { providerId: profile.id, model: 'fixture-speech' }));
  const list = (client = member) => client.request('/captions').then((res) => json(res));
  const status = (id) => waitFor(list, (rows) => rows.some((item) => item.id === id && terminal.has(item.status))).then((rows) => rows.find((row) => row.id === id));
  return { root, trace, engine, member, list, status };
}

async function pixels(path) {
  const parts = [];
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', '0.8', '-i', path, '-frames:v', '1', '-an', '-threads', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { onData: (chunk) => parts.push(chunk) });
  return Buffer.concat(parts);
}

test('members stream device video past the JSON/YouTube limit, render styled full MP4 and plain SRT, then re-style privately', { timeout: 30_000 }, async (t) => {
  if (!(await toolsStatus()).subtitles) return t.skip('FFmpeg with libass not installed');
  const { root, trace, engine, member, list, status } = await captionEngine(t);
  const other = engine.agent(), anon = engine.agent();
  await json(await other.signup('unrelated@example.test'), 201);
  const workspace = await json(await member.request('/workspace'));
  assert.equal(workspace.user.premium, false);
  assert.equal(workspace.google.connected, false);
  assert.equal(workspace.tools.ytDlp, false);
  const source = join(root, 'source.mp4');
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=180x320:r=24:d=3', '-f', 'lavfi', '-i', 'sine=duration=3:frequency=440',
    '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', source]);
  const bytes = 11 * 1024 * 1024;
  await truncate(source, bytes);
  const style = captionPresets.orange.style;
  const params = new URLSearchParams({ name: '../somewhere/Device test.mp4', style: JSON.stringify(style) });
  const endpoint = `/captions/upload?${params}`;
  assert.equal((await anon.request(endpoint, { method: 'POST', headers: raw, body: 'unauthenticated' })).status, 401);
  assert.equal((await member.request(endpoint, { method: 'POST', headers: { ...raw, Origin: 'https://other.example.test' }, body: 'wrong origin' })).status, 403);
  assert.equal((await member.post(endpoint, { not: 'video' })).status, 415);
  assert.equal((await member.post('/chat', { tooLarge: 'x'.repeat(200_000) })).status, 413);
  assert.equal((await member.request(`${endpoint}&style=oops`, { method: 'POST', headers: raw, body: 'invalid settings' })).status, 400);
  const created = await json(await member.request(endpoint, { method: 'POST', headers: raw, body: createReadStream(source), duplex: 'half' }), 202);
  assert.equal(created.title, 'Device test.mp4');
  assert.equal(created.status, 'queued');
  assert.deepEqual(created.style, style);
  const first = await status(created.id);
  assert.equal(first.status, 'ready', JSON.stringify(first));
  assert.deepEqual(first.frame, { width: 180, height: 320 });
  assert.equal(first.duration, 3);
  assert.equal(first.captionCount, 2);
  assert.equal(first.language, 'en');
  const audioTrace = (await readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(audioTrace.length, 1);
  assert.equal(audioTrace[0].type, 'audio/mpeg');
  assert.ok(audioTrace[0].bytes < 50_000, 'only prepared audio, not the raw video, goes to the provider');
  assert.equal(audioTrace[0].model, 'fixture-speech');
  assert.doesNotMatch(JSON.stringify(first), /ownerId|captionEngine|test-secret|input.video/);
  assert.deepEqual(await list(other), []);
  assert.deepEqual(await json(await member.request('/projects')), []);
  assert.equal((await member.request(`/projects/${first.id}`)).status, 404);
  assert.equal((await member.put(`/projects/${first.id}/sharing`, { shared: true, consent: true })).status, 404);
  assert.equal((await member.request(`/captions/${first.id}/input.video`)).status, 404);
  for (const path of [first.videoUrl, first.captionsUrl]) {
    assert.equal((await other.request(path.slice(4))).status, 404);
    assert.equal((await anon.request(path.slice(4))).status, 401);
  }
  assert.equal((await other.post(`/captions/${first.id}/render`, { style })).status, 404);
  const srt = await member.request(`${first.captionsUrl.slice(4)}?download=1`);
  assert.match(srt.headers.get('content-disposition'), /attachment.*\.srt/);
  const srtText = await srt.text();
  assert.match(srtText, /^1\n00:00:00,150 --> 00:00:01,600\nA short caption example\./);
  assert.doesNotMatch(srtText, /\\(t|frz|fsc)|<font/i);
  const video = await member.request(`${first.videoUrl.slice(4)}&download=1`, { headers: { Range: 'bytes=0-31' } });
  assert.equal(video.status, 206);
  assert.match(video.headers.get('content-disposition'), /attachment.*\.mp4/);
  assert.match(video.headers.get('content-type'), /video\/mp4/);
  assert.match(Buffer.from(await video.arrayBuffer()).toString('latin1'), /ftyp/);
  const project = join(root, 'projects', created.id);
  const encoded = join(project, 'video.mp4');
  assert.equal((await stat(join(project, 'input.video'))).size, bytes);
  const orangePixels = await pixels(encoded);
  assert.equal(orangePixels.length, 180 * 320 * 3);
  let orange = 0;
  for (let i = 0; i < orangePixels.length; i += 3) if (orangePixels[i] > 150 && orangePixels[i] - orangePixels[i + 2] > 70) orange++;
  assert.ok(orange > 300, 'the MP4 contains burned orange caption pixels');
  const nextStyle = captionPresets.wave.style;
  assert.equal((await member.post(`/captions/${first.id}/render`, { style: { animation: 'not-a-style' } })).status, 400);
  await json(await member.post(`/captions/${first.id}/render`, { style: nextStyle }), 202);
  const changed = await status(first.id);
  assert.equal(changed.status, 'ready', JSON.stringify(changed));
  assert.notEqual(changed.videoUrl, first.videoUrl);
  assert.deepEqual(changed.renderedStyle, nextStyle);
  assert.notDeepEqual(await pixels(encoded), orangePixels);
  assert.equal(await (await member.request(changed.captionsUrl.slice(4))).text(), srtText);
  assert.equal((await readFile(trace, 'utf8')).trim().split('\n').length, 1, 'restyling must not transcribe again');
  assert.equal((await other.request(`/captions/${first.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await member.request(`/captions/${first.id}`, { method: 'DELETE' })).status, 204);
  await assert.rejects(stat(project), { code: 'ENOENT' });
  assert.equal((await member.request(first.videoUrl.slice(4))).status, 404);
});

test('partial bodies stream before completion and are cleaned up after abort; unsafe inputs never reach speech processing', { timeout: 20_000 }, async (t) => {
  if (!(await toolsStatus()).ffmpeg) return t.skip('FFmpeg not installed');
  const { root, trace, member, list, status } = await captionEngine(t);
  const filename = join(root, 'workspace.json');
  const liveJobs = () => readFile(filename, 'utf8').then(JSON.parse).then((state) => state.jobs);
  const req = httpRequest(`${member.url}/api/captions/upload?name=huge.mp4`, { method: 'POST', headers: { ...member.getHeaders(), ...raw, 'Content-Length': String(100 * 1024 * 1024) } });
  req.on('error', () => {});
  t.after(() => req.destroy());
  req.write(Buffer.alloc(384 * 1024));
  const [partial] = await waitFor(liveJobs, (rows) => rows.some((job) => job.status === 'uploading'));
  const path = join(root, 'projects', partial.id, 'input.video');
  const written = await waitFor(() => stat(path).catch(() => ({ size: 0 })), (info) => info.size >= 192 * 1024);
  assert.ok(written.size < 100 * 1024 * 1024);
  assert.deepEqual(await list(), []);
  const gated = await member.request('/captions/upload?name=another.mp4', { method: 'POST', headers: raw, body: 'another' });
  assert.equal(gated.status, 429);
  req.destroy();
  await waitFor(liveJobs, (rows) => !rows.length);
  await assert.rejects(stat(path), { code: 'ENOENT' });
  const empty = await member.request('/captions/upload?name=empty.mp4', { method: 'POST', headers: raw, body: new Uint8Array() });
  assert.equal(empty.status, 400);
  const playlist = await json(await member.request('/captions/upload?name=disguised.mp4', { method: 'POST', headers: raw, body: '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\nhttp://127.0.0.1:80/other.ts\n#EXT-X-ENDLIST\n' }), 202);
  const bad = await status(playlist.id);
  assert.equal(bad.status, 'failed');
  assert.match(bad.error, /Could not read this video/);
  assert.equal(bad.videoUrl, null);
  await assert.rejects(stat(join(root, 'projects', bad.id)), { code: 'ENOENT' });
  assert.equal(await readFile(trace, 'utf8'), '');

});

test('restart removes an unfinished upload but retains source and SRT for interrupted restyling', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'curiousity-caption-restart-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { DATA_DIR: root };
  const before = await startEngine(t, { env });
  const account = await json(await before.agent().signup('resume@example.test'), 201);
  await before.stop();
  const store = createStore(root);
  const make = (status, trackReady) => ({ id: randomUUID(), kind: 'captions', ownerId: account.user.id, title: 'Device video', status, trackReady, clips: [], style: captionPresets.orange.style });
  const uploading = make('uploading', false), rendering = make('rendering', true);
  store.state.jobs.push(uploading, rendering);
  store.save();
  for (const job of [uploading, rendering]) {
    const dir = join(root, 'projects', job.id);
    await mkdir(join(dir, 'work'), { recursive: true });
    await writeFile(join(dir, 'input.video'), 'fixture input');
    await writeFile(join(dir, 'work', 'render.mp4'), 'incomplete scratch artifact');
    if (job.trackReady) await writeFile(join(dir, 'captions.srt'), 'fixture transcript');
  }
  const engine = await startEngine(t, { env });
  const after = engine.agent();
  await json(await after.signin('resume@example.test', memberPassword));
  const projects = await json(await after.request('/captions'));
  assert.deepEqual(projects.map((job) => job.status), ['failed', 'failed']);
  await assert.rejects(stat(join(root, 'projects', uploading.id)), { code: 'ENOENT' });
  await assert.rejects(stat(join(root, 'projects', rendering.id, 'work')), { code: 'ENOENT' });
  assert.equal(await readFile(join(root, 'projects', rendering.id, 'input.video'), 'utf8'), 'fixture input');
  assert.equal(await (await after.request(projects[1].captionsUrl.slice(4))).text(), 'fixture transcript');
});
