import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { ffmpeg, run, toolsStatus } from '../server/tools.mjs';
import { visualCandidatePool } from '../server/video-evidence.mjs';
import { exampleAdmin, startEngine } from './helpers/http.mjs';

async function json(response, expected = 200) {
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  return result;
}

test('visual candidate sampling covers quiet parts of a long source, not just its highest local scores', () => {
  const windows = Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, start: 20 * i, end: 20 * i + 20, score: i < 20 ? 90 : 45 }));
  const pool = visualCandidatePool(windows, 2000, 3);
  assert.equal(pool.length, 12);
  assert.equal(new Set(pool).size, pool.length);
  assert.ok(pool.some(({ start }) => start < 200));
  assert.ok(pool.some(({ start }) => start > 900 && start < 1200));
  assert.ok(pool.some(({ start }) => start > 1800));
});

test('AI Studio clips use real sampled frames or a Gemini video preview, preserve captions and reject fabricated moments', { timeout: 45_000 }, async (t) => {
  if (!(await toolsStatus()).subtitles) return t.skip('FFmpeg with libass not installed');
  const root = await mkdtemp(join(tmpdir(), 'curiousity-vision-'));
  const source = join(root, 'vision-source.mp4'), trace = join(root, 'model.jsonl');
  await writeFile(trace, '');
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=12:d=16', '-f', 'lavfi', '-i', 'sine=duration=16',
    '-shortest', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
  const engine = await startEngine(t, { env: { DATA_DIR: root, ADMIN_EMAIL: exampleAdmin.email, ADMIN_PASSWORD: exampleAdmin.password, PYTHON_BIN: join(root, 'no-whisper'),
    YTDLP_BIN: resolve('test/fixtures/ytdlp.mjs'), FIXTURE_INPUT: source, FIXTURE_PROVIDER_TRACE: trace }, imports: ['test/fixtures/providers-network.mjs'] });
  t.after(() => rm(root, { recursive: true, force: true }));
  const admin = engine.agent();
  await json(await admin.signin());
  const project = { url: 'https://youtu.be/TrendVideo1', mode: 'recorded', aspectRatio: '16:9', count: 2, captionLanguage: 'en' };
  assert.equal((await admin.post('/projects', { ...project, engineMode: 'ai' })).status, 400);
  const personal = (body) => admin.post('/providers', { apiKey: 'mock-vision-key', ...body }).then((res) => json(res, 201));
  const frames = await personal({ type: 'custom', name: 'Frame model', baseUrl: 'https://models.example.test/v1', model: 'fixture-vision' });
  const native = await personal({ type: 'gemini', name: 'Video model', model: 'gemini-fixture' });
  const invalid = await personal({ type: 'custom', name: 'Reject this ranking', baseUrl: 'https://models.example.test/v1', model: 'fixture-invalid-vision' });
  const calls = async () => (await readFile(trace, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  async function generate(engineMode, aiProfile, url = project.url) {
    const submitted = await json(await admin.post('/projects', { ...project, url, engineMode, aiProfile }), 202);
    for (let i = 0; i < 200; i++) {
      const job = await json(await admin.request(`/projects/${submitted.id}`));
      if (['ready', 'failed', 'cancelled'].includes(job.status)) return job;
      await delay(100);
    }
    assert.fail('Clip never finished');
  }
  const ranked = await generate('ai', frames.id);
  assert.equal(ranked.status, 'ready', JSON.stringify(ranked));
  assert.equal(ranked.engine, 'AI · Frame model');
  assert.ok(ranked.signals.includes('Video frames'));
  assert.equal(ranked.clips.length, 1);
  assert.equal(ranked.clips[0].title, 'A visual highlight');
  assert.ok(ranked.clips[0].burnedCaptions);
  const [frameRequest] = await calls();
  const input = frameRequest.body.messages.at(-1).content;
  const window = JSON.parse(input[0].text).windows.find(({ start, end }) => start === ranked.clips[0].start && end === ranked.clips[0].end);
  assert.ok(window, 'the model cannot move the original timestamp boundaries');
  assert.ok(input.some((row) => row.type === 'text' && row.text.startsWith(`${window.id}, `)));
  const jpeg = input.find(({ type }) => type === 'image_url').image_url.url;
  assert.ok(Buffer.from(jpeg.split(',')[1], 'base64').subarray(0, 3).equals(Buffer.from([255, 216, 255])));

  const play = await generate('ai', native.id);
  assert.equal(play.status, 'ready', JSON.stringify(play));
  assert.ok(play.signals.includes('Video preview'));
  assert.equal(play.clips[0].title, 'From the video preview');
  assert.ok(play.clips[0].burnedCaptions);
  const nativeRequest = (await calls()).at(-1);
  const video = nativeRequest.body.contents[0].parts.find(({ inlineData }) => inlineData?.mimeType === 'video/mp4');
  assert.equal(Buffer.from(video.inlineData.data, 'base64').subarray(4, 8).toString(), 'ftyp');

  const videoOnly = await generate('ai', frames.id, 'https://youtu.be/VisualOnly1');
  assert.equal(videoOnly.status, 'ready', JSON.stringify(videoOnly));
  assert.equal(videoOnly.clips[0].title, 'A visual highlight');
  assert.ok(videoOnly.warnings.some((warning) => warning.includes('No source captions')));
  const noSpeech = (await calls()).at(-1).body.messages.at(-1).content[0].text;
  assert.ok(JSON.parse(noSpeech).windows.every(({ transcript }) => transcript === ''));
  assert.equal(JSON.parse(noSpeech).source.viewCount, 42);

  const firstTranslationCall = (await calls()).length;
  const foreign = await generate('ai', frames.id, 'https://youtu.be/ForeignCut1');
  assert.equal(foreign.status, 'ready', JSON.stringify(foreign));
  assert.equal(foreign.engine, 'AI · Frame model');
  assert.ok(foreign.clips[0].burnedCaptions);
  assert.equal(foreign.clips[0].captionLanguage, 'en');
  const translated = await admin.request(foreign.clips[0].captionsUrl.slice(4)).then((res) => res.text());
  assert.match(translated, /A well-made video starts with a hook/);
  assert.doesNotMatch(translated, /Un buen vídeo/);
  const [visionCall, translationCall, repairCall, ...extra] = (await calls()).slice(firstTranslationCall);
  assert.ok(Array.isArray(visionCall.body.messages.at(-1).content));
  const requestedIds = (call) => JSON.parse(call.body.messages.at(-1).content).map(({ id }) => id);
  assert.deepEqual(requestedIds(repairCall), requestedIds(translationCall).slice(1));
  assert.deepEqual(extra, []);

  const rejected = await generate('ai', invalid.id);
  assert.equal((await calls()).filter(({ body }) => body?.model === 'fixture-invalid-vision').length, 2, 'one repair attempt, even when both replies are unusable');
  assert.equal(rejected.status, 'failed');
  assert.match(rejected.error, /did not rank any valid candidates/);
  assert.equal(rejected.clips.length, 0, 'AI mode must not silently fall back to Local');

  await json(await admin.put('/settings/ranking', { providerId: frames.id }));
  await json(await admin.put('/settings/captions', { providerId: frames.id, model: 'fixture-speech' }));
  const count = (await calls()).length;
  const local = await generate('local', frames.id, 'https://youtu.be/VisualOnly1');
  assert.equal(local.status, 'ready');
  assert.equal(local.options.aiProfile, 'local');
  assert.equal(local.engine, 'Local analysis');
  assert.equal((await calls()).length, count, 'Local uses neither the remote ranker nor the remote transcription setting');
});
