import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const folder = await mkdtemp(join(tmpdir(), 'cf-tiktok-'));
process.env.DATA_DIR = folder;
for (const key of ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REDIRECT_URI']) delete process.env[key];
const { createStore, jobDir } = await import('../server/store.mjs');
const { chunkPlan, createTikTok } = await import('../server/tiktok.mjs');
const MiB = 1024 * 1024;

test('splits uploaded files into TikTok-compatible sequential chunks', () => {
  assert.deepEqual(chunkPlan(128), { chunkSize: 128, chunks: [{ start: 0, end: 127 }] });
  const plan = chunkPlan(29 * MiB);
  assert.equal(plan.chunkSize, 10 * MiB);
  assert.deepEqual(plan.chunks, [{ start: 0, end: 10 * MiB - 1 }, { start: 10 * MiB, end: 29 * MiB - 1 }]);
});

async function waitFor(predicate) {
  for (let trial = 0; trial < 80; trial++) {
    if (predicate()) return;
    await setTimeout(25);
  }
  throw new Error('TikTok test job did not settle.');
}

test('OAuth state is single-use; only a consented batch is uploaded and marked sent on confirmation', async (t) => {
  t.after(() => rm(folder, { recursive: true, force: true }));
  const store = createStore();
  const tiktok = createTikTok(store);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (resource, options) => {
    const url = String(resource);
    calls.push(url);
    if (url.endsWith('/oauth/token/')) {
      assert.equal(options.body.get('code'), 'code-from-tiktok');
      return Response.json({ scope: 'user.info.basic,video.upload', open_id: 'creator-id', access_token: 'short-lived-token', refresh_token: 'refresh-token', expires_in: 86400 });
    }
    if (url.includes('/user/info/')) return Response.json({ data: { user: { open_id: 'creator-id', display_name: 'Test creator' } }, error: { code: 'ok' } });
    if (url.endsWith('/post/publish/inbox/video/init/')) {
      assert.equal(options.headers.Authorization, 'Bearer short-lived-token');
      assert.deepEqual(JSON.parse(options.body).source_info, { source: 'FILE_UPLOAD', video_size: 128, chunk_size: 128, total_chunk_count: 1 });
      return Response.json({ data: { upload_url: 'https://open-upload.tiktokapis.com/video/?upload_id=fixture', publish_id: 'post-fixture' }, error: { code: 'ok' } });
    }
    if (url.includes('open-upload.')) {
      assert.equal(options.method, 'PUT');
      assert.equal(options.headers['Content-Range'], 'bytes 0-127/128');
      assert.equal(options.body.length, 128);
      return new Response(null, { status: 201 });
    }
    assert.ok(url.endsWith('/post/publish/status/fetch/'));
    assert.deepEqual(JSON.parse(options.body), { publish_id: 'post-fixture' });
    return Response.json({ data: { status: 'SEND_TO_USER_INBOX' }, error: { code: 'ok' } });
  });
  assert.throws(() => tiktok.configure({ clientKey: 'test-client', clientSecret: 'test-secret', redirectUri: 'http://example.net/api/tiktok/callback' }), { status: 400 });
  tiktok.configure({ clientKey: 'test-client', clientSecret: 'test-secret', redirectUri: 'https://example.net/api/tiktok/callback' });
  const auth = new URL(tiktok.connect());
  assert.equal(auth.searchParams.get('scope'), 'user.info.basic,video.upload');
  const query = { state: auth.searchParams.get('state'), code: 'code-from-tiktok' };
  await tiktok.callback(query);
  await assert.rejects(tiktok.callback(query), { status: 400 });
  assert.equal(tiktok.describe().connected, true);
  assert.equal(tiktok.describe().clientSecret, undefined);
  const clip = { id: 'clip-1' };
  const job = { id: 'project-fixture', status: 'ready', options: { demo: false }, clips: [clip] };
  store.state.jobs.push(job);
  const path = join(jobDir(job.id), clip.id);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'video.mp4'), Buffer.alloc(128));
  const selection = { clipIds: [clip.id], accountId: 'creator-id' };
  assert.throws(() => tiktok.queue(job, { ...selection, consent: false }), { status: 400 });
  assert.throws(() => tiktok.queue(job, { ...selection, consent: true, accountId: 'other' }), { status: 409 });
  assert.equal(calls.length, 2);
  tiktok.queue(job, { ...selection, consent: true });
  await waitFor(() => clip.tiktok.state === 'processing');
  tiktok.checkStatus(clip);
  await waitFor(() => clip.tiktok.state === 'sent');
  assert.equal(calls.length, 5);
  assert.throws(() => tiktok.queue(job, { ...selection, consent: true }), { status: 409 });
});
