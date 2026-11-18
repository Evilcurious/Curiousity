import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { planReplayCheck, replayState, replayWaitMinutes } from '../server/replay.mjs';
import { ffmpeg, run, toolsStatus } from '../server/tools.mjs';
import { memberPassword, startEngine } from './helpers/http.mjs';

test('replay waiting is bounded and does not change the live edge mode', () => {
  const now = 1_000_000_000;
  const job = {};
  assert.equal(replayState({ live_status: 'is_live' }, 'auto'), null);
  assert.equal(replayState({ live_status: 'is_upcoming' }, 'replay'), 'upcoming');
  assert.equal(replayState({ live_status: 'post_live' }, 'live'), null);
  assert.equal(replayState({ live_status: 'post_live' }, 'auto'), 'processing');
  assert.equal(replayState({ live_status: 'was_live', formats: [] }, 'recorded'), 'processing');
  assert.equal(replayState({ live_status: 'was_live', formats: [{ url: 'fixture' }] }, 'replay'), null);
  const first = planReplayCheck(job, 'live', now);
  assert.equal(first.replayWait.deadline, now + replayWaitMinutes * 60_000);
  const next = planReplayCheck(first, 'processing', first.replayWait.deadline - 1);
  assert.equal(next.replayWait.deadline, first.replayWait.deadline);
  assert.equal(next.replayWait.nextCheckAt, first.replayWait.deadline);
  assert.throws(() => planReplayCheck(next, 'processing', first.replayWait.deadline), /wait expired/);
});

test('the queue pins a stream, releases the worker, resumes the wait after restart, and renders its finished replay', { timeout: 55_000 }, async (t) => {
  if (!(await toolsStatus()).ffmpeg) return t.skip('FFmpeg not installed');
  const root = await mkdtemp(join(tmpdir(), 'curiousity-replay-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'fixture.mp4');
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x96:r=24:d=12', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '2', source]);
  const state = join(root, 'replay-state.json'), trace = join(root, 'replay-trace.jsonl'), data = join(root, 'data');
  const setStates = async (statuses) => { await writeFile(`${state}.next`, JSON.stringify(statuses)); await rename(`${state}.next`, state); };
  await setStates({ WaitReplayA: 'is_live', WaitReplayB: 'post_live_error', WaitReplayD: 'is_upcoming', WaitReplayE: 'private' });
  const env = { DATA_DIR: data, REPLAY_WAIT_MINUTES: '3', REPLAY_CHECK_SECONDS: '5', FIXTURE_INPUT: source, FIXTURE_REPLAY_STATE: state, FIXTURE_REPLAY_TRACE: trace, YTDLP_BIN: resolve('test/fixtures/ytdlp.mjs') };
  const engine = await startEngine(t, { env });
  let viewer = engine.agent();
  const other = engine.agent();
  assert.equal((await viewer.signup('viewer@example.test')).status, 201);
  assert.equal((await other.signup('other-viewer@example.test')).status, 201);

  const options = { count: 1, aspectRatio: '1:1', aiProfile: 'local', captions: false };
  async function submit(member, url, mode) {
    const response = await member.post('/projects', { ...options, url, mode });
    assert.equal(response.status, 202);
    return (await response.json()).id;
  }
  async function waitFor(member, id, predicate) {
    for (let i = 0; i < 220; i++) {
      const response = await member.request(`/projects/${id}`);
      assert.equal(response.status, 200);
      const project = await response.json();
      if (predicate(project)) return project;
      assert.ok(!['ready', 'failed', 'cancelled'].includes(project.status), project.detail);
      await delay(80);
    }
    throw new Error(`Project ${id} did not reach the expected state.`);
  }

  const stream = await submit(viewer, 'https://www.youtube.com/@fixture-channel/live', 'replay');
  const wait = (member, id, state) => waitFor(member, id, (job) => job.status === 'waiting_replay' && job.replayWait.state === state);
  const live = await wait(viewer, stream, 'live');
  const pinned = 'https://www.youtube.com/watch?v=WaitReplayA';
  assert.equal(live.options.url, pinned);
  assert.equal(live.options.id, 'WaitReplayA');
  assert.equal(live.sourceKind, 'replay');
  assert.deepEqual(live.clips, []);
  assert.equal((await other.request(`/projects/${stream}`)).status, 404);
  assert.equal((await other.post(`/projects/${stream}/cancel`, {})).status, 404);
  assert.equal((await viewer.post(`/projects/${stream}/finish-capture`, {})).status, 409);
  await assert.rejects(access(join(data, 'projects', stream, 'work')), { code: 'ENOENT' });

  // The waiting broadcast does not take the media worker. Ready replays can
  // be processed while the first one is still live.
  const ready = await submit(viewer, 'https://youtu.be/WaitReplayC', 'recorded');
  const finished = await waitFor(viewer, ready, (job) => job.status === 'ready');
  assert.equal(finished.sourceKind, 'replay');
  assert.equal(finished.replayWait, null);
  assert.equal(finished.clips.length, 1);

  const processing = await submit(other, 'https://youtu.be/WaitReplayB', 'auto');
  await wait(other, processing, 'processing');
  const stopped = await other.post(`/projects/${processing}/cancel`, {});
  assert.equal(stopped.status, 200);
  assert.equal((await stopped.json()).status, 'cancelled');
  const upcoming = await submit(other, 'https://youtu.be/WaitReplayD', 'replay');
  await wait(other, upcoming, 'upcoming');
  assert.equal((await other.post(`/projects/${upcoming}/cancel`, {})).status, 200);
  const restricted = await submit(other, 'https://youtu.be/WaitReplayE', 'replay');
  assert.match((await waitFor(other, restricted, (job) => job.status === 'failed')).detail, /unavailable or restricted/);

  await engine.stop();
  await setStates({ WaitReplayA: 'post_live', WaitReplayB: 'was_live' });
  const again = await startEngine(t, { env });
  viewer = again.agent();
  assert.equal((await viewer.signin('viewer@example.test', memberPassword)).status, 200);
  const ended = await wait(viewer, stream, 'processing');
  assert.equal(ended.replayWait.deadline, live.replayWait.deadline);
  assert.equal(ended.options.url, pinned);
  await setStates({ WaitReplayA: 'was_live_empty' });
  const empty = await waitFor(viewer, stream, (job) => job.status === 'waiting_replay' && job.replayWait.nextCheckAt > ended.replayWait.nextCheckAt);
  assert.equal(empty.replayWait.state, 'processing');
  await setStates({ WaitReplayA: 'was_live' });
  const replay = await waitFor(viewer, stream, (job) => job.status === 'ready');
  assert.equal(replay.sourceKind, 'replay');
  assert.equal(replay.options.url, pinned);
  assert.equal(replay.replayWait, null);
  assert.equal(replay.clips.length, 1);
  const video = await viewer.request(replay.clips[0].videoUrl.slice(4), { headers: { Range: 'bytes=0-63' } });
  assert.equal(video.status, 206);
  assert.match(Buffer.from(await video.arrayBuffer()).toString('ascii'), /ftyp/);
  const checks = (await readFile(trace, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(checks.filter(({ target }) => target.includes('/@fixture-channel/')).length, 1);
  assert.deepEqual(checks.filter(({ target }) => target === pinned).slice(-3).map(({ state }) => state), ['post_live', 'was_live_empty', 'was_live']);
  assert.equal(checks.filter(({ target }) => target.endsWith('WaitReplayB')).length, 1);
});
