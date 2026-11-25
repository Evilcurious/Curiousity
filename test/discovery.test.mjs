import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startEngine } from './helpers/http.mjs';

async function boot(t, env = {}) {
  const root = await mkdtemp(join(tmpdir(), 'curiousity-search-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tracePath = join(root, 'requests.log');
  const modelsPath = join(root, 'models.log');
  const app = await startEngine(t, { env: { DATA_DIR: root, FIXTURE_DISCOVERY_TRACE: tracePath, FIXTURE_PROVIDER_TRACE: modelsPath, DISCOVERY_ENABLED: 'true', EXA_API_KEY: '', YOUTUBE_DATA_API_KEY: '', ...env }, imports: ['test/fixtures/discovery-network.mjs', 'test/fixtures/providers-network.mjs'] });
  const trace = async (path = tracePath) => (await readFile(path, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return { ...app, trace, modelTrace: () => trace(modelsPath), root };
}

test('Reach searches signed-in requests across public index domains, returns direct links, and marks missing sources', async (t) => {
  const { agent, trace } = await boot(t);
  const member = agent();
  assert.equal((await member.post('/chat/reach', { query: '#podcastclips' })).status, 401);
  assert.equal((await member.signup('reach-member@example.test')).status, 201);
  const query = '#podcastclips limited test';
  assert.equal((await member.post('/chat/reach', { query }, { Origin: 'https://another.example.test' })).status, 403);
  for (const bad of [{ query: '   ' }, { query: 'x'.repeat(181) }, { query, days: -1 }, { query, source: 'https://other.example' }]) assert.equal((await member.post('/chat/reach', bad)).status, 400);
  assert.deepEqual(await trace(), []);
  const response = await member.post('/chat/reach', { query, days: 7, messages: [{ content: 'private context' }] });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json();
  assert.equal(result.verificationVersion, 1);
  assert.equal(result.aiReview.state, 'source_only');
  assert.deepEqual(result.coverage[0].excluded, { outsideWindow: 1 });
  assert.deepEqual(result.coverage[1].excluded, { undated: 1 });
  assert.ok(result.records.every((record) => record.published && record.availability === 'publicVideo'));
  assert.deepEqual(result.records.map((item) => [item.source, item.url, item.clippable]), [
    ['youtube', 'https://www.youtube.com/watch?v=TrendVideo1', true],
    ['tiktok', 'https://www.tiktok.com/@fixture/video/1234567890123', false],
  ]);
  assert.deepEqual(result.coverage.map(({ source, state, count }) => [source, state, count]), [['youtube', 'found', 1], ['tiktok', 'found', 1], ['instagram', 'limited', 0]]);
  assert.equal(result.records[0].views, undefined);
  assert.match(result.coverage[0].rank, /relevance/);
  assert.doesNotMatch(JSON.stringify(result), /internals|Too old/);
  const calls = await trace();
  assert.equal(calls.filter(({ method }) => method === 'initialize').length, 1);
  const searches = calls.filter(({ method }) => method === 'tools/call');
  assert.deepEqual(searches.map((x) => x.arguments.includeDomains[0]).sort(), ['instagram.com', 'tiktok.com', 'youtube.com']);
  assert.ok(searches.every((x) => x.tools === 'web_search_advanced_exa' && x.arguments.query.includes(query) && x.arguments.maxAgeHours === 0 && x.arguments.type === 'auto' && /^\d{4}-\d{2}-\d{2}$/.test(x.arguments.startPublishedDate)));
  assert.doesNotMatch(JSON.stringify(calls), /private context/);
  const empty = await (await member.post('/chat/reach', { query: 'empty test', source: 'instagram' })).json();
  assert.equal(empty.coverage[0].state, 'empty');
  assert.deepEqual(empty.records, []);
});

test('retired Finder requests never reach the discovery provider', async (t) => {
  const { agent, trace } = await boot(t);
  const member = agent();
  assert.equal((await member.signup('retired-finder@example.test')).status, 201);
  assert.equal((await member.post('/chat/finder', { query: 'Video editor' })).status, 410);
  for (const source of ['jobs', 'companies', 'maps']) assert.equal((await member.post('/chat/reach', { query: 'Studio', source })).status, 400);
  assert.deepEqual(await trace(), []);
});

test('Reach can rank recent public YouTube matches by view count and degrades to the index on quota errors', async (t) => {
  const { agent, trace } = await boot(t, { EXA_API_KEY: 'fixture-exa-key', YOUTUBE_DATA_API_KEY: 'fixture-youtube-key' });
  const member = agent();
  assert.equal((await member.signup('rank-member@example.test')).status, 201);
  const ranked = await (await member.post('/chat/reach', { query: '#videoediting', source: 'youtube', days: 30 })).json();
  assert.equal(ranked.coverage[0].method, 'YouTube Data API');
  assert.deepEqual(ranked.records.map((item) => item.views), [20000, 100]);
  assert.equal(ranked.records[0].live, true);
  assert.doesNotMatch(JSON.stringify(ranked), /fixture-youtube-key|Private fixture/);
  const fallback = await (await member.post('/chat/reach', { query: 'test fallback', source: 'youtube', days: 30 })).json();
  assert.equal(fallback.coverage[0].method, 'Exa · public page evidence');
  assert.deepEqual(ranked.coverage[0].excluded, { unavailable: 2, outsideWindow: 1 });
  assert.equal(fallback.records[0]?.availability, 'publicVideo');
  assert.match(fallback.coverage[0].note, /limit reached/);
  assert.equal(fallback.records[0].views, undefined);
  assert.doesNotMatch(JSON.stringify(fallback), /fixture-exa-key|provider internals/);
  const requests = await trace();
  assert.ok(requests.every(({ keyed }) => keyed));
  assert.equal(requests[0].params.order, 'viewCount');
  assert.equal(requests[0].params.q, '#videoediting');
  assert.match(requests[0].params.publishedAfter, /T.*Z$/);
  assert.equal(requests.at(-1).method, 'exa-api');
  assert.equal(requests.at(-1).arguments.contents.maxAgeHours, 0);
  const ignored = await (await member.post('/chat/reach', { query: 'ignored freshness fixture', source: 'youtube' })).json();
  assert.deepEqual(ignored.records, []);
  assert.ok(ignored.coverage[0].excluded.unconfirmed > 0);
  assert.equal(ignored.workbook, undefined);
  assert.doesNotMatch(JSON.stringify(ignored), /freshness not honored/);
});

test('a second search for one account is rejected and disconnect cancels the read-only tool', async (t) => {
  const { agent, trace } = await boot(t);
  const member = agent();
  assert.equal((await member.signup('cancel-search@example.test')).status, 201);
  const control = new AbortController();
  const pending = member.request('/chat/reach', { method: 'POST', body: JSON.stringify({ query: 'Wait for disconnect with cleanup pause', source: 'youtube' }), headers: { 'Content-Type': 'application/json' }, signal: control.signal });
  const stopped = assert.rejects(pending, { name: 'AbortError' });
  try {
    for (let i = 0; i < 100 && !(await trace()).some(({ method }) => method === 'tools/call'); i++) await delay(20);
    assert.equal((await member.post('/chat/reach', { query: 'Second search', source: 'youtube' })).status, 429);
  } finally { control.abort(); }
  await stopped;
  for (let i = 0; i < 100 && !(await trace()).some(({ aborted }) => aborted); i++) await delay(20);
  assert.ok((await trace()).some(({ aborted }) => aborted));
  for (let i = 0; i < 5; i++) assert.equal((await member.post('/chat/reach', { query: 'seed', source: 'youtube' })).status, 200);
  assert.equal((await member.post('/chat/reach', { query: 'Second search', source: 'youtube' })).status, 429);
});


test('Reach enforces presets and custom rolling-day windows on the server', async (t) => {
  const { agent, trace } = await boot(t);
  const member = agent();
  assert.equal((await member.signup('windows@example.test')).status, 201);
  const query = 'range fixture';
  for (const days of [0, 366, 1.5, '1', null]) assert.equal((await member.post('/chat/reach', { query, days })).status, 400);
  assert.deepEqual(await trace(), []);
  for (const [days, count] of [[1, 1], [2, 2], [19, 2]]) {
    const response = await member.post('/chat/reach', { query, source: 'youtube', days });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.days, days);
    assert.equal(Date.parse(result.searchedAt) - Date.parse(result.from), days * 86_400_000);
    assert.equal(result.records.length, count);
    assert.ok(result.records.every(({ published }) => published));
    assert.equal(result.coverage[0].excluded.outsideWindow, days === 1 ? 2 : 1);
  }
});

test('a personal model reviews every source-checked match without accepting closed matches or writing replacement records', async (t) => {
  const { agent, modelTrace } = await boot(t);
  const owner = agent(), other = agent();
  assert.equal((await owner.signup('ai-review@example.test')).status, 201);
  assert.equal((await other.signup('other-review@example.test')).status, 201);
  const profileResponse = await owner.post('/providers', { type: 'custom', name: 'Review model', baseUrl: 'https://models.example.test/v1', model: 'fixture-chat', apiKey: 'fixture-review-only' });
  assert.equal(profileResponse.status, 201);
  const profile = await profileResponse.json();
  const setup = { reviewProfileId: profile.id, reviewRevision: profile.revision || profile.id };
  assert.equal((await other.post('/chat/reach', { ...setup, query: 'Video editor' })).status, 404);
  assert.equal((await owner.post('/chat/reach', { ...setup, reviewRevision: 'stale', query: 'Video editor' })).status, 409);
  assert.deepEqual(await modelTrace(), []);

  const reach = await (await owner.post('/chat/reach', { ...setup, query: 'AI veto training clips', privateChat: 'do not send conversation' })).json();
  assert.deepEqual(reach.aiReview, { state: 'complete', checked: 3 });
  assert.deepEqual(reach.records.map(({ source }) => source), ['youtube', 'tiktok']);
  assert.equal(reach.coverage[2].excluded.review, 1);
  const modelCalls = await modelTrace();
  assert.equal(modelCalls.length, 1);
  assert.equal(modelCalls[0].body.messages.length, 2);
  assert.doesNotMatch(JSON.stringify(modelCalls[0].body), /do not send conversation|Unavailable Reel|Undated TikTok|fixture-review-only/);
  assert.doesNotMatch(JSON.stringify(reach), /fixture-review-only/);

  const invalid = await (await owner.post('/chat/reach', { ...setup, query: 'AI invalid review' })).json();
  assert.deepEqual(invalid.aiReview, { state: 'failed', checked: 0 });
  assert.deepEqual(invalid.records, []);
  assert.equal(invalid.coverage[0].excluded.review, 1);
  assert.equal(invalid.workbook, undefined);
  assert.doesNotMatch(JSON.stringify(invalid), /made-up-id/);

  const rejected = await (await owner.post('/chat/reach', { ...setup, query: 'AI veto all clips' })).json();
  assert.deepEqual(rejected.aiReview, { state: 'complete', checked: 3 });
  assert.deepEqual(rejected.records, []);
  assert.ok(rejected.coverage.every(({ state, excluded }) => state === 'empty' && excluded.review === 1));
  assert.equal(rejected.workbook, undefined);
});
