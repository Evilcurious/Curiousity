import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore } from '../server/store.mjs';
import { listModels, providerInput, publicProvider, rankWithProvider, transcribeRemote, translateWithProvider } from '../server/providers.mjs';
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


test('retries a cut-off visual ranking once with the same evidence and validates wrapped results', async (t) => {
  const profile = { type: 'custom', name: 'Vision', baseUrl: 'https://models.example', model: 'vision', apiKey: 'fixture-ranked-key' };
  const candidates = [{ id: 'm1', start: 4, end: 24, excerpt: 'Video evidence, not just words.', score: 65 }];
  const visual = { source: { duration: 32 }, images: [{ id: 'm1', label: 'm1, 5.20s in the video', data: 'cGljdHVyZQ==' }] };
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (_url, { body }) => {
    bodies.push(JSON.parse(body));
    if (bodies.length === 1) return Response.json({ choices: [{ finish_reason: 'length', message: { content: '{"rankings":[{"id":"m1"' } }] });
    const wrapped = JSON.stringify({ rankings: [{ id: 'made-up', score: 100 }, { id: 'm1', score: '94', start: 999, end: 2000, title: 'Source highlight' }] });
    const answer = ['<think>Consider these [untrusted thoughts].</think>', 'Here is the ranking:', '```json', wrapped, '```'].join('\n');
    return Response.json({ choices: [{ message: { content: answer } }] });
  });
  const result = await rankWithProvider(profile, { unseal: (key) => key }, candidates, undefined, null, visual);
  assert.deepEqual([...result], [['m1', { score: 94, title: 'Source highlight', reason: '' }]]);
  assert.equal(bodies.length, 2);
  const [original, retry] = bodies;
  assert.deepEqual(original.messages[1], retry.messages[1], 'never switch to text-only ranking on repair');
  assert.match(retry.messages[0].content, /only id and score/);
  assert.match(retry.messages[1].content[2].image_url.url, /^data:image\/jpeg;base64,/);
});

test('shows actionable provider errors without retrying rejected requests or exposing upstream text', async (t) => {
  const profile = { type: 'custom', name: 'Vision', baseUrl: 'https://models.example', model: 'vision', apiKey: 'fixture-ranked-key' };
  const store = { unseal: (key) => key };
  const candidate = { id: 'm1', start: 0, end: 20, excerpt: 'Caption example.', score: 65 };
  let upstream;
  const mock = t.mock.method(globalThis, 'fetch', async () => upstream());
  for (const [status, hint] of [[401, /HTTP 401.*saved API key/], [400, /HTTP 400.*input/], [429, /HTTP 429.*quota/]]) {
    upstream = () => Response.json({ error: 'This body contains a private message.' }, { status });
    const before = mock.mock.callCount();
    await assert.rejects(rankWithProvider(profile, store, [candidate]), (err) => err.providerStatus === status && hint.test(err.message) && !err.message.includes('private message'));
    assert.equal(mock.mock.callCount(), before + 1);
  }
  upstream = () => Response.json({ choices: [{ finish_reason: 'content_filter', message: { content: '[{"id":"m1","score":94}]' } }] });
  await assert.rejects(rankWithProvider(profile, store, [candidate]), /provider declined/);
  assert.equal(mock.mock.callCount(), 4);
  await assert.rejects(rankWithProvider(profile, store, [candidate], AbortSignal.abort(new Error('Cancelled'))), /Cancelled/);
  assert.equal(mock.mock.callCount(), 4, 'an already cancelled job does not send a provider request');
});

test('a cut-off translation uses smaller bounded requests and preserves every timestamp', async (t) => {
  const profile = { type: 'gemini', name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'translation-fixture' };
  const original = [Array.from({ length: 16 }, (_, i) => ({ start: i, end: i + .7, text: `Ejemplo ${i}.` }))];
  const batches = [];
  t.mock.method(globalThis, 'fetch', async (_url, { body }) => {
    const { contents, generationConfig } = JSON.parse(body);
    assert.equal(generationConfig.responseMimeType, 'application/json');
    const cues = JSON.parse(contents[0].parts[0].text);
    batches.push(cues.map(({ id }) => id));
    if (cues.length === 16) return Response.json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"translations":[' }] } }] });
    const answer = JSON.stringify({ translations: cues.reverse().map(({ id }) => ({ id, text: `Example ${id.split(':')[1]}.` })) });
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Internal thoughts [not a result]', thought: true }, { text: answer }] } }] });
  });
  const result = await translateWithProvider(profile, { unseal: () => '' }, 'en', original);
  assert.deepEqual(result, [original[0].map((cue, i) => ({ ...cue, text: `Example ${i}.` }))]);
  assert.deepEqual(batches.map((batch) => batch.length), [16, 8, 8]);
  assert.deepEqual(batches.slice(1).flat(), batches[0]);
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
