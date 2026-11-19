import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { membership, migrateMembership, oneMonthLater, reserveUsage, updateMembership } from '../server/plans.mjs';
import { createStore } from '../server/store.mjs';
import { toolsStatus } from '../server/tools.mjs';
import { plans, planPurchase } from '../shared/membership.mjs';
import { exampleAdmin, memberPassword, startEngine } from './helpers/http.mjs';

const adminEnv = { ADMIN_EMAIL: exampleAdmin.email, ADMIN_PASSWORD: exampleAdmin.password };
async function temp(t) {
  const root = await mkdtemp(join(tmpdir(), 'cf-membership-'));
  t.after(() => rm(root, { force: true, recursive: true, maxRetries: 3 }));
  return root;
}
async function json(res, status = 200) {
  const value = await res.json();
  assert.equal(res.status, status, JSON.stringify(value));
  return value;
}

// No network, clock changes, or in-process integration state needed to test
// expiration, migration, and independent UTC quota windows.
test('tiers, checkout links, legacy migration, renewal and UTC limits are consistent', () => {
  assert.deepEqual(Object.values(plans).map((tier) => Object.values(tier.limits)), [[1, 1, 3, 1], [20, 3, 5, 3], [null, 5, 10, 5], [null, null, 30, 10]]);
  assert.deepEqual(Object.values(plans).map((tier) => tier.price), [0, 3000, 5000, null]);
  assert.equal(planPurchase('free'), null);
  for (const [id, { label }] of Object.entries(plans).filter(([id]) => id !== 'free')) {
    const url = new URL(planPurchase(id));
    assert.equal(url.origin + url.pathname, 'https://wa.me/923174541414');
    assert.match(url.searchParams.get('text'), new RegExp(`${label} monthly plan`));
  }
  const now = Date.parse('2028-01-31T14:30:00Z');
  assert.equal(new Date(oneMonthLater(now)).toISOString(), '2028-02-29T14:30:00.000Z');
  const old = { role: 'member', theme: 'mint', premium: true, premiumMeter: { day: '2028-01-31', jobs: 2 } };
  assert.equal(migrateMembership(old, now), true);
  assert.equal(migrateMembership(old, now + 200), false);
  assert.equal(old.theme, undefined);
  assert.equal(old.premium, undefined);
  assert.equal(membership(old, now).id, 'premium');
  assert.equal(membership(old, now).used.aiProjects, 2);
  assert.equal(membership(old, oneMonthLater(now)).id, 'free');

  const member = { role: 'member', plan: 'free' };
  reserveUsage(member, { project: true, message: true, checkOnly: true }, now);
  assert.equal(member.planUsage, undefined);
  reserveUsage(member, { project: true, aiProject: true }, now);
  for (let i = 0; i < 3; i++) reserveUsage(member, { message: true }, now);
  assert.throws(() => reserveUsage(member, { message: true }, now), { status: 429 });
  assert.throws(() => reserveUsage(member, { project: true, aiProject: true }, now), { status: 429 });
  assert.deepEqual(membership(member, now).used, { projects: 1, messages: 3, aiProjects: 1 });
  assert.deepEqual(membership(member, now + 24 * 3600_000).used, { projects: 0, messages: 0, aiProjects: 0 });
  const jan30 = now - 24 * 3600_000, previousDay = { role: 'member', plan: 'free' };
  reserveUsage(previousDay, { project: true, message: true }, jan30);
  assert.deepEqual(membership(previousDay, now).used, { projects: 1, messages: 0, aiProjects: 0 });
  const upgraded = updateMembership(member, { plan: 'basic', overrides: { projects: 25, messages: 7, tiktokAccounts: 4 } }, now);
  assert.equal(upgraded.used.projects, 1);
  assert.deepEqual(upgraded.limits, { projects: 25, aiProjects: 3, messages: 7, tiktokAccounts: 4 });
  assert.equal(updateMembership(member, { plan: 'basic' }, now + 1000).expiresAt, upgraded.expiresAt);
  assert.equal(updateMembership(member, { plan: 'basic', renew: true }, now + 1000).expiresAt, '2028-03-29T14:30:00.000Z');
  assert.equal(updateMembership(member, { plan: 'free' }, now + 1000).expiresAt, null);
  assert.throws(() => updateMembership(member, { plan: 'elite', overrides: { messages: '30' } }), { status: 400 });
  assert.throws(() => updateMembership(member, { plan: 'admin' }), { status: 400 });
  assert.equal(membership({ role: 'admin' }).limits.tiktokAccounts, null);
});

test('free shared messages are metered, own keys exempt, project routes share the same cap, and deletion does not refund slots', { timeout: 25_000 }, async (t) => {
  if (!(await toolsStatus()).ffmpeg) return t.skip('FFmpeg not installed');
  const root = await temp(t), trace = join(root, 'models.jsonl');
  const state = join(root, 'replay.json');
  await writeFile(state, JSON.stringify({ WaitReplayE: 'private' }));
  const store = createStore(root), id = randomUUID(), when = new Date().toISOString();
  const source = join(root, 'projects', id, 'clip-1');
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'video.mp4'), 'synthetic video');
  store.state.jobs.unshift({ id, title: 'Sample shared clip', status: 'ready', sharedAt: when, createdAt: when, updatedAt: when, options: { captions: false },
    clips: [{ id: 'clip-1', title: 'Sample', duration: 10, start: 0, end: 10 }] });
  store.save();
  const engine = await startEngine(t, { imports: ['test/fixtures/providers-network.mjs'], env: { DATA_DIR: root, ...adminEnv, FIXTURE_PROVIDER_TRACE: trace,
    FIXTURE_REPLAY_STATE: state, YTDLP_BIN: resolve('test/fixtures/ytdlp.mjs') } });
  const admin = engine.agent(), member = engine.agent(), other = engine.agent();
  await json(await admin.signin());
  const { user } = await json(await member.signup('free-member@example.test'), 201);
  const { user: alternate } = await json(await other.signup('free-other@example.test'), 201);
  const provider = (client, name) => client.post('/providers', { type: 'custom', name, baseUrl: 'https://models.example.test/v1', model: 'fixture-chat', apiKey: `fixture-secret-${name}` }).then((res) => json(res, 201));
  const shared = await provider(admin, 'Admin'), own = await provider(member, 'Member');
  const workspace = () => member.request('/workspace').then((res) => json(res));
  const route = `/admin/accounts/${user.id}/plan`;
  await json(await admin.put(`/admin/providers/${shared.id}/share`, { shared: true, includeFree: true }));
  assert.doesNotMatch(JSON.stringify((await workspace()).sharedProviders), /fixture-secret|models\.example/);
  assert.equal((await member.put(route, { plan: 'elite' })).status, 403);
  const say = (providerId) => member.post('/chat', { providerId, messages: [{ role: 'user', content: 'A fixture question' }] });
  for (let i = 0; i < 3; i++) await json(await say(shared.id));
  assert.equal((await say(shared.id)).status, 429);
  await json(await say(own.id));
  assert.equal((await workspace()).user.plan.used.messages, 3);

  const example = { url: 'https://youtu.be/WaitReplayE', count: 1 };
  const accepted = await json(await member.post('/projects', { ...example, aiProfile: shared.id }), 202);
  // A project with a shared model uses both quotas, even if the source fails.
  assert.deepEqual((await workspace()).user.plan.used, { projects: 1, messages: 3, aiProjects: 1 });
  const save = `/library/${id}/clips/clip-1/save`;
  assert.equal((await member.post(save)).status, 429);
  await json(await member.put('/settings/captions', { providerId: own.id, model: 'fixture-speech' }));
  assert.equal((await member.request('/captions/upload?name=any.mp4', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: 'video bytes' })).status, 429);
  let failed;
  for (let i = 0; i < 40; i++) {
    failed = await json(await member.request(`/projects/${accepted.id}`));
    if (failed.status === 'failed') break;
    await delay(50);
  }
  assert.equal(failed.status, 'failed');
  assert.equal((await member.request(`/projects/${accepted.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await member.post('/projects', { ...example, aiProfile: own.id })).status, 429);

  await json(await admin.put(route, { plan: 'free', overrides: { projects: 3 } }));
  assert.equal((await member.post('/projects', { ...example, aiProfile: shared.id })).status, 429);
  await json(await member.post('/projects', { ...example, aiProfile: own.id }), 202);
  await json(await member.post(save));
  assert.deepEqual((await workspace()).user.plan.used, { projects: 3, messages: 3, aiProjects: 1 });
  await json(await admin.put(route, { plan: 'basic' }));
  await json(await say(shared.id));
  assert.equal((await workspace()).user.plan.used.messages, 4);
  const first = await json(await other.post(save));
  assert.equal((await json(await other.post(save))).id, first.id, 'saving the same clip is idempotent');
  assert.equal((await other.post('/projects', { ...example, aiProfile: 'local' })).status, 429);
  assert.equal((await json(await admin.put(`/admin/accounts/${alternate.id}/plan`, { plan: 'free' }))).plan.used.projects, 1);
  assert.ok((await readFile(trace, 'utf8')).includes('fixture-secret-Admin'));
  await engine.stop();
});

test('administrator sign-in edits revoke all member sessions without changing account ownership', async (t) => {
  const root = await temp(t);
  const engine = await startEngine(t, { env: { DATA_DIR: root, ...adminEnv } });
  const admin = engine.agent(), member = engine.agent(), device = engine.agent();
  const email = 'old-member@example.test', next = 'changed-member@example.test';
  const { user: adminUser } = await json(await admin.signin());
  const { user } = await json(await member.signup(email, memberPassword, { 'X-Forwarded-For': '198.51.100.42' }), 201);
  const { users } = await json(await admin.request('/admin/accounts?q=old-member'));
  assert.equal(users[0].lastSignIn.ip, '127.0.0.1');
  await json(await device.signin(email, memberPassword));
  assert.equal(user.lastSignIn, undefined);
  assert.equal((await json(await member.request('/auth/session'))).user.lastSignIn, undefined);
  assert.equal((await member.request('/admin/accounts')).status, 403);
  const route = `/admin/accounts/${user.id}/credentials`, adminPassword = exampleAdmin.password;
  const profile = await json(await member.post('/providers', { type: 'openai', name: 'Private model', model: 'fixture', apiKey: 'member-test-only-key' }), 201);
  assert.equal((await member.put(route, { email: next, adminPassword })).status, 403);
  assert.equal((await admin.put(`/admin/accounts/${adminUser.id}/credentials`, { email: next, adminPassword })).status, 403);
  assert.equal((await admin.put(route, { email: next, adminPassword: 'not the passphrase' })).status, 403);
  assert.equal((await admin.put(route, { email: adminUser.email, adminPassword })).status, 409);
  const temporaryPassword = 'temporary-fixture-passphrase';
  const updated = await json(await admin.put(route, { email: next, adminPassword, temporaryPassword, confirmPassword: temporaryPassword }));
  assert.deepEqual([updated.id, updated.email, updated.mustChangePassword], [user.id, next, true]);
  assert.equal((await member.request('/workspace')).status, 401);
  assert.equal((await device.request('/workspace')).status, 401);
  assert.equal((await member.signin(email, temporaryPassword)).status, 401);
  assert.equal((await member.signin(next, memberPassword)).status, 401);
  assert.equal((await json(await member.signin(next, temporaryPassword))).user.mustChangePassword, true);
  assert.equal((await member.request('/workspace')).status, 403);
  const newPassword = 'new-personal-test-passphrase';
  assert.equal((await member.put('/account/password', { currentPassword: temporaryPassword, newPassword, confirmPassword: newPassword })).status, 204);
  assert.equal((await member.signin(next, temporaryPassword)).status, 401);
  assert.equal((await json(await member.signin(next, newPassword))).user.id, user.id);
  assert.equal((await json(await member.request('/workspace'))).providers[0].id, profile.id);
  assert.doesNotMatch(await readFile(join(root, 'workspace.json'), 'utf8'), /198\.51\.100\.42|temporary-fixture-passphrase|member-test-only-key|new-personal-test-passphrase/);
});
