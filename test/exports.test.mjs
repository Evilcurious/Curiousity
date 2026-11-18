import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportFrame, frameFor, platforms } from '../shared/exports.mjs';
import { jobOptions } from '../server/validation.mjs';
import { localizeClips, suggestHashtags } from '../server/localization.mjs';
import { makeAss } from '../server/moments.mjs';

const signal = new AbortController().signal;
const original = [[{ start: 0.04, end: 1.5, text: 'This is the opening.' }, { start: 1.5, end: 3.3, text: 'Wait for the reveal.' }], []];

test('platform presets are independent from publishing and custom frames use even, canonical dimensions', () => {
  for (const [platform, { ratio }] of Object.entries(platforms)) {
    const options = jobOptions({ demo: true, count: 1, platform });
    assert.equal(options.aspectRatio, ratio);
    assert.equal(options.tiktok, false);
    assert.equal(exportFrame(options).width, ratio === '16:9' ? 1280 : 720);
  }
  assert.deepEqual(frameFor('08 × 10'), { ratio: '4:5', width: 1024, height: 1280 });
  assert.deepEqual(exportFrame(jobOptions({ demo: true, count: 4, platform: 'tiktok', aspectRatio: '7:3' })), { ratio: '7:3', width: 1280, height: 548 });
  assert.match(makeAss(original[0], frameFor('16:9')), /PlayResX: 1280\nPlayResY: 720/);
  for (const fields of [{ platform: 'unsupported' }, { aspectRatio: '0:1' }, { aspectRatio: '20:1' }, { aspectRatio: '1.5:2' }, { captionLanguage: 'off' }, { hashtagLanguage: 'invented' }]) {
    assert.throws(() => jobOptions({ demo: true, count: 1, ...fields }), { status: 400 });
  }
});

test('caption track selection and localized hashtags do not depend on one another', async () => {
  const translated = [[{ ...original[0][0], text: 'Este es el principio.' }], []];
  const output = await localizeClips({ original, sourceLanguage: 'en', target: 'es', tryTrack: async () => ({ tracks: translated, label: 'YouTube transcript' }), signal });
  assert.equal(output.language, 'es');
  assert.deepEqual(output.tracks, translated);
  assert.equal(output.warning, undefined);
  const hashtags = suggestHashtags({ choice: 'ur', transcriptLanguage: 'en', localizedLanguage: 'es', excerpt: 'opening opening', translated: 'principio principio', live: true });
  assert.equal(hashtags.hashtagLanguage, 'ur');
  assert.ok(hashtags.hashtags.every((tag) => /^#[\p{Script=Arabic}]+$/u.test(tag)));
  assert.deepEqual(suggestHashtags({ choice: 'off', transcriptLanguage: 'es' }), { hashtags: [], hashtagLanguage: null });
});

test('provider translation preserves cue timings and labels original on missing translations', async (t) => {
  const provider = { type: 'custom', name: 'Mock translator', baseUrl: 'https://models.example', model: 'mock' };
  const store = { unseal: () => '' };
  const french = ['Voici le début.', 'Attendez la révélation.'];
  let complete = true;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://models.example/chat/completions');
    const payload = JSON.parse(options.body);
    assert.match(payload.messages[0].content, /French/);
    const cues = JSON.parse(payload.messages[1].content);
    assert.deepEqual(cues.map(({ text }) => text), original[0].map(({ text }) => text));
    const contents = cues.map(({ id }, i) => ({ id, text: french[i] }));
    return Response.json({ choices: [{ message: { content: JSON.stringify(complete ? contents.reverse() : contents.slice(0, 1)) } }] });
  });
  const options = { original, sourceLanguage: 'en', target: 'fr', provider, store, tryTrack: async () => null, signal };
  const translation = await localizeClips(options);
  assert.equal(translation.language, 'fr');
  assert.deepEqual(translation.tracks[0], original[0].map((cue, i) => ({ ...cue, text: french[i] })));
  complete = false;
  const fallback = await localizeClips(options);
  assert.equal(fallback.language, 'en');
  assert.deepEqual(fallback.tracks, original);
  assert.match(fallback.warning, /Original captions were used/);
});
