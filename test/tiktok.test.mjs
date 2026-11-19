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

test('TikTok keeps the existing creator, enforces plan slots, and sends to the expressly approved account', async (t) => {
  const store = createStore();
  const root = store.state.tiktok;
  root.config = { clientKey: 'fixture-app', clientSecret: store.seal('fixture-secret'), redirectUri: 'https://example.net/api/tiktok/callback' };
  root.account = { id: 'creator-A', name: 'Existing creator', access: store.seal('token-A'), refresh: store.seal('refresh-A'), expiry: Date.now() + 3_600_000 };
  store.save();
  t.after(() => rm(folder, { recursive: true, force: true }));
  let limit = 2;
  const tiktok = createTikTok(store, { background: false, accountLimit: () => limit });
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (resource, options) => {
    const url = String(resource);
    if (url.endsWith('/oauth/token/')) {
      const key = options.body.get('code') || options.body.get('refresh_token')?.slice(-1);
      assert.ok(['A', 'B', 'C'].includes(key));
      return Response.json({ scope: 'video.upload,user.info.basic', open_id: `creator-${key}`, access_token: `token-${key}`, refresh_token: `refresh-${key}`,
        expires_in: options.body.get('grant_type') === 'refresh_token' ? 3600 : 0 });
    }
    if (url.includes('/user/info/')) {
      const key = options.headers.Authorization.slice(-1);
      return Response.json({ data: { user: { open_id: `creator-${key}`, display_name: `TikTok ${key}` } } });
    }
    if (url.endsWith('/post/publish/inbox/video/init/')) {
      sent.push(options.headers.Authorization);
      return Response.json({ data: { upload_url: 'https://open-upload.tiktokapis.com/video/?upload_id=fixture', publish_id: 'post-for-B' } });
    }
    if (url.includes('open-upload.')) return new Response(null, { status: 201 });
    throw new Error('Unexpected TikTok request');
  });
  const add = (code, authorized) => tiktok.callback({ state: new URL(tiktok.connect()).searchParams.get('state'), code }, authorized);
  assert.equal(root.account, undefined);
  assert.equal(root.accounts[0].id, 'creator-A');
  await add('B');
  await assert.rejects(add('C'), { status: 429 });
  await assert.rejects(add('A', () => false), { status: 401 });
  await add('B'); // Reauthorizing the same identity doesn't use a slot.
  assert.deepEqual(tiktok.describe().accounts.map(({ id, available }) => [id, available]), [['creator-A', true], ['creator-B', true]]);
  assert.doesNotMatch(JSON.stringify(tiktok.describe()), /token-[AB]|refresh-[AB]|fixture-secret/);
  assert.throws(() => tiktok.disconnect(), { status: 400 });

  const clip = { id: 'clip-1' }, job = { id: 'project-2', status: 'ready', options: { demo: false }, clips: [clip] };
  const path = join(jobDir(job.id), clip.id);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'video.mp4'), Buffer.alloc(128));
  store.state.jobs.push(job);
  const selection = { clipIds: [clip.id], accountId: 'creator-B', consent: true };
  limit = 1;
  assert.equal(tiktok.describe().accounts[1].available, false);
  assert.throws(() => tiktok.queue(job, selection), { status: 409 });
  assert.deepEqual(sent, []);
  limit = 2;
  tiktok.queue(job, selection);
  await waitFor(() => clip.tiktok.state === 'processing');
  assert.deepEqual(sent, ['Bearer token-B']);
  assert.equal(clip.tiktok.accountId, 'creator-B');
  tiktok.disconnect('creator-A');
  limit = 1;
  assert.equal(tiktok.describe().account.id, 'creator-B');
  assert.equal(tiktok.describe().accounts.length, 1);
  assert.equal(store.unseal(root.accounts[0].refresh), 'refresh-B');
});
