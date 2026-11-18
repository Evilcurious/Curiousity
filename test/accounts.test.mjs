import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'undici';
import { createStore } from '../server/store.mjs';
import { themes } from '../shared/themes.mjs';
import { exampleAdmin, memberPassword, startEngine } from './helpers/http.mjs';

const exec = promisify(execFile);
const brandPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ28AAAAASUVORK5CYII=';
async function temp(t) {
  const path = await mkdtemp(join(tmpdir(), 'curiousity-account-test-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
async function data(response, status = 200) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}

const adminEnv = { ADMIN_EMAIL: exampleAdmin.email, ADMIN_PASSWORD: exampleAdmin.password };

test('cookie auth, signup validation, per-account integrations and admin-approved premium access', async (t) => {
  const root = await temp(t);
  const engine = await startEngine(t, { env: { DATA_DIR: root, ...adminEnv, GOOGLE_CLIENT_ID: 'env-google-id', GOOGLE_CLIENT_SECRET: 'fixture-google-private', GOOGLE_REDIRECT_URI: 'http://localhost:5173/api/google/callback' } });
  const admin = engine.agent(), member = engine.agent(), other = engine.agent(), anonymous = engine.agent();
  const locked = await anonymous.request('/workspace');
  assert.equal(locked.status, 401);
  assert.equal(locked.headers.get('www-authenticate'), null);
  assert.equal((await data(await anonymous.request('/auth/session'))).user, null);
  assert.equal((await anonymous.post('/auth/signup', { email: 'bad@example.test', password: memberPassword, confirmPassword: 'different password' })).status, 400);
  assert.equal((await anonymous.signup(exampleAdmin.email.toUpperCase())).status, 409);
  assert.equal((await anonymous.signup('bad@example.test', memberPassword, { Origin: 'https://other.example' })).status, 403);
  assert.equal((await anonymous.signup('bad@example.test', memberPassword, { 'X-Clipforge': '' })).status, 403);
  assert.equal((await anonymous.signin(exampleAdmin.email, 'bad-password-for-test')).status, 401);
  let res = await admin.signin();
  assert.match(res.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  assert.doesNotMatch(res.headers.get('set-cookie'), /Secure/);
  assert.equal((await data(res)).user.role, 'admin');
  res = await member.signup('Member@example.test');
  const session = await data(res, 201);
  const { id, email } = session.user;
  assert.equal(email, 'member@example.test');
  assert.equal(session.user.role, 'member');
  assert.equal((await anonymous.signup('member@example.test')).status, 409);
  await data(await other.signup('other@example.test'), 201);
  assert.equal((await member.request('/admin/accounts')).status, 403);
  assert.equal((await member.put(`/admin/accounts/${id}/premium`, { premium: true })).status, 403);

  const apiKey = 'fixture-admin-api-key';
  const adminProfile = await data(await admin.post('/providers', { type: 'custom', name: 'Admin model', baseUrl: 'https://ai.example/v1', model: 'safe-model', apiKey }), 201);
  const own = await data(await member.post('/providers', { type: 'openai', name: 'My key', model: 'member-model', apiKey: 'fixture-member-api-key' }), 201);
  assert.equal((await member.post('/providers', { type: 'custom', name: 'Local endpoint', baseUrl: 'http://localhost:11434/v1', model: 'forbidden' })).status, 400);
  const mcp = await data(await admin.post('/mcp', { name: 'Private MCP', kind: 'remote', url: 'https://mcp.example/mcp', token: 'fixture-admin-mcp-token' }), 201);
  const myMcp = await data(await member.post('/mcp', { kind: 'buffer', token: 'fixture-personal-buffer-key' }), 201);
  assert.equal(myMcp.url, 'https://mcp.buffer.com/mcp');
  assert.equal((await other.post(`/mcp/${myMcp.id}/inspect`)).status, 404);
  assert.equal((await member.post(`/mcp/${mcp.id}/run`, { approved: true, name: 'account', arguments: {} })).status, 404);
  assert.equal((await other.request(`/providers/${own.id}/models`)).status, 404);

  const myWorkspace = () => member.request('/workspace').then((res) => data(res));
  const isolated = await myWorkspace();
  assert.equal(isolated.google.configured, false);
  assert.deepEqual(isolated.providers.map((p) => p.id), [own.id]);
  assert.deepEqual(isolated.mcps.map((p) => p.id), [myMcp.id]);
  const ownerGoogle = await data(await member.put('/google/config', { clientId: 'fixture-user-id', clientSecret: 'fixture-private-google-key', redirectUri: `${engine.url}/api/google/callback` }));
  assert.equal(ownerGoogle.clientSecret, undefined);
  assert.equal((await myWorkspace()).google.clientId, 'fixture-user-id');
  assert.equal((await data(await admin.request('/workspace'))).google.clientId, 'env-google-id');
  assert.equal((await data(await other.request('/workspace'))).google.configured, false);
  const auth = await data(await member.post('/google/connect', { targets: ['drive'] }));
  const callback = `/google/callback?state=${new URL(auth.url).searchParams.get('state')}&error=access_denied`;
  assert.match(decodeURIComponent((await other.request(callback, { redirect: 'manual' })).headers.get('location')), /not started in this browser/);

  await data(await admin.put(`/admin/providers/${adminProfile.id}/share`, { shared: true }));
  assert.deepEqual((await myWorkspace()).sharedProviders, []);
  assert.equal((await member.put('/settings/ranking', { providerId: adminProfile.id })).status, 404);
  assert.equal((await data(await member.post('/account/premium'))).user.premiumRequested, true);
  const requests = await data(await admin.request('/admin/accounts?q=member'));
  assert.deepEqual(requests.users.map((user) => [user.id, user.premiumRequested]), [[id, true]]);
  assert.equal((await data(await admin.put(`/admin/accounts/${id}/premium`, { premium: true }))).premiumRequested, false);
  const enabled = await myWorkspace();
  assert.deepEqual(enabled.sharedProviders, [{ id: adminProfile.id, name: 'Admin model', model: 'safe-model', type: 'custom', managed: true }]);
  assert.doesNotMatch(JSON.stringify(enabled), /fixture-admin-api-key|private-mcp|ai\.example|env-google-id/);
  assert.equal((await member.put(`/providers/${adminProfile.id}`, { name: 'Overwrite' })).status, 404);
  assert.equal((await member.post('/providers/catalog', { id: adminProfile.id })).status, 404);
  assert.equal((await member.put('/settings/captions', { providerId: adminProfile.id, model: 'whisper-1' })).status, 404);
  assert.equal((await data(await member.put('/settings/ranking', { providerId: adminProfile.id }))).activeProviderId, adminProfile.id);
  await data(await admin.put(`/admin/accounts/${id}/premium`, { premium: false }));
  const disabled = await myWorkspace();
  assert.equal(disabled.activeProviderId, null);
  assert.deepEqual(disabled.sharedProviders, []);

  assert.equal(Object.keys(themes).length, 14);
  assert.equal((await member.put('/account/theme', { theme: 'constructor' })).status, 400);
  assert.equal((await member.put('/admin/branding', { theme: 'paper' })).status, 403);
  assert.equal((await admin.put('/admin/branding', { theme: 'mint', logo: Buffer.from('<svg></svg>').toString('base64') })).status, 400);
  const branding = await data(await admin.put('/admin/branding', { theme: 'mint', logo: brandPng }));
  assert.equal(branding.theme, 'mint');
  const image = await fetch(`${engine.url}${branding.logoUrl}`);
  assert.match(image.headers.get('content-type'), /^image\/png/);
  assert.equal(Buffer.from(await image.arrayBuffer()).toString('base64'), brandPng);
  assert.deepEqual((await data(await anonymous.request('/auth/session'))).branding, branding);
  const chosen = await data(await member.put('/account/theme', { theme: 'midnight' }));
  assert.equal(chosen.user.theme, 'midnight');
  assert.equal(chosen.branding.theme, 'mint');
  assert.equal((await data(await other.request('/auth/session'))).user.theme, null);
  assert.equal((await data(await member.put('/account/theme', { theme: null }))).user.theme, null);
  assert.equal((await data(await admin.put('/admin/branding', { theme: 'paper', logo: null }))).logoUrl, null);
  assert.equal((await anonymous.request('/brand/logo')).status, 404);
  const headers = member.getHeaders();
  assert.equal((await member.post('/auth/signout')).status, 204);
  assert.equal((await member.request('/workspace', { headers })).status, 401);
  const disk = await readFile(join(root, 'workspace.json'), 'utf8');
  assert.ok(disk.includes('premiumRequested'));
  for (const secret of [memberPassword, exampleAdmin.password, apiKey, 'fixture-admin-mcp-token', 'fixture-personal-buffer-key', 'fixture-private-google-key', headers.Cookie.split('=')[1]]) assert.ok(!disk.includes(secret));
});

test('host admin migration adopts private data, recovers delivery, and shared exports remain opt-in and reusable', async (t) => {
  const root = await temp(t);
  const legacy = createStore(root), id = randomUUID(), clipId = 'clip-1', when = new Date().toISOString();
  const path = join(root, 'projects', id, clipId);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'video.mp4'), 'fixture video body');
  await writeFile(join(path, 'captions.srt'), 'fixture subtitles');
  await writeFile(join(path, 'poster.jpg'), 'fixture poster');
  const profileId = randomUUID();
  legacy.state.providers.push({ id: profileId, type: 'openai', name: 'Private legacy model', model: 'old-model', baseUrl: 'https://api.openai.com/v1', apiKey: legacy.seal('legacy-key-fixture') });
  legacy.state.activeProviderId = profileId;
  legacy.state.jobs.push({ id, title: 'Legacy exports', creator: 'Not on shared card', status: 'ready', progress: 100, createdAt: when, updatedAt: when,
    options: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', count: 1, captions: true, demo: false, aiProfile: profileId, captionStyle: { font: 'mono' } },
    clips: [{ id: clipId, title: 'One good clip', duration: 14, start: 60, end: 74, score: 89, withPoster: true, withCaptions: true, hashtags: ['#Highlight'], captionLanguage: 'en', withTimeline: true,
      googleUploads: { drive: { state: 'uploading', accountId: 'legacy-drive-account' } }, tiktok: { state: 'uploading', accountId: 'legacy-tiktok-account' }, bufferDraft: { state: 'sending' } }],
  });
  legacy.save();
  const env = { ...process.env, DATA_DIR: root, ...adminEnv };
  await exec(process.execPath, ['scripts/admin.mjs'], { env });
  let engine = await startEngine(t, { env: { DATA_DIR: root } });
  const admin = engine.agent(), member = engine.agent(), stranger = engine.agent();
  await data(await admin.signin());
  await data(await member.signup('library-reader@example.test'), 201);
  const mine = await data(await admin.request(`/projects/${id}`));
  assert.equal(mine.clips[0].googleUploads.drive.state, 'unconfirmed');
  assert.equal(mine.clips[0].tiktok.state, 'unconfirmed');
  assert.equal(mine.clips[0].bufferDraft.state, 'unconfirmed');
  assert.equal((await data(await admin.request('/workspace'))).activeProviderId, profileId);
  assert.deepEqual(await data(await member.request('/projects')), []);
  assert.equal((await member.request(`/projects/${id}`)).status, 404);
  assert.equal((await member.request(`/projects/${id}/clips/${clipId}/video.mp4`)).status, 404);
  assert.equal((await member.request(`/projects/${id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await member.put(`/projects/${id}/sharing`, { shared: true, consent: true })).status, 404);
  assert.equal((await admin.put(`/projects/${id}/sharing`, { shared: true })).status, 400);
  assert.deepEqual((await data(await member.request('/library'))).clips, []);
  assert.equal((await member.request(`/library/${id}/clips/${clipId}/video.mp4`)).status, 404);
  await data(await admin.put(`/projects/${id}/sharing`, { shared: true, consent: true }));
  const { clips: [clip] } = await data(await member.request('/library?q=highlight'));
  for (const key of ['options', 'creator', 'ownerId', 'sourceUrl', 'start', 'tiktok', 'googleUploads', 'bufferDraft']) assert.equal(clip[key], undefined);
  assert.equal(clip.title, 'One good clip');
  assert.equal(clip.byYou, false);
  assert.equal((await stranger.request(`/library/${id}/clips/${clipId}/video.mp4`)).status, 401);
  const mp4 = await fetch(`${engine.url}${clip.videoUrl}?download=1`, { headers: { ...member.getHeaders(), Range: 'bytes=0-6' } });
  assert.equal(mp4.status, 206);
  assert.match(mp4.headers.get('content-disposition'), /attachment; filename="?curiousity-/);
  assert.equal(await mp4.text(), 'fixture');
  const saved = await data(await member.post(`/library/${id}/clips/${clipId}/save`));
  assert.notEqual(saved.id, id);
  assert.equal(saved.sourceKind, 'shared');
  assert.equal(saved.options.url, undefined);
  assert.equal(saved.options.captionStyle, undefined);
  assert.equal(saved.clips[0].start, 0);
  assert.equal(saved.clips[0].bufferDraft, undefined);
  assert.deepEqual(saved.clips[0].googleUploads || {}, {});
  assert.equal((await data(await member.post(`/library/${id}/clips/${clipId}/save`))).id, saved.id);
  assert.equal((await member.put(`/projects/${saved.id}/sharing`, { shared: true, consent: true })).status, 409);
  assert.equal((await admin.request(`/projects/${saved.id}`)).status, 404);
  assert.equal((await member.request(`/admin/library/${id}`, { method: 'DELETE' })).status, 403);
  assert.equal((await admin.request(`/admin/library/${id}`, { method: 'DELETE' })).status, 204);
  assert.deepEqual((await data(await member.request('/library'))).clips, []);
  assert.equal((await member.request(`/library/${id}/clips/${clipId}/captions.srt`)).status, 404);
  assert.equal((await admin.request(`/projects/${id}`, { method: 'DELETE' })).status, 204);
  assert.equal(await (await fetch(`${engine.url}${saved.clips[0].videoUrl}`, { headers: member.getHeaders() })).text(), 'fixture video body');
  await engine.stop();
  await exec(process.execPath, ['scripts/admin.mjs', '--reset'], { env: { ...env, ADMIN_PASSWORD: 'synthetic-admin-replacement-67' } });
  const previousAdmin = admin.getHeaders(), previousMember = member.getHeaders();
  engine = await startEngine(t, { env: { DATA_DIR: root, ALLOW_SIGNUP: 'false' } });
  const reboot = engine.agent();
  assert.equal((await reboot.request('/projects', { headers: previousAdmin })).status, 401);
  assert.equal((await reboot.signin()).status, 401);
  assert.equal((await data(await reboot.signin(exampleAdmin.email, 'synthetic-admin-replacement-67'))).user.role, 'admin');
  assert.equal((await data(await engine.agent().request(`/projects/${saved.id}`, { headers: previousMember }))).id, saved.id);
  assert.equal((await data(await engine.agent().request('/auth/session'))).allowSignup, false);
  assert.equal((await engine.agent().signup('blocked@example.test')).status, 403);
});

test('signed-in password change validates current credentials and revokes every session for that account', async (t) => {
  const root = await temp(t);
  const engine = await startEngine(t, { env: { DATA_DIR: root, ...adminEnv } });
  const member = engine.agent(), otherDevice = engine.agent(), admin = engine.agent(), guest = engine.agent();
  const email = 'rotate@example.test', newPassword = 'unique-replacement-fixture-51';
  const request = { currentPassword: memberPassword, newPassword, confirmPassword: newPassword };
  await data(await member.signup(email), 201);
  await data(await otherDevice.signin(email, memberPassword));
  await data(await admin.signin());
  assert.equal((await guest.put('/account/password', request)).status, 401);
  assert.equal((await member.put('/account/password', request, { Origin: 'https://wrong.example' })).status, 403);
  assert.equal((await member.put('/account/password', { ...request, confirmPassword: memberPassword })).status, 400);
  assert.equal((await member.put('/account/password', { ...request, currentPassword: 'incorrect-fixture-password' })).status, 403);
  assert.equal((await member.put('/account/password', { ...request, newPassword: memberPassword, confirmPassword: memberPassword })).status, 400);
  assert.equal((await otherDevice.request('/workspace')).status, 200);

  const changed = await member.put('/account/password', request);
  assert.equal(changed.status, 204);
  assert.match(changed.headers.get('set-cookie'), /^curiousity_session=;/);
  assert.equal((await member.request('/workspace')).status, 401);
  assert.equal((await otherDevice.request('/workspace')).status, 401);
  assert.equal((await admin.request('/workspace')).status, 200);
  assert.equal((await member.signin(email, memberPassword)).status, 401);
  assert.equal((await data(await member.signin(email, newPassword))).user.email, email);
  const disk = await readFile(join(root, 'workspace.json'), 'utf8');
  assert.ok(!disk.includes(newPassword) && !disk.includes(memberPassword));
});

test('temporary admin credentials expire and cannot administer the workspace until replaced', async (t) => {
  const root = await temp(t);
  const env = { ...process.env, DATA_DIR: root, ...adminEnv };
  await exec(process.execPath, ['scripts/admin.mjs', '--temporary'], { env });
  const store = createStore(root);
  const expiry = store.state.users[0].temporaryPasswordExpiresAt;
  assert.ok(expiry > Date.now() && expiry <= Date.now() + 86_400_000);
  const expiredRoot = await temp(t);
  const expiredStore = createStore(expiredRoot);
  expiredStore.state.users = [{ ...store.state.users[0], temporaryPasswordExpiresAt: Date.now() - 2000 }];
  expiredStore.save();
  const expired = await startEngine(t, { env: { DATA_DIR: expiredRoot } });
  assert.match((await data(await expired.agent().signin(), 401)).error, /expired/);

  const engine = await startEngine(t, { env: { DATA_DIR: root } });
  const admin = engine.agent();
  const login = await admin.signin();
  assert.ok(Number(login.headers.get('set-cookie').match(/Max-Age=(\d+)/)[1]) <= 86_400);
  assert.equal((await data(login)).user.mustChangePassword, true);
  assert.equal((await data(await admin.request('/auth/session'))).user.mustChangePassword, true);
  assert.equal((await admin.request('/workspace')).status, 403);
  assert.equal((await admin.request('/admin/accounts')).status, 403);
  const newPassword = 'private-admin-replacement-fixture-23';
  assert.equal((await admin.put('/account/password', { currentPassword: exampleAdmin.password, newPassword: '12chars-only', confirmPassword: '12chars-only' })).status, 400);
  assert.equal((await admin.put('/account/password', { currentPassword: exampleAdmin.password, newPassword, confirmPassword: newPassword })).status, 204);
  assert.equal((await admin.signin()).status, 401);
  assert.equal((await data(await admin.signin(exampleAdmin.email, newPassword))).user.mustChangePassword, false);
  assert.equal((await admin.request('/admin/accounts')).status, 200);
  assert.equal(createStore(root).state.users[0].temporaryPasswordExpiresAt, undefined);
});

test('public password requests require a trusted HTTPS connection, including after sign-in', async (t) => {
  const PUBLIC_ORIGIN = 'https://clips.example.test';
  const host = { Host: new URL(PUBLIC_ORIGIN).host };
  const http = { ...host, Origin: PUBLIC_ORIGIN.replace('https:', 'http:') };
  const tls = { ...host, Origin: PUBLIC_ORIGIN, 'X-Forwarded-Proto': 'https' };
  // Use the lower-level client so Host is forwarded exactly as it would be by the proxy.
  const send = async (engine, path, headers, method = 'GET', body) => {
    const result = await httpRequest(`${engine.url}/api${path}`, { method, headers: { 'X-Clipforge': 'workspace', ...(body && { 'Content-Type': 'application/json' }), ...headers }, body: body && JSON.stringify(body) });
    return { status: result.statusCode, cookie: result.headers['set-cookie'], data: result.statusCode === 204 ? await result.body.dump() : await result.body.json() };
  };
  const signin = (engine, headers, credentials = exampleAdmin) => send(engine, '/auth/signin', headers, 'POST', credentials);
  const direct = await startEngine(t, { env: { DATA_DIR: await temp(t), ...adminEnv, PUBLIC_ORIGIN } });
  assert.equal((await send(direct, '/auth/session', host)).data.httpsOrigin, PUBLIC_ORIGIN);
  for (const headers of [http, tls]) {
    const rejected = await signin(direct, headers);
    assert.equal(rejected.status, 403);
    assert.equal(rejected.cookie, undefined);
    assert.match(rejected.data.error, /require HTTPS/);
  }
  assert.equal((await send(direct, '/auth/signup', http, 'POST', { email: 'insecure@example.test', password: memberPassword, confirmPassword: memberPassword })).status, 403);
  assert.equal((await direct.agent().signin()).status, 200, 'private localhost access still works');

  const deployment = await startEngine(t, { env: { DATA_DIR: await temp(t), ...adminEnv, PUBLIC_ORIGIN, TRUST_PROXY: '1' } });
  const cleartext = { ...http, 'X-Forwarded-Proto': 'http' };
  assert.equal((await signin(deployment, cleartext)).status, 403);
  const login = await signin(deployment, tls);
  assert.equal(login.status, 200);
  assert.equal(login.data.user.role, 'admin');
  assert.match(login.cookie, /HttpOnly; Secure; SameSite=Lax/);
  assert.doesNotMatch(login.cookie, /Partitioned/);
  const Cookie = login.cookie.split(';', 1)[0];
  const replacement = 'different-https-fixture-password';
  const change = { currentPassword: exampleAdmin.password, newPassword: replacement, confirmPassword: replacement };
  assert.equal((await send(deployment, '/account/password', { ...cleartext, Cookie }, 'PUT', change)).status, 403);
  const updated = await send(deployment, '/account/password', { ...tls, Cookie }, 'PUT', change);
  assert.equal(updated.status, 204);
  assert.match(updated.cookie, /HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await signin(deployment, tls)).status, 401);
  assert.equal((await signin(deployment, tls, { ...exampleAdmin, password: replacement })).status, 200);

  // A VPS service that starts `node server/main.mjs` directly should pick up
  // the same project configuration as npm start, before the store is loaded.
  const cwd = await temp(t);
  await writeFile(join(cwd, '.env'), `TRUST_PROXY=loopback\nPUBLIC_ORIGIN=${PUBLIC_ORIGIN}\nDATA_DIR=./vps-data\n`);
  const linux = await startEngine(t, { cwd, env: { ...adminEnv, TRUST_PROXY: undefined, PUBLIC_ORIGIN: undefined, DATA_DIR: undefined } });
  const vps = { Host: '127.0.0.1:5173', 'X-Forwarded-For': '198.51.100.8', 'X-Forwarded-Host': 'alias.example.test', 'X-Forwarded-Proto': 'HTTPS' };
  const session = (await send(linux, '/auth/session', vps)).data;
  assert.equal(session.httpsOrigin, PUBLIC_ORIGIN);
  assert.equal(session.passwordTransport, 'https');
  assert.equal(JSON.parse(await readFile(join(cwd, 'vps-data', 'workspace.json'), 'utf8')).users.length, 1);

  // A loopback proxy may rewrite Host, but the TLS request's forwarded
  // public hostname still matches its browser origin.
  const viaProxy = await signin(linux, { ...vps, Origin: 'https://alias.example.test' });
  assert.equal(viaProxy.status, 200);
  assert.match(viaProxy.cookie, /; Secure;/);
  for (const invalid of ['', 'http', 'https, http']) {
    const headers = { ...vps, Origin: PUBLIC_ORIGIN, 'X-Forwarded-Proto': invalid };
    const failure = await signin(linux, headers);
    assert.equal(failure.status, 403);
    assert.equal(failure.cookie, undefined);
    assert.match(failure.data.error, /overwrite X-Forwarded-Proto/);
  }
  const mismatch = await signin(linux, { ...tls, Origin: http.Origin });
  assert.equal(mismatch.status, 403, 'HTTP browser origins cannot use a reported TLS connection');
  const falseLoopback = await signin(linux, { ...host, 'X-Forwarded-Host': 'localhost' });
  assert.equal(falseLoopback.status, 403, 'forwarded host cannot masquerade as local HTTP');
  assert.equal((await linux.agent().signin()).status, 200);
});

test('generated administrator passwords are not created or printed to redirected output', async (t) => {
  const root = await temp(t);
  const env = { ...process.env, DATA_DIR: root, ADMIN_EMAIL: exampleAdmin.email, ADMIN_PASSWORD: '' };
  await assert.rejects(exec(process.execPath, ['scripts/admin.mjs', '--generate'], { env }), (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, '');
    assert.match(error.stderr, /interactive terminal/);
    return true;
  });
  assert.equal(createStore(root).state.users.length, 0);
});
