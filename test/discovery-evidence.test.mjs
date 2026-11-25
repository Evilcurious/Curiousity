import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDate, checkSnapshot } from '../server/discovery-evidence.mjs';

const window = { start: Date.parse('2026-11-16T14:00:00Z'), end: Date.parse('2026-11-17T14:00:00Z') };

test('source dates are bounded by the rolling time window, not rounded to midnight', () => {
  assert.deepEqual(checkDate('2026-11-16T14:00:00Z', window), { published: '2026-11-16' });
  assert.deepEqual(checkDate('2026-11-16T19:00:00+05:00', window), { published: '2026-11-16' });
  for (const date of ['2026-11-16T13:59:59.999Z', '2026-11-16', '2026-11-17T14:00:00.001Z']) assert.equal(checkDate(date, window).exclude, 'outsideWindow');
  for (const date of [undefined, '', 'N/A', '2026-02-30', '2026-11-17T00:00:00fake', '2026-11-17T00:00:00']) assert.equal(checkDate(date, window).exclude, 'undated');
});

test('social posts need positive evidence from the primary video, not just a reachable page', () => {
  assert.equal(checkSnapshot('tiktok', '# Example public clip\n1.2K Likes', window).availability, 'publicVideo');
  assert.equal(checkSnapshot('instagram', 'This reel is unavailable.\n13 likes', window).exclude, 'unavailable');
  assert.equal(checkSnapshot('youtube', '# Welcome to YouTube\nRelated videos\n40 views', window).exclude, 'unconfirmed');
});
