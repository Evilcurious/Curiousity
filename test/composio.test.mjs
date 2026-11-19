import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.mjs';
import { connectUrl } from '../server/composio.mjs';
import { exampleAdmin, memberPassword, startEngine } from './helpers/http.mjs';
import { emailTool, modelKey, oauthToken, projectKey, publicSite } from './fixtures/composio-network.mjs';

const forwarded = { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': new URL(publicSite).host };
const callbackPath = '/composio/callback';
const signed = (path) => ({ redirect: 'manual', headers: forwarded, ...path });
async function json(res, code = 200) {
  const body = await res.json();
  assert.equal(res.status, code, JSON.stringify(body));
  return body;
}
async function setup(t, { https = true, env = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'curiousity-composio-test-'));
  const tracePath = join(root, 'outbound.jsonl');
  await writeFile(tracePath, '');
  const engine = await startEngine(t, { imports: ['test/fixtures/composio-network.mjs'], env: {
    DATA_DIR: root, ADMIN_EMAIL: exampleAdmin.email, ADMIN_PASSWORD: exampleAdmin.password, FIXTURE_COMPOSIO_TRACE: tracePath,
    PUBLIC_ORIGIN: https ? publicSite : '', TRUST_PROXY: https ? 'loopback' : '', ...env,
  } });
  t.after(async () => { await engine.stop(); await rm(root, { recursive: true, force: true }); });
  const trace = async () => (await readFile(tracePath, 'utf8')).trim().split('\n').filter(Boolean).map((row) => JSON.parse(row));
  const admin = engine.agent(), user = engine.agent(), other = engine.agent();
  assert.equal((await admin.signin(exampleAdmin.email, exampleAdmin.password, https ? forwarded : {})).status, 200);
  assert.equal((await user.signup('member@example.test', memberPassword, https ? forwarded : {})).status, 201);
  assert.equal((await other.signup('other@example.test', memberPassword, https ? forwarded : {})).status, 201);
  return { root, engine, admin, user, other, trace };
}
async function begin(user, options = {}) {
  const link = await json(await user.post('/composio/connect', { slug: 'gmail', ...options }, { ...forwarded, Origin: publicSite }));
  const number = /\/ln_fixture_(\d+)$/.exec(new URL(link.url).pathname)[1];
  return { id: `ca_fixture_${number}`, callback: `${callbackPath}?session_uri=fixture-verifier-${number}` };
}
async function finish(user, callback, result, from = 'integrations') {
  const response = await user.request(callback, signed());
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), from === 'chat' ? `/#/chat?apps=1&composio=${result}` : `/#/settings/integrations?composio=${result}`);
  return response;
}
const executions = (trace) => trace.filter(({ pathname }) => pathname.endsWith('/execute'));
const authCalls = (trace) => trace.filter(({ pathname }) => pathname.endsWith('/complete_auth'));
const assertSecretFree = (data) => {
  const text = JSON.stringify(data);
  for (const key of [projectKey, modelKey, oauthToken, 'never-exposed.example.test']) assert.ok(!text.includes(key), 'a fixture secret was exposed');
};

// Both Composio-hosted redirect domains are in the published API examples.
test('connect links are limited to Composio’s hosted HTTPS link paths', () => {
  assert.equal(connectUrl('https://connect.composio.dev/link/ln_example'), 'https://connect.composio.dev/link/ln_example');
  for (const url of ['http://connect.composio.dev/link/ln_example', 'https://connect.composio.dev.fake.test/link/ln_example', 'https://user@connect.composio.dev/link/ln_example', 'https://connect.composio.dev/link/ln_example?redirect=https://example.test', 'https://app.composio.dev/something-else', 'https://connect.composio.dev:8443/link/ln_example']) assert.throws(() => connectUrl(url), { status: 502 });
});

test('project setup is admin-only, write-only, disabled by default, and requires a public verifier origin', async (t) => {
  const { root, admin, user, engine, trace } = await setup(t, { https: false });
  assert.equal((await engine.agent().request('/composio/connections')).status, 401);
  assert.equal((await user.request('/admin/composio')).status, 403);
  assert.equal((await user.put('/admin/composio', { enabled: true, apiKey: projectKey })).status, 403);
  assert.equal((await admin.put('/admin/composio', { enabled: true, apiKey: projectKey })).status, 400);
  assert.equal((await admin.put('/admin/composio', { enabled: false, apiKey: 'ck_not_a_platform_key' })).status, 400);
  assert.equal((await user.put('/google/config', {})).status, 410);
  assert.equal((await user.post('/tiktok/connect', {})).status, 410);
  assert.equal((await user.post('/mcp', {})).status, 410);
  assert.equal((await trace()).length, 0);
  const saved = await json(await admin.put('/admin/composio', { enabled: false, apiKey: projectKey }));
  assert.deepEqual(saved, { configured: true, enabled: false, ready: false, callbackUrl: null, keySource: 'workspace' });
  assertSecretFree(saved);
  assert.deepEqual(await json(await user.request('/composio/connections')), { configured: true, enabled: false, ready: false, connections: [] });
  assert.equal((await user.request('/composio/apps')).status, 409);
  assert.equal((await user.post('/composio/connect', { slug: 'gmail' })).status, 409);
  const rejected = await json(await admin.put('/admin/composio', { enabled: false, apiKey: 'fixture-invalid-key-000000' }), 502);
  assertSecretFree(rejected);
  const store = createStore(root);
  assert.equal(store.unseal(store.state.composio.sealedKey), projectKey);
  const disk = await readFile(join(root, 'workspace.json'), 'utf8');
  assert.ok(!disk.includes(projectKey));
  assert.equal((await json(await admin.put('/admin/composio', { enabled: false, apiKey: null }))).configured, false);
});

test('connect requires verified return into the initiating member session and lists only owned accounts', async (t) => {
  const { root, engine, admin, user, other, trace } = await setup(t, { env: { COMPOSIO_API_KEY: projectKey } });
  const state = await json(await admin.request('/admin/composio'));
  assert.deepEqual(state, { configured: true, enabled: false, ready: false, callbackUrl: `${publicSite}/api${callbackPath}`, keySource: 'environment' });
  assert.equal((await admin.put('/admin/composio', { enabled: true, apiKey: projectKey }, forwarded)).status, 400);
  assert.equal((await json(await admin.put('/admin/composio', { enabled: true }, forwarded))).ready, true);
  assert.deepEqual((await json(await user.request('/composio/apps'))).apps.map(({ slug }) => slug), ['gmail', 'slack']);
  assert.deepEqual((await json(await user.request('/composio/apps?q=slack'))).apps.map(({ slug }) => slug), ['slack']);
  assert.equal((await user.post('/composio/connect', { slug: 'api_key' }, forwarded)).status, 404);
  assert.equal((await user.post('/composio/connect', { slug: 'gmail' }, { ...forwarded, Origin: 'https://wrong.example' })).status, 403);
  const started = await begin(user, { alias: 'Work', from: 'chat', user_id: 'forged-identity', callback_url: 'https://wrong.example' });
  const parallel = engine.agent();
  assert.equal((await parallel.signin('member@example.test', memberPassword, forwarded)).status, 200);
  await finish(engine.agent(), started.callback, 'signin');
  await finish(other, started.callback, 'restart');
  await finish(parallel, started.callback, 'restart');
  assert.equal((await user.request(started.callback, { ...signed(), method: 'HEAD' })).status, 405);
  await finish(user, `${callbackPath}?status=success&connected_account_id=${started.id}`, 'verifier', 'chat');
  assert.equal(authCalls(await trace()).length, 0);
  assert.deepEqual((await json(await user.request('/composio/connections'))).connections, []);
  await finish(user, started.callback, 'connected', 'chat');
  await finish(user, started.callback, 'restart');
  const owned = await json(await user.request('/composio/connections'));
  assert.deepEqual(owned.connections.map(({ id, alias, status }) => ({ id, alias, status })), [{ id: started.id, alias: 'Work', status: 'ACTIVE' }]);
  assertSecretFree(owned);
  assert.deepEqual((await json(await other.request('/composio/connections'))).connections, []);
  assert.equal((await other.request(`/composio/connections/${started.id}`, { method: 'DELETE' })).status, 404);
  const logs = await trace();
  assert.equal(authCalls(logs).length, 1);
  const { user_id: userId } = authCalls(logs)[0].body;
  assert.match(userId, /^curiousity_[0-9a-f-]+_[0-9a-f-]+$/);
  assert.ok(logs.some(({ query }) => query?.user_ids === userId && query?.connected_account_ids === started.id));
  assert.ok(logs.filter((row) => row.hostname === 'backend.composio.dev').every((row) => row.keyOk && row.redirect === 'error'));
  const saved = createStore(root).state;
  assert.equal(saved.composio.sealedKey, '');
  assert.deepEqual(saved.users.find(({ email }) => email === 'member@example.test').workspace.composioConnections.map(({ id }) => id), [started.id]);
  assertSecretFree(saved);
  assert.equal((await user.request(`/composio/connections/${started.id}`, { method: 'DELETE' })).status, 204);
  assert.deepEqual((await json(await user.request('/composio/connections'))).connections, []);
  assert.ok((await trace()).some(({ method, pathname, query }) => method === 'DELETE' && pathname.endsWith(`/connected_accounts/${started.id}`) && query.revoke_on_delete === 'true'));
});

test('Chat only runs exact, one-time reviewed tools on the selected private account', async (t) => {
  const { root, engine, admin, user, other, trace } = await setup(t);
  await json(await admin.put('/admin/composio', { enabled: true, apiKey: projectKey }, forwarded));
  const personal = await begin(user, { alias: 'Personal' });
  await finish(user, personal.callback, 'connected');
  const work = await begin(user, { alias: 'Work' });
  await finish(user, work.callback, 'connected');
  const profile = await json(await admin.post('/providers', {
    type: 'custom', name: 'Fixture model', baseUrl: 'https://app-models.example.test/v1', model: 'fixture-chat', apiKey: modelKey,
  }), 201);
  await json(await admin.put(`/admin/providers/${profile.id}/share`, { shared: true, includeFree: true }));
  const input = (content, edits = {}) => ({ providerId: profile.id, revision: profile.revision || profile.id, connectionId: work.id, messages: [{ role: 'user', content }], ...edits });
  assert.equal((await other.post('/chat/apps', input('Send mail'))).status, 404);
  assert.equal((await user.post('/chat/apps', input('unsafe', { revision: 'stale' }))).status, 409);
  assert.equal((await user.post('/chat/apps', input('invalid tool'))).status, 502);
  assert.equal((await user.post('/chat/apps', input('invalid arguments'))).status, 502);
  const { review } = await json(await user.post('/chat/apps', input(`Send the approved text; do not expose ${projectKey}.`)));
  assert.equal(review.tool, emailTool);
  assert.match(review.account, /^Work · /);
  assert.equal(review.arguments.recipient_email, 'recipient@example.test');
  assert.equal(executions(await trace()).length, 0);
  assertSecretFree(review);
  const path = `/chat/apps/actions/${review.id}`;
  const parallel = engine.agent();
  assert.equal((await parallel.signin('member@example.test', memberPassword, forwarded)).status, 200);
  assert.equal((await other.post(path, { approved: true })).status, 404);
  assert.equal((await parallel.post(path, { approved: true })).status, 404);
  assert.equal((await user.post(path, { approved: true, arguments: { to: 'wrong@example.test' } })).status, 400);
  assert.equal((await user.post(path, { approved: false })).status, 400);
  const sent = await json(await user.post(path, { approved: true }));
  assert.match(sent.reply, /Action completed in Gmail/);
  assert.match(sent.appResult, /\[redacted\]/);
  assertSecretFree(sent);
  assert.equal((await user.post(path, { approved: true })).status, 404);
  const logs = await trace(), [executed] = executions(logs);
  assert.equal(executions(logs).length, 1);
  assert.deepEqual(executed.body.arguments, review.arguments);
  assert.equal(executed.body.account, work.id);
  const pinned = logs.find(({ body }) => body?.tools?.gmail?.enable?.includes(emailTool));
  assert.deepEqual(pinned.body.connected_accounts, { gmail: [work.id] });
  assertSecretFree(logs.filter(({ hostname }) => hostname === 'app-models.example.test'));
  assertSecretFree(logs.filter(({ pathname }) => pathname.endsWith('/search')));
  assert.doesNotMatch(await readFile(join(root, 'workspace.json'), 'utf8'), /This is the exact approved text\.|Reviewed draft|Send the approved text/);
  // Three logical shared turns (two invalid plans and one approved action).
  // Confirmation and the result summary do not charge a second message.
  assert.equal((await user.post('/chat', input('Ordinary chat also uses the allowance'))).status, 429);
});

test('approval can be cancelled or invalidated, and a failed summary never retries an external action', async (t) => {
  const { admin, user, trace } = await setup(t, { env: { COMPOSIO_API_KEY: projectKey } });
  await json(await admin.put('/admin/composio', { enabled: true }, forwarded));
  const started = await begin(user);
  await finish(user, started.callback, 'connected');
  const profile = await json(await user.post('/providers', { type: 'custom', apiKey: modelKey, baseUrl: 'https://app-models.example.test/v1', model: 'fixture-chat' }), 201);
  const request = async (content) => json(await user.post('/chat/apps', { providerId: profile.id, revision: profile.revision || profile.id, connectionId: started.id, messages: [{ role: 'user', content }] }));
  const ordinary = await json(await user.post('/chat', { providerId: profile.id, messages: [{ role: 'user', content: 'normal conversation' }] }));
  assert.match(ordinary.reply, /Ordinary chat did not see any apps/);
  assert.equal((await request('clarify')).reply, 'Which address should I use?');
  let review = (await request('Cancel this reviewed draft')).review;
  let path = `/chat/apps/actions/${review.id}`;
  assert.equal((await user.request(path, { method: 'DELETE' })).status, 204);
  assert.equal((await user.post(path, { approved: true })).status, 404);
  review = (await request('Planned before admin paused')).review;
  await json(await admin.put('/admin/composio', { enabled: false }, forwarded));
  assert.equal((await user.post(`/chat/apps/actions/${review.id}`, { approved: true })).status, 404);
  assert.equal(executions(await trace()).length, 0);
  await json(await admin.put('/admin/composio', { enabled: true }, forwarded));
  review = (await request('Send: summary failure')).review;
  path = `/chat/apps/actions/${review.id}`;
  const sent = await json(await user.post(path, { approved: true }));
  assert.match(sent.reply, /See the app result below/);
  assert.equal(executions(await trace()).length, 1);
  review = (await request('Disconnecting before approval')).review;
  await user.request(`/composio/connections/${started.id}`, { method: 'DELETE' });
  assert.equal((await user.post(`/chat/apps/actions/${review.id}`, { approved: true })).status, 404);
  assert.equal(executions(await trace()).length, 1);
});
