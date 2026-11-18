import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiResponseError, isMissingApi } from '../src/api-errors.mjs';
import { startEngine } from './helpers/http.mjs';

test('the public session check shows the running API features without opening protected routes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'curiousity-api-routes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const engine = await startEngine(t, { env: { DATA_DIR: root } });
  const member = engine.agent();
  const session = await member.request('/auth/session');
  assert.equal(session.headers.get('cache-control'), 'no-store');
  const body = await session.json();
  assert.equal(body.user, null);
  assert.equal(body.passwordTransport, 'local');
  assert.deepEqual(body.apiFeatures, { deviceCaptions: true, personalChat: true, chatDiscovery: true, liveReplay: true });
  assert.equal((await member.request('/captions')).status, 401);
  assert.equal((await member.post('/chat', {})).status, 401);
  assert.equal((await member.signup('api-probe@example.test')).status, 201);
  assert.deepEqual(await (await member.request('/captions')).json(), []);
  // A wrong method/path is not the same as a missing project or model.
  const absent = await member.request('/chat');
  assert.equal(absent.status, 404);
  const error = apiResponseError(absent.status, await absent.json());
  assert.equal(error.code, 'API_ROUTE_NOT_FOUND');
  assert.match(error.message, /restart Curiousity/);
});

test('old API and rewritten HTML errors provide routing guidance without masking ordinary errors', () => {
  const old = apiResponseError(404, { error: 'API route not found.' });
  assert.ok(isMissingApi(old));
  assert.equal(old.status, 404);
  assert.match(old.message, /\/api\/ paths unchanged/);
  for (const status of [200, 404, 405]) {
    const wrongPage = apiResponseError(status, null, { contentType: 'text/html; charset=utf-8' });
    assert.ok(isMissingApi(wrongPage));
    assert.equal(wrongPage.code, 'API_PROXY_RESPONSE');
    assert.match(wrongPage.message, /without rewriting the path/);
  }
  const other = apiResponseError(404, { error: 'This caption project could not be found.' });
  assert.equal(isMissingApi(other), false);
  assert.equal(other.message, 'This caption project could not be found.');
  const tooLarge = apiResponseError(413, null, { contentType: 'text/html', fallback: 'Proxy rejected the upload.' });
  assert.equal(tooLarge.message, 'Proxy rejected the upload.');
  assert.equal(isMissingApi(tooLarge), false);
});
