import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore } from '../server/store.mjs';
import { listModels, providerInput, publicProvider, rankWithProvider } from '../server/providers.mjs';

test('encrypts provider keys at rest and never exposes them in profiles', async (t) => {
  const path = await mkdtemp(join(tmpdir(), 'cf-keys-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const store = createStore(path);
  const profile = providerInput({ type: 'openai', name: 'First account', apiKey: 'secret-value-test', model: 'model' }, null, store);
  assert.equal(publicProvider(profile).hasKey, true);
  assert.equal(publicProvider(profile).apiKey, undefined);
  store.state.providers.push(profile);
  store.save();
  const cache = await readFile(join(path, 'workspace.json'), 'utf8');
  assert.ok(!cache.includes('secret-value-test'));
  assert.equal(createStore(path).unseal(profile.apiKey), 'secret-value-test');
  assert.throws(() => providerInput({ type: 'custom', name: 'Bad', baseUrl: 'file:///etc/hosts' }, null, store), { status: 400 });
});

test('lists compatible models and constrains remote ranking to real moment IDs', async (t) => {
  const path = await mkdtemp(join(tmpdir(), 'cf-models-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const store = createStore(path);
  const profile = providerInput({ type: 'openai', name: 'Test', model: 'chat-model', apiKey: 'mock-key' }, null, store);
  const mock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer mock-key');
    assert.equal(options.redirect, 'error');
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'chat-model' }, { id: 'chat-model' }] });
    assert.match(url, /chat\/completions$/);
    assert.equal(JSON.parse(options.body).model, 'chat-model');
    return Response.json({ choices: [{ message: { content: '```json\n[{"id":"m1","score":140,"title":"A good hook","reason":"Works alone."},{"id":"imagined","score":100}]\n```' } }] });
  });
  assert.deepEqual(await listModels(profile, store), ['chat-model']);
  const score = await rankWithProvider(profile, store, [{ id: 'm1', start: 4, end: 24, excerpt: 'Here is the highlight.', score: 65 }]);
  assert.deepEqual([...score], [['m1', { score: 100, title: 'A good hook', reason: 'Works alone.' }]]);
  assert.equal(mock.mock.callCount(), 2);
});
