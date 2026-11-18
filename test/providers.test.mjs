import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore } from '../server/store.mjs';
import { listModels, providerInput, publicProvider, rankWithProvider, transcribeRemote } from '../server/providers.mjs';
import { providerCatalog } from '../shared/providers.mjs';

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


test('remote transcription keeps detected caption language and per-chunk timestamps', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'cf-language-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const store = createStore(folder);
  const audio = join(folder, 'audio.mp3');
  await writeFile(audio, Buffer.alloc(32));
  const profile = providerInput({ type: 'openai', name: 'Audio', apiKey: 'mock-key' }, null, store);
  t.mock.method(globalThis, 'fetch', async (url, { body, headers }) => {
    assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(headers.Authorization, 'Bearer mock-key');
    assert.equal(body.get('response_format'), 'verbose_json');
    assert.equal(body.get('timestamp_granularities[]'), 'segment');
    assert.equal(body.get('file').size, 32);
    return Response.json({ language: 'Urdu', segments: [{ start: 1, end: 2, text: 'یہ درست ہے۔' }] });
  });
  assert.deepEqual(await transcribeRemote(profile, store, 'whisper-1', [audio, audio], 600, new AbortController().signal), {
    language: 'ur', cues: [{ start: 1, end: 2, text: 'یہ درست ہے۔' }, { start: 601, end: 602, text: 'یہ درست ہے۔' }],
  });
});

test('hosted presets pin their endpoint and saved keys do not follow editable URLs or types', () => {
  const store = { seal: (value) => `sealed-${value}` };
  const key = 'test-catalog-key';
  for (const [type, definition] of Object.entries(providerCatalog)) {
    if (definition.editableUrl) continue;
    const profile = providerInput({ type, name: definition.name, apiKey: key, baseUrl: 'https://other.example/v1' }, null, store);
    assert.equal(profile.baseUrl, definition.baseUrl);
    assert.equal(profile.apiKey, `sealed-${key}`);
    assert.throws(() => providerInput({ type, name: definition.name }, null, store), { status: 400 });
  }
  const local = providerInput({ type: 'lmstudio', name: 'On this host', model: 'model' }, null, store);
  assert.equal(local.baseUrl, 'http://127.0.0.1:1234/v1');
  const custom = providerInput({ type: 'custom', name: 'Custom chat', baseUrl: 'https://chat.example/v1/', apiKey: key }, null, store);
  assert.equal(providerInput({ ...custom, apiKey: '' }, custom, store).apiKey, `sealed-${key}`);
  assert.equal(providerInput({ ...custom, apiKey: '', baseUrl: 'https://other.example/v1' }, custom, store).apiKey, '');
  assert.throws(() => providerInput({ ...custom, apiKey: '', type: 'deepseek' }, custom, store), { status: 400 });
  assert.throws(() => providerInput({ type: 'custom', name: 'Custom', apiKey: key, baseUrl: 'http://chat.example' }, null, store), { status: 400 });
});
