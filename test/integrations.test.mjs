import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { exampleAdmin, memberPassword, startEngine } from './helpers/http.mjs';

const origin = 'https://studio.example.test';
const https = { Origin: origin, 'X-Forwarded-Proto': 'https' };
const creds = { ADMIN_EMAIL: exampleAdmin.email, ADMIN_PASSWORD: exampleAdmin.password };
async function json(response, expected = 200) {
  const body = await response.json();
  assert.equal(response.status, expected, JSON.stringify(body));
  return body;
}
async function boot(t) {
  const root = await mkdtemp(join(tmpdir(), 'curiousity-integrations-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const trace = join(root, 'integrations.jsonl');
  const engine = await startEngine(t, { imports: ['test/fixtures/integrations-network.mjs'], env: { DATA_DIR: root, ...creds, PUBLIC_ORIGIN: origin, TRUST_PROXY: 'loopback', FIXTURE_INTEGRATIONS_TRACE: trace } });
  const admin = engine.agent(), member = engine.agent(), other = engine.agent();
  await json(await admin.signin(undefined, undefined, https));
  const { user } = await json(await member.signup('integration-user@example.test', undefined, https), 201);
  await json(await other.signup('other-connection@example.test', undefined, https), 201);
  const readCalls = async () => (await readFile(trace, 'utf8').catch((err) => { if (err.code !== 'ENOENT') throw err; return ''; })).trim().split('\n').filter(Boolean).map(JSON.parse);
  return { root, engine, admin, member, other, user, readCalls };
}

async function begin(client, site) {
  const response = await client.post(`/${site}/connect`, site === 'google' ? { targets: ['drive'] } : {}, https);
  const signIn = new URL((await json(response)).url);
  const stateCookie = response.headers.get('set-cookie');
  assert.match(stateCookie, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(stateCookie, new RegExp(`Path=/api/${site}/callback`));
  assert.equal(signIn.searchParams.get('redirect_uri'), `${origin}/api/${site}/callback`);
  const callback = (withClient, code) => withClient.request(`/${site}/callback?${new URLSearchParams({ state: signIn.searchParams.get('state'), code })}`, {
    redirect: 'manual', headers: { ...https, Cookie: `${withClient.getHeaders().Cookie}; ${stateCookie.split(';')[0]}` },
  });
  return { signIn, callback };
}
const workspace = (client) => client.request('/workspace').then((res) => json(res));

test('admin sets up OAuth once; users authorize their own grants in the original session without legacy API', async (t) => {
  const { root, engine, admin, member, other, user, readCalls } = await boot(t);
  assert.equal((await member.post('/google/connect', { targets: ['drive'] }, https)).status, 409);
  assert.equal((await member.post('/tiktok/connect', {}, https)).status, 409);
  const configs = {
    google: { clientId: 'fixture-google-app', clientSecret: 'fixture-google-private-config' },
    tiktok: { clientKey: 'fixture-tiktok-app', clientSecret: 'fixture-tiktok-private-config' },
  };
  const secondSession = engine.agent();
  await json(await secondSession.signin(user.email, memberPassword, https));
  for (const site of Object.keys(configs)) {
    assert.equal((await member.put(`/${site}/config`, configs[site], https)).status, 403);
    const configured = await json(await admin.put(`/${site}/config`, configs[site], https));
    assert.equal(configured.configured, true);
    assert.equal(configured.clientSecret, undefined);
    assert.equal((await workspace(member))[site].configured, true);
    assert.equal((await workspace(member))[site].connected, false);
    assert.equal((await workspace(member))[site].clientId, undefined);
    assert.equal((await workspace(member))[site].clientKey, undefined);
    const { signIn, callback } = await begin(member, site);
    assert.equal(signIn.searchParams.get(site === 'google' ? 'client_id' : 'client_key'), configs[site].clientId || configs[site].clientKey);
    assert.match(signIn.searchParams.get('scope'), site === 'google' ? /drive\.file/ : /video\.upload/);
    const countBefore = (await readCalls()).length;
    assert.match(decodeURIComponent((await callback(secondSession, 'wrong-session')).headers.get('location')), /same Curiousity session/);
    assert.match(decodeURIComponent((await callback(other, 'wrong-user')).headers.get('location')), /expired/);
    assert.equal((await readCalls()).length, countBefore);
    assert.match(decodeURIComponent((await callback(member, 'member')).headers.get('location')), /connected\./);
    assert.match(decodeURIComponent((await callback(member, 'replay')).headers.get('location')), /expired/);
    assert.equal((await workspace(member))[site].account.id, `${site}-member`);
    assert.equal((await workspace(other))[site].account, null);
    assert.equal((await workspace(admin))[site].account, null);
    const adminAuth = await begin(admin, site);
    assert.match(decodeURIComponent((await adminAuth.callback(admin, 'admin')).headers.get('location')), /connected\./);
    assert.equal((await workspace(admin))[site].account.id, `${site}-admin`);
    assert.equal((await workspace(member))[site].account.id, `${site}-member`);
    if (site === 'tiktok') {
      const third = await begin(member, site);
      assert.match(decodeURIComponent((await third.callback(member, 'another-creator')).headers.get('location')), /account limit/);
      assert.equal((await workspace(member)).tiktok.accounts.length, 1);
      assert.equal((await other.post('/tiktok/disconnect', { accountId: 'tiktok-member' }, https)).status, 404);
    } else {
      const call = (await readCalls()).find(({ via, body }) => via === 'google-token' && body.code === 'member');
      assert.equal(createHash('sha256').update(call.body.code_verifier).digest('base64url'), signIn.searchParams.get('code_challenge'));
      assert.deepEqual((await workspace(member)).google.grants, { drive: true, youtube: false });
    }
  }
  const saved = await workspace(member);
  assert.equal(saved.user.email, user.email);
  assert.doesNotMatch(JSON.stringify(saved), /fixture-(?:google|tiktok)-(?:access|refresh|private-config)|tiktok-admin|google-admin/);
  assert.doesNotMatch(await readFile(join(root, 'workspace.json'), 'utf8'), /fixture-(?:google|tiktok)-(?:access|refresh|private-config)/);
  const disconnected = await json(await member.post('/google/disconnect', {}, https));
  assert.equal(disconnected.connected, false);
  assert.equal((await workspace(admin)).google.account.id, 'google-admin');
  await json(await admin.put('/tiktok/config', { clientKey: 'different-tiktok-app', clientSecret: 'new-secret' }, https));
  assert.equal((await workspace(member)).tiktok.connected, false, 'tokens from a different app are not available for delivery');
});

test('n8n replaces the connector with an admin-pinned workflow, exact private review, and single-use approval', async (t) => {
  const { root, engine, admin, member, other, user, readCalls } = await boot(t);
  assert.equal((await member.request('/admin/n8n')).status, 403);
  assert.equal((await member.request('/composio/connections')).status, 410);
  assert.equal((await member.post('/chat/apps', { message: 'test' })).status, 410);
  assert.equal((await member.post('/chat/workflows', { message: 'Try now' })).status, 409);
  const config = { name: 'Fixture workflow', token: 'workflow-fixture-private-secret', enabled: true, url: 'https://workflow.example.test/webhook/curiousity' };
  assert.equal((await member.put('/admin/n8n', config)).status, 403);
  for (const url of ['http://127.0.0.1/webhook/a', 'https://localhost/webhook/a', 'https://workflow.example.test/webhook-test/a', 'https://workflow.example.test/webhook/a?key=bad']) assert.equal((await admin.put('/admin/n8n', { ...config, url })).status, 400);
  const saved = await json(await admin.put('/admin/n8n', config));
  assert.equal(saved.hasToken, true);
  assert.equal(saved.token, undefined);
  assert.doesNotMatch(await readFile(join(root, 'workspace.json'), 'utf8'), /workflow-fixture-private-secret/);
  assert.deepEqual((await workspace(member)).n8n, { enabled: true, name: 'Fixture workflow' });

  const plan = async (message) => (await json(await member.post('/chat/workflows', { message, url: 'https://attacker.example/webhook/ignored' }))).review;
  const review = await plan('  Review this exact input.  ');
  const route = `/chat/workflows/${review.id}`;
  assert.deepEqual(review.input, { requestId: review.id, memberId: user.id, message: 'Review this exact input.' });
  assert.equal((await other.post(route, { approved: true })).status, 404);
  assert.equal((await member.post(route, { approved: false })).status, 400);
  assert.equal((await member.post(route, { approved: true, input: { message: 'changed' } })).status, 400);
  const newSession = engine.agent();
  await json(await newSession.signin(user.email, memberPassword, https));
  assert.equal((await newSession.post(route, { approved: true })).status, 404);
  assert.deepEqual(await readCalls(), [], 'nothing runs during review');

  const responses = await Promise.all([member.post(route, { approved: true }), member.post(route, { approved: true })]);
  assert.equal(responses.filter((response) => response.ok).length, 1);
  assert.equal((await json(responses.find((response) => response.ok))).reply, 'Approved: Review this exact input. [[redacted]]');
  assert.equal((await member.post(route, { approved: true })).status, 404);
  assert.deepEqual((await readCalls()).map(({ path, method, body, redirect }) => ({ path, method, body, redirect })), [{ path: '/webhook/curiousity', method: 'POST', body: review.input, redirect: 'error' }]);
  assert.doesNotMatch(await readFile(join(root, 'workspace.json'), 'utf8'), /Review this exact input/);

  const cancelled = `/chat/workflows/${(await plan('Cancel me')).id}`;
  assert.equal((await member.request(cancelled, { method: 'DELETE' })).status, 204);
  assert.equal((await member.post(cancelled, { approved: true })).status, 404);
  const uncertain = `/chat/workflows/${(await plan('No confirmation')).id}`;
  assert.match((await json(await member.post(uncertain, { approved: true }), 502)).error, /Check the workflow’s executions/);
  assert.equal((await member.post(uncertain, { approved: true })).status, 404);
  const noReply = `/chat/workflows/${(await plan('No intentional reply')).id}`;
  assert.match((await json(await member.post(noReply, { approved: true }))).reply, /No response content/);
  const stale = `/chat/workflows/${(await plan('Settings can change')).id}`;
  await json(await admin.put('/admin/n8n', { ...config, token: '', enabled: false }));
  assert.equal((await member.post(stale, { approved: true })).status, 404);
  assert.equal((await readCalls()).length, 3);
});
