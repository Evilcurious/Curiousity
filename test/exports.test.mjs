import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportFrame, frameFor, languageCode, languageLabel, platforms, romanUrdu } from '../shared/exports.mjs';
import { jobOptions } from '../server/validation.mjs';
import { localizeClips, suggestHashtags } from '../server/localization.mjs';
import { makeAss } from '../server/moments.mjs';
import { isLatinCaption, romanizeUrdu } from '../server/roman-urdu.mjs';

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

test('Roman Urdu is a separate script choice and offline romanization preserves cue times', async () => {
  assert.equal(languageCode('ur-Latn-PK'), romanUrdu);
  assert.equal(languageCode('ur-Arab-PK'), 'ur');
  assert.equal(languageCode('Roman Urdu'), romanUrdu);
  assert.equal(languageLabel(romanUrdu), 'Roman Urdu');
  const options = jobOptions({ demo: true, count: 'auto', captionLanguage: 'ur-latn', hashtagLanguage: 'es' });
  assert.deepEqual([options.captionLanguage, options.hashtagLanguage], [romanUrdu, 'es']);
  const urdu = [[{ start: 0.04, end: 1.5, text: 'یَہ ایک اچھا clip ہے، ٹھیک؟ ۱۲:۳۰؛ ۵۰٪۔' }, { start: 2, end: 4, text: 'لاہور اور قلندر!' }], []];
  const text = 'yeh aik achha clip hai, theek? 12:30; 50%.';
  assert.equal(romanizeUrdu(urdu[0][0].text), text);
  assert.match(romanizeUrdu(urdu[0][1].text), /^Lahore aur [a-z]+!$/);
  assert.ok(!isLatinCaption('Not اردو'));
  const requested = [];
  const result = await localizeClips({ original: urdu, sourceLanguage: 'ur', target: romanUrdu, tryTrack: async (lang) => { requested.push(lang); return null; }, signal });
  assert.deepEqual(requested, [romanUrdu]);
  assert.equal(result.language, romanUrdu);
  assert.equal(result.label, 'Local Urdu romanization');
  assert.match(result.warning, /Review spellings/);
  assert.deepEqual(result.tracks, [urdu[0].map((cue) => ({ ...cue, text: romanizeUrdu(cue.text) })), []]);
  const fromUrduTrack = await localizeClips({ original, sourceLanguage: 'en', target: romanUrdu, tryTrack: async (lang) => lang === 'ur' ? { tracks: urdu } : null, signal });
  assert.deepEqual(fromUrduTrack.tracks, result.tracks);
  assert.equal(fromUrduTrack.language, romanUrdu);
  const hashtags = suggestHashtags({ choice: 'es', transcriptLanguage: 'en', localizedLanguage: romanUrdu, translated: text });
  assert.equal(hashtags.hashtagLanguage, 'es');
  assert.ok(hashtags.hashtags.includes('#MejoresMomentos'));
});

test('asks the provider for Roman Urdu, rejecting Urdu script and unchanged non-Urdu text', async (t) => {
  const provider = { type: 'custom', name: 'Mock translator', baseUrl: 'https://models.example', model: 'mock' };
  let phrases = ['Yeh aaghaz hai.', 'Asal baat ka intezar karein.'];
  t.mock.method(globalThis, 'fetch', async (_url, { body }) => {
    const payload = JSON.parse(body);
    assert.match(payload.messages[0].content, /Roman Urdu.*Latin letters.*Do not switch to English/);
    return Response.json({ choices: [{ message: { content: JSON.stringify(JSON.parse(payload.messages[1].content).map(({ id }, index) => ({ id, text: phrases[index] }))) } }] });
  });
  const context = { original, sourceLanguage: 'en', target: romanUrdu, provider, store: { unseal: () => '' }, tryTrack: async () => null, tryEnglish: async () => assert.fail('Do not use English translation for Roman Urdu'), signal };
  const result = await localizeClips(context);
  assert.equal(result.language, romanUrdu);
  assert.deepEqual(result.tracks[0], original[0].map((cue, i) => ({ ...cue, text: phrases[i] })));
  for (const output of [['یہ آغاز ہے۔', 'انکشاف کا انتظار کریں۔'], original[0].map((cue) => cue.text)]) {
    phrases = output;
    const fallback = await localizeClips(context);
    assert.equal(fallback.language, 'en');
    assert.deepEqual(fallback.tracks, original);
    assert.match(fallback.warning, /Could not produce Roman Urdu captions. Original captions were used/);
  }
});
