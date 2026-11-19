import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createChatMeter, liveChatEvents } from '../server/live-chat.mjs';
import { captureSegments } from '../server/live-monitor.mjs';
import { ffmpeg, run, toolsStatus } from '../server/tools.mjs';
import { jobOptions, maxLiveMinutes } from '../server/validation.mjs';
import { exampleAdmin, memberPassword, startEngine } from './helpers/http.mjs';

test('live chat drops duplicates, replay messages and history before capture; it detects a real volume increase', () => {
  const now = 170_000, burstAt = 153_000;
  const renderMessage = (id, at, isLive = true) => JSON.stringify({ isLive, replayChatItemAction: { actions: [{ addChatItemAction: { item: { liveChatTextMessageRenderer: { id, timestampUsec: String(at * 1000), message: { runs: [{ text: 'not needed' }] } } } } }] } });
  const meter = createChatMeter();
  const events = liveChatEvents(renderMessage('p1', burstAt));
  assert.deepEqual(events, [{ id: 'p1', at: burstAt }]);
  assert.deepEqual(liveChatEvents(renderMessage('replay', burstAt, false)), []);
  const history = liveChatEvents(renderMessage('old', 90_000));
  meter.add([...events, ...events, ...history], 100_000, now);
  assert.deepEqual(meter.sample(now), { minute: 1, total: 1, spikes: 0, spike: undefined });
  meter.add(Array.from({ length: 7 }, (_, i) => ({ id: `message-${i}`, at: burstAt })), 100_000, now);
  assert.deepEqual(meter.sample(now).spike, { at: 155_000, messages: 8, baseline: 0 });
  assert.equal(meter.sample(now + 1000).spike, undefined);
  assert.equal(meter.sample(now + 300_000).minute, 0);
});

test('custom duration is bounded and only FFmpeg’s completed, expected segment paths can enter a snapshot', () => {
  assert.equal(jobOptions({ demo: true, count: 1, liveMinutes: 41 }).liveMinutes, 41);
  for (const liveMinutes of [0, -2, 1.1, maxLiveMinutes + 1, Infinity, null, true]) {
    assert.throws(() => jobOptions({ demo: true, count: 1, liveMinutes }), { status: 400 });
  }
  assert.deepEqual(captureSegments('live-000000.mkv,0.000,7.50\nlive-000001.mkv,7.50,14.20\n../../unexpected,14.20,18\n'), [
    { file: 'live-000000.mkv', start: 0, end: 7.5 }, { file: 'live-000001.mkv', start: 7.5, end: 14.2 },
  ]);
});

async function json(res, expected = 200) {
  const value = await res.json();
  assert.equal(res.status, expected, JSON.stringify(value));
  return value;
}

test('Auto renders a chat-triggered clip while recording; Full appends from the same pinned replay after restart', { timeout: 45_000 }, async (t) => {
  if (!(await toolsStatus()).ffmpeg) return t.skip('FFmpeg not installed');
  const root = await mkdtemp(join(tmpdir(), 'cf-live-monitor-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const capture = join(root, 'capture.mp4'), replay = join(root, 'replay.mp4');
  for (const [path, seconds] of [[capture, 36], [replay, 51]]) {
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=160x96:r=24:d=${seconds}`, '-an', '-c:v', 'libx264', '-g', '144', '-preset', 'ultrafast', '-threads', '2', path]);
  }
  const state = join(root, 'state.json'), gate = join(root, 'chat-on'), trace = join(root, 'models.jsonl'), data = join(root, 'data'), replayTrace = join(root, 'replay.jsonl');
  async function streamIs(status) { await writeFile(`${state}.next`, JSON.stringify({ WaitReplayA: status })); await rename(`${state}.next`, state); }
  await streamIs('is_live');
  const imports = ['test/fixtures/providers-network.mjs'];
  const env = { DATA_DIR: data, ADMIN_EMAIL: exampleAdmin.email, ADMIN_PASSWORD: exampleAdmin.password, REPLAY_WAIT_MINUTES: '2', REPLAY_CHECK_SECONDS: '5',
    YTDLP_BIN: resolve('test/fixtures/ytdlp.mjs'), FFMPEG_BIN: resolve('test/fixtures/ffmpeg.mjs'), FIXTURE_FFMPEG: ffmpeg, PYTHON_BIN: '/bin/false',
    FIXTURE_INPUT: capture, FIXTURE_REPLAY_INPUT: replay, FIXTURE_REPLAY_STATE: state, FIXTURE_REPLAY_TRACE: replayTrace, FIXTURE_LIVE_FIXTURE_SECONDS: '36', FIXTURE_LIVE_PROGRESS_SECONDS: '14', FIXTURE_LIVE_LIMIT_SECONDS: '2520',
    FIXTURE_LIVE_CHAT: gate, FIXTURE_PROVIDER_TRACE: trace };
  const engine = await startEngine(t, { env, imports });
  let viewer = engine.agent();
  const admin = engine.agent();
  await json(await admin.signin());
  await json(await viewer.signup('live-viewer@example.test'), 201);
  const profile = await json(await admin.post('/providers', { type: 'custom', name: 'Auto fixture AI', baseUrl: 'https://models.example.test/v1', model: 'fixture-chat', apiKey: 'shared-fixture-key' }), 201);
  await json(await admin.put(`/admin/providers/${profile.id}/share`, { shared: true, includeFree: true }));
  const created = await json(await viewer.post('/projects', { url: 'https://www.youtube.com/@fixture-channel/live', count: 1, mode: 'live', liveMinutes: 42, aspectRatio: '4:1', aiProfile: 'local', captions: false }), 202);
  const path = `/projects/${created.id}`;
  async function until(predicate) {
    const deadline = Date.now() + 20_000;
    let job;
    while (Date.now() < deadline) {
      job = await json(await viewer.request(path));
      assert.notEqual(job.status, 'failed', job.detail);
      if (predicate(job)) return job;
      await delay(100);
    }
    assert.fail(`Did not reach expected state: ${JSON.stringify(job)}`);
  }
  const analytics = await until((job) => job.status === 'capturing' && job.monitor.canAnalyze);
  assert.equal(analytics.monitor.mode, 'analytics');
  assert.equal(analytics.captureLimitSeconds, 2520);
  assert.equal(analytics.options.id, 'WaitReplayA');
  assert.equal((await admin.put(`${path}/monitor`, { mode: 'full' })).status, 404);
  assert.equal((await viewer.put(`${path}/monitor`, { mode: 'auto' })).status, 400);
  await json(await viewer.put(`${path}/monitor`, { mode: 'auto', providerId: profile.id }));
  await writeFile(gate, 'now');
  const generated = await until((job) => job.clips.length === 1);
  assert.equal(generated.status, 'capturing');
  assert.equal(generated.monitor.open, true);
  assert.equal(generated.monitor.chat.spikes, 1);
  assert.equal(generated.clips[0].timing, 'live');
  assert.ok(generated.signals.includes('Live chat spike'));
  const selected = (await json(await viewer.request('/workspace'))).user.plan;
  assert.deepEqual(selected.used, { projects: 1, aiProjects: 1, messages: 0 });
  assert.equal((await viewer.request(generated.clips[0].videoUrl.slice(4), { headers: { Range: 'bytes=0-15' } })).status, 206);
  assert.equal((await viewer.post(`${path}/finish-capture`)).status, 409);
  const request = (await readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse)[0];
  assert.match(request.body.messages[0].content, /chat spike/);
  assert.doesNotMatch(JSON.stringify(request), /synthetic chat body|demo-text/);

  await json(await viewer.put(`${path}/monitor`, { mode: 'full' }));
  const waiting = await until((job) => job.status === 'waiting_replay');
  assert.deepEqual(waiting.clips, generated.clips);
  assert.equal(waiting.replayWait.state, 'live');
  assert.equal(waiting.options.url, 'https://www.youtube.com/watch?v=WaitReplayA');
  assert.equal((await viewer.put(`${path}/monitor`, { mode: 'analytics' })).status, 409);
  await assert.rejects(access(join(data, 'projects', created.id, 'work')), { code: 'ENOENT' });
  await engine.stop();
  await streamIs('was_live');
  const resumed = await startEngine(t, { env, imports });
  viewer = resumed.agent();
  await json(await viewer.signin('live-viewer@example.test', memberPassword));
  const ready = await until((job) => job.status === 'ready' && job.monitor.mode === 'full');
  assert.equal(ready.sourceKind, 'replay');
  assert.equal(ready.monitor.open, true);
  assert.equal(ready.duration, 51);
  assert.deepEqual(ready.clips.map((clip) => [clip.id, clip.timing]), [['clip-1', 'live'], ['clip-2', 'replay']]);
  assert.equal(ready.clips[1].start, 0);
  assert.equal((await viewer.request(path, { method: 'DELETE' })).status, 409);
  const ended = await json(await viewer.post(`${path}/end`));
  assert.equal(ended.monitor.open, false);
  assert.deepEqual(ended.clips, ready.clips);
  assert.equal((await viewer.request(ready.clips[1].videoUrl.slice(4), { headers: { Range: 'bytes=0-15' } })).status, 206);
  const checked = (await readFile(replayTrace, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(checked.filter((row) => row.target.includes('/@fixture-channel/')).length, 1);
  assert.ok(checked.some((row) => row.target.endsWith('v=WaitReplayA') && row.state === 'was_live'));
  assert.doesNotMatch(await readFile(join(data, 'workspace.json'), 'utf8'), /synthetic chat body|demo-text|shared-fixture-key/);
});
