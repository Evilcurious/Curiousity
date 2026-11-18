import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const folder = await mkdtemp(join(tmpdir(), 'cf-google-'));
process.env.DATA_DIR = folder;
for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI']) delete process.env[key];
const { createStore, jobDir } = await import('../server/store.mjs');
const { createGoogle, googleScopes, publicGoogleUploads } = await import('../server/google.mjs');
const chunk = 4 * 1024 * 1024, size = chunk + 100;
const config = { clientId: 'test-google-client', clientSecret: 'test-google-secret', redirectUri: 'http://localhost:5173/api/google/callback' };
const location = (id) => `https://www.googleapis.com/upload/drive/v3/files?upload_id=${id}`;

async function waitFor(predicate) {
  for (let trial = 0; trial < 120; trial++) {
    if (predicate()) return;
    await setTimeout(20);
  }
  throw new Error('Google upload test did not settle.');
}

test('Google OAuth uses scoped, one-time PKCE and uploads only reviewed clips', async (t) => {
  t.after(() => rm(folder, { recursive: true, force: true }));
  const store = createStore();
  const google = createGoogle(store);
  assert.throws(() => google.configure({ ...config, redirectUri: 'http://elsewhere.example/api/google/callback' }), { status: 400 });
  google.configure(config);
  assert.equal(google.describe().clientSecret, undefined);
  assert.throws(() => google.connect([], 'http://localhost:5173'), { status: 400 });
  assert.throws(() => google.connect(['drive'], 'http://localhost:1234'), { status: 400 });
  const signIn = google.connect(['youtube', 'other', 'drive', 'drive'], 'http://localhost:5173');
  const auth = new URL(signIn.url);
  assert.equal(auth.hostname, 'accounts.google.com');
  assert.equal(auth.searchParams.get('access_type'), 'offline');
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.deepEqual(auth.searchParams.get('scope').split(' '), ['openid', 'profile', googleScopes.youtube, googleScopes.drive]);
  assert.equal(auth.searchParams.get('state'), signIn.state);

  const calls = [];
  let lostResponse = false;
  t.mock.method(globalThis, 'fetch', async (resource, options) => {
    const url = new URL(resource);
    calls.push([url.href, options.method, options.headers?.['Content-Range']]);
    if (url.hostname === 'oauth2.googleapis.com') {
      const form = options.body;
      assert.equal(form.get('client_secret'), config.clientSecret);
      if (form.get('grant_type') === 'refresh_token') {
        assert.equal(form.get('refresh_token'), 'fixture-refresh');
        return Response.json({ access_token: 'fixture-access-2', expires_in: 3600 });
      }
      assert.equal(form.get('code'), 'fixture-code');
      assert.equal(form.get('redirect_uri'), config.redirectUri);
      assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), auth.searchParams.get('code_challenge'));
      return Response.json({ scope: `openid profile ${googleScopes.drive} ${googleScopes.youtube}`, access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 1 });
    }
    if (url.hostname === 'openidconnect.googleapis.com') {
      assert.equal(options.headers.Authorization, 'Bearer fixture-access');
      return Response.json({ sub: 'google-fixture', name: 'Fixture Google Account' });
    }
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, 'www.googleapis.com');
    assert.equal(options.headers.Authorization, 'Bearer fixture-access-2');
    if (url.searchParams.get('uploadType') === 'resumable') {
      const metadata = JSON.parse(options.body);
      assert.equal(options.headers['X-Upload-Content-Length'], String(size));
      if (url.pathname.startsWith('/upload/youtube/')) {
        assert.equal(url.searchParams.get('notifySubscribers'), 'false');
        assert.equal(metadata.status.privacyStatus, 'private');
        assert.equal(metadata.status.selfDeclaredMadeForKids, false);
        assert.equal(metadata.snippet.title, 'Reviewed YouTube title');
        assert.equal(metadata.snippet.description, '#Highlights');
        return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=youtube-session' } });
      }
      assert.equal(metadata.description, '#Highlights');
      if (metadata.name === 'Bad destination.mp4') return new Response(null, { headers: { Location: 'https://other.example/session' } });
      if (metadata.name === 'Unconfirmed.mp4') return new Response(null, { headers: { Location: location('unconfirmed') } });
      assert.equal(metadata.name, 'Reviewed Drive title.mp4');
      return new Response(null, { headers: { Location: location('drive-session') } });
    }
    assert.equal(options.method, 'PUT');
    assert.equal(options.redirect, 'manual');
    const range = options.headers['Content-Range'];
    if (range === `bytes 0-${chunk - 1}/${size}`) {
      assert.equal(options.body.length, chunk);
      return new Response(null, { status: 308, headers: { Range: `bytes=0-${chunk - 1}` } });
    }
    if (range === `bytes */${size}`) {
      assert.equal(options.headers['Content-Length'], '0');
      return new Response(null, { status: 308, headers: { Range: `bytes=0-${chunk - 1}` } });
    }
    assert.equal(options.body.length, 100);
    assert.equal(range, `bytes ${chunk}-${size - 1}/${size}`);
    if (url.searchParams.get('upload_id') === 'youtube-session') return Response.json({ id: 'yt_clip_test' }, { status: 201 });
    if (url.searchParams.get('upload_id') === 'unconfirmed') return Response.json({ id: 'invalid/clip' });
    if (!lostResponse) { lostResponse = true; throw new TypeError('Lost connection'); }
    return Response.json({ id: 'drive-file-id' });
  });

  const query = { state: signIn.state, code: 'fixture-code' };
  await google.callback(query);
  await assert.rejects(google.callback(query), { status: 400 });
  assert.deepEqual(google.describe().grants, { drive: true, youtube: true });
  assert.equal(google.describe().account.name, 'Fixture Google Account');
  google.configure({ ...config, clientSecret: '' });
  assert.equal(google.describe().connected, true);

  const clips = ['First clip', 'Bad destination', 'Unconfirmed'].map((title, index) => ({ id: `clip-${index + 1}`, title, hashtags: ['#Highlights'] }));
  const job = { id: 'google-project', status: 'ready', options: { demo: false }, clips };
  store.state.jobs.push(job);
  for (const clip of clips) {
    const path = join(jobDir(job.id), clip.id);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'video.mp4'), Buffer.alloc(size));
  }
  const [clip, denied, unconfirmed] = clips;
  const approved = { target: 'drive', accountId: 'google-fixture', clipIds: [clip.id], consent: true };
  assert.throws(() => google.queue(job, { ...approved, consent: false }), { status: 400 });
  assert.throws(() => google.queue(job, { ...approved, accountId: 'not-fixture' }), { status: 409 });
  assert.throws(() => google.queue(job, { ...approved, target: 'youtube' }), { status: 400 });
  assert.throws(() => google.queue({ ...job, options: { demo: true } }, { ...approved, target: 'youtube', madeForKids: false }), { status: 400 });
  assert.equal(calls.length, 2);
  google.queue(job, { ...approved, edits: { [clip.id]: { title: 'Reviewed Drive title' } } });
  assert.throws(() => google.queue(job, approved), { status: 409 });
  google.queue(job, { ...approved, target: 'youtube', madeForKids: false, edits: { [clip.id]: { title: 'Reviewed YouTube title' } } });
  google.queue(job, { ...approved, clipIds: [denied.id, unconfirmed.id] });
  await waitFor(() => ['sent', 'failed'].includes(clip.googleUploads.youtube.state) && ['unconfirmed', 'failed', 'sent'].includes(unconfirmed.googleUploads.drive.state));
  assert.equal(clip.googleUploads.drive.state, 'sent', clip.googleUploads.drive.reason);
  assert.equal(clip.googleUploads.youtube.state, 'sent', clip.googleUploads.youtube.reason);
  assert.equal(denied.googleUploads.drive.state, 'failed');
  assert.match(denied.googleUploads.drive.reason, /invalid upload location/);
  assert.equal(unconfirmed.googleUploads.drive.state, 'unconfirmed');
  assert.throws(() => google.queue(job, { ...approved, clipIds: [unconfirmed.id] }), { status: 409 });
  assert.ok(calls.some(([, , range]) => range === `bytes */${size}`));
  assert.ok(calls.every(([url]) => !url.startsWith('https://other.example')));
  assert.deepEqual(JSON.parse(JSON.stringify(publicGoogleUploads(clip.googleUploads))), {
    drive: { state: 'sent', link: 'https://drive.google.com/file/d/drive-file-id/view' },
    youtube: { state: 'sent', link: 'https://studio.youtube.com/video/yt_clip_test/edit' },
  });
  const data = await readFile(join(folder, 'workspace.json'), 'utf8');
  assert.doesNotMatch(data, /fixture-access|fixture-refresh|test-google-secret|drive-session/);
  google.disconnect();
  assert.equal(google.describe().connected, false);
  assert.throws(() => google.queue(job, approved), { status: 409 });
});
