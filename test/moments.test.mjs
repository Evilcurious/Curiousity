import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidates, clipCues, makeAss, makeSrt, parseVtt, pickAutoMoments, pickMoments } from '../server/moments.mjs';
import { jobOptions, youtubeSource } from '../server/validation.mjs';

const example = 'dQw4w9WgXcQ';
test('accepts canonical video, replay and share links while rejecting other origins and playlists', () => {
  for (const raw of [`https://youtu.be/${example}?t=25`, `https://www.youtube.com/live/${example}?si=hello`, `https://www.youtube.com/shorts/${example}`, `https://youtube.com/watch?v=${example}&list=abc`]) {
    assert.equal(youtubeSource(raw).url, `https://www.youtube.com/watch?v=${example}`);
  }
  assert.equal(youtubeSource('https://youtube.com/@example/live').url, 'https://www.youtube.com/@example/live');
  for (const raw of ['https://youtube.com/playlist?list=PL', `https://youtube.com.example.org/watch?v=${example}`, `file:///tmp/${example}`, 'https://youtu.be/too-short']) assert.throws(() => youtubeSource(raw), { status: 400 });
});
test('validates count and allows explicit live capture and captions off', () => {
  const opts = jobOptions({ url: `https://youtu.be/${example}`, count: 7, mode: 'live', liveMinutes: 5, captions: false, tiktok: true });
  assert.deepEqual([opts.count, opts.mode, opts.liveMinutes, opts.captions, opts.tiktok], [7, 'live', 5, false, true]);
  assert.throws(() => jobOptions({ demo: true, count: 21 }), { status: 400 });
  assert.equal(jobOptions({ demo: true, count: 1, tiktok: true }).tiktok, false);
});
test('ranks windows using available replay signals and chooses non-overlapping clips', () => {
  const duration = 150;
  const audio = Array(duration).fill(-32);
  const heatmap = [{ start_time: 63, end_time: 104, value: 1 }];
  const ranked = buildCandidates({ duration, count: 3, audio, heatmap });
  const clips = pickMoments(ranked, 3);
  assert.equal(clips.length, 3);
  assert.match(clips[0].reason, /replay interest/);
  assert.ok(clips.some((clip) => clip.start >= 61 && clip.end <= 109));
  for (let index = 0; index < clips.length; index++) {
    const clip = clips[index];
    assert.ok(clip.start >= 0 && clip.end <= duration && clip.end > clip.start);
    for (const other of clips.slice(index + 1)) assert.ok(Math.min(clip.end, other.end) - Math.max(clip.start, other.start) <= Math.min(clip.end - clip.start, other.end - other.start) * 0.14);
  }
  assert.equal(pickMoments(buildCandidates({ duration: 8, count: 20 }), 20).length, 1);
});
test('VTT parsing, clipping and SRT/ASS keep caption timestamps relative to the exported video', () => {
  const cues = parseVtt('WEBVTT\n\n00:01.000 --> 00:03.500 align:start\n<c>Wait</c> &amp; see!\n\n00:03.500 --> 00:05.000\nNext move.\n');
  assert.deepEqual(cues[0], { start: 1, end: 3.5, text: 'Wait & see!' });
  const clipped = clipCues(cues, 2, 4.2);
  assert.equal(clipped[0].start, 0);
  assert.match(makeSrt(clipped), /^1\n00:00:00,000 --> 00:00:01,500\nWait & see!/);
  const ass = makeAss([{ start: 0, end: 1.6, text: 'a {b} \\N' }]);
  assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:01\.60/);
  assert.doesNotMatch(ass, /\{b\}|\\N/);
});

test('Auto keeps only strong non-overlapping clips, retains a cap and uses one honest fallback', () => {
  assert.equal(jobOptions({ demo: true, count: 'auto' }).count, 'auto');
  for (const count of [true, [4], 0, 1.5, 'automatic', 21]) assert.throws(() => jobOptions({ demo: true, count }), { status: 400 });
  const { picks: empty } = pickAutoMoments(buildCandidates({ duration: 5, count: 'auto' }), 20);
  assert.deepEqual(empty, []);
  const flat = buildCandidates({ duration: 120, count: 'auto' });
  assert.deepEqual(pickAutoMoments(flat, 20), { picks: [flat[0]], fallback: true });
  const a = { start: 5, end: 25, score: 86 };
  const b = { start: 50, end: 74, score: 71 };
  const weak = { start: 80, end: 106, score: 61 };
  const redundant = { start: 19, end: 44, score: 82 };
  assert.deepEqual(pickAutoMoments([weak, b, redundant, a], 20), { picks: [a, b], fallback: false });
  assert.deepEqual(pickAutoMoments([weak, a], 20), { picks: [a], fallback: false });
  assert.deepEqual(pickAutoMoments([a, b], 1), { picks: [a], fallback: false });
  assert.equal(pickAutoMoments(Array.from({ length: 25 }, (_, i) => ({ start: i * 20, end: i * 20 + 19, score: 70 })), 20).picks.length, 20);
});
