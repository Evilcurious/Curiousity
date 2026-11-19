import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createStore } from '../server/store.mjs';
import { chatWithProvider, providerInput } from '../server/providers.mjs';
import { chatContext, chatLimits } from '../shared/chat.mjs';
import { memberPassword, startEngine } from './helpers/http.mjs';

async function json(response, status = 200) {
  const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value));
  return value;
}
async function eventually(read, testValue) {
  for (let i = 0; i < 80; i++) {
    const next = await read();
    if (testValue(next)) return next;
    await delay(25);
  }
  assert.fail('Timed out waiting for fixture');
}

test('members configure and discover personal models and MCP, and chat cannot touch other accounts or MCP', { timeout: 18_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'curiousity-personal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const trace = join(root, 'provider.jsonl'), mcpTrace = join(root, 'mcp.jsonl');
  await Promise.all([writeFile(trace, ''), writeFile(mcpTrace, '')]);
  const env = { DATA_DIR: root, FIXTURE_PROVIDER_TRACE: trace, FIXTURE_MCP_TRACE: mcpTrace, ENABLE_LEGACY_INTEGRATION_API: 'true' };
  const imports = ['test/fixtures/providers-network.mjs', 'test/fixtures/mcp-network.mjs'];
  const original = await startEngine(t, { env });
  await json(await original.agent().signup('member@example.test'), 201);
  await original.stop();
  // Simulate a previously registered account that predates MCP settings.
  const old = createStore(root);
  delete old.state.users[0].workspace.mcps;
  old.save();
  const engine = await startEngine(t, { env, imports });
  const member = engine.agent(), other = engine.agent(), anon = engine.agent();
  await json(await other.signup('other@example.test'), 201);
  const session = await json(await member.signin('member@example.test', memberPassword));
  assert.equal(session.user.role, 'member');
  assert.equal(session.user.premium, false);
  assert.deepEqual((await json(await member.request('/workspace'))).mcps, []);
  const first = { type: 'custom', baseUrl: 'https://models.example.test:8443/v1/chat/completions/', apiKey: 'Bearer fixture-chat-secret', model: 'fixture-chat' };
  assert.deepEqual(await json(await member.post('/providers/catalog', first)), { models: ['fixture-chat', 'fixture-speech'] });
  const profile = await json(await member.post('/providers', first), 201);
  assert.equal(profile.baseUrl, 'https://models.example.test:8443/v1');
  assert.equal(profile.apiKey, undefined);
  assert.equal(profile.hasKey, true);
  assert.equal((await member.post('/providers', { ...first, baseUrl: 'https://[::1]:8443/v1' })).status, 400);
  assert.equal((await member.post('/providers', { ...first, baseUrl: 'http://models.example.test:8443/v1' })).status, 400);
  assert.deepEqual(await json(await member.request(`/providers/${profile.id}/models`)), { models: ['fixture-chat', 'fixture-speech'] });
  assert.equal((await other.request(`/providers/${profile.id}/models`)).status, 404);
  await json(await member.put('/settings/ranking', { providerId: profile.id }));
  const connection = await json(await member.post('/mcp', { kind: 'remote', url: 'https://mcp.example.test:8443/mcp', token: 'Bearer fixture-mcp-secret' }), 201);
  assert.equal(connection.name, 'mcp.example.test:8443');
  assert.equal(connection.secret, undefined);
  assert.equal((await member.post('/mcp', { kind: 'remote', url: 'https://127.0.0.1:8443/mcp' })).status, 400);
  const mcp = await json(await member.post(`/mcp/${connection.id}/inspect`));
  assert.deepEqual(mcp.tools.map((tool) => tool.name), ['hello']);
  assert.equal((await other.post(`/mcp/${connection.id}/inspect`)).status, 404);
  assert.equal((await member.post(`/mcp/${connection.id}/run`, { name: 'hello', arguments: { name: 'member' } })).status, 400);
  assert.match((await json(await member.post(`/mcp/${connection.id}/run`, { name: 'hello', arguments: { name: 'member' }, approved: true }))).output, /^Hello member; Bearer \[redacted\]$/);

  const send = (messages, additions = {}) => ({ providerId: profile.id, revision: profile.id, messages, ...additions });
  const prompt = { role: 'user', content: 'Hello, model.' };
  assert.equal((await anon.post('/chat', send([prompt]))).status, 401);
  assert.equal((await other.post('/chat', send([prompt]))).status, 404);
  for (const messages of [[], [{ role: 'system', content: 'fixture' }], [{ role: 'assistant', content: 'fixture' }], [{ role: 'user', content: ' ' }], [{ role: 'user', content: 'a'.repeat(chatLimits.user + 1) }], [prompt, prompt, prompt]]) {
    assert.equal((await member.post('/chat', send(messages))).status, 400);
  }
  const firstReply = await json(await member.post('/chat', send([prompt], { tools: [{ name: 'hello' }], apiKey: 'do not forward' })));
  assert.equal(firstReply.reply, 'Fixture reply 1: Hello, model.');
  const follow = await json(await member.post('/chat', send([prompt, { role: 'assistant', content: firstReply.reply }, { role: 'user', content: '  Continue please.  ' }])));
  assert.equal(follow.reply, 'Fixture reply 3: Continue please.');
  const echoed = await json(await member.post('/chat', send([{ ...prompt, content: 'Echo the fixture key' }])));
  assert.equal(echoed.reply, 'Key Bearer [redacted]');
  const records = async () => (await readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse);
  const sent = (await records()).filter((row) => row.body);
  assert.equal(sent.length, 3);
  for (const record of sent) {
    assert.equal(record.port, '8443');
    assert.equal(record.redirect, 'error');
    assert.equal(record.authorization, 'Bearer fixture-chat-secret');
    assert.deepEqual(Object.keys(record.body).sort(), ['max_tokens', 'messages', 'model']);
  }
  assert.equal(await readFile(mcpTrace, 'utf8'), '');
  const storeText = await readFile(join(root, 'workspace.json'), 'utf8');
  assert.doesNotMatch(storeText, /fixture-chat-secret|fixture-mcp-secret|Hello, model|Continue please/);
  const updated = await json(await member.put(`/providers/${profile.id}`, { ...profile, model: 'another', apiKey: '' }));
  assert.notEqual(updated.revision, profile.id);
  assert.equal((await member.post('/chat', send([prompt]))).status, 409);

  const ctrl = new AbortController();
  const pending = member.request('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
    body: JSON.stringify(send([{ ...prompt, content: 'Wait for disconnect' }], { revision: updated.revision })) });
  const aborted = assert.rejects(pending, { name: 'AbortError' });
  await eventually(records, (rows) => rows.some((row) => row.body?.messages[0].content === 'Wait for disconnect'));
  assert.equal((await member.post('/chat', send([prompt], { revision: updated.revision }))).status, 429);
  ctrl.abort();
  await aborted;
  await eventually(records, (rows) => rows.some((row) => row.aborted));
  await eventually(() => member.post('/chat', send([prompt], { revision: updated.revision })), (res) => res.ok);
});

test('native Gemini and Anthropic chat preserve turns and return only text replies', async (t) => {
  const messages = [{ role: 'user', content: 'First' }, { role: 'assistant', content: 'Reply' }, { role: 'user', content: 'Second' }];
  const store = { seal: (value) => value, unseal: (value) => value };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.includes('anthropic')) {
      assert.match(url, /\/messages$/);
      assert.deepEqual(body.messages, messages);
      assert.equal(options.headers['x-api-key'], 'anthropic-fixture');
      assert.equal(body.tools, undefined);
      return Response.json({ content: [{ type: 'text', text: 'Anthropic reply' }, { type: 'tool_use', text: 'Do not surface tool output' }] });
    }
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-fixture:generateContent');
    assert.deepEqual(body.contents, [{ role: 'user', parts: [{ text: 'First' }] }, { role: 'model', parts: [{ text: 'Reply' }] }, { role: 'user', parts: [{ text: 'Second' }] }]);
    assert.equal(options.headers['x-goog-api-key'], 'gemini-fixture-key');
    return Response.json({ candidates: [{ content: { parts: [{ thought: true, text: 'Hidden' }, { text: 'Gemini reply' }] } }] });
  });
  for (const [type, model, apiKey, reply] of [['anthropic', 'claude-fixture', 'anthropic-fixture', 'Anthropic reply'], ['gemini', 'models/gemini-fixture', 'gemini-fixture-key', 'Gemini reply']]) {
    const profile = providerInput({ type, model, apiKey }, null, store);
    assert.deepEqual(await chatWithProvider(profile, store, messages), { reply, truncated: false });
  }
});

test('chat clips context to recent complete turns and a UTF-8 byte budget', () => {
  const history = Array.from({ length: 100 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i) + 'é'.repeat(2000) }));
  const context = chatContext(history, 'Next');
  assert.equal(context.length, 9);
  assert.equal(context.at(0), history[92]);
  assert.equal(context.at(-2), history.at(-1));
  assert.deepEqual(context.at(-1), { role: 'user', content: 'Next' });
  assert.ok(context.reduce((bytes, row) => bytes + Buffer.byteLength(row.content), 0) <= chatLimits.contextBytes);
});
