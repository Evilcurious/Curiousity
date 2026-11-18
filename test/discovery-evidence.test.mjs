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

test('job checks require a primary application option and prefer closed or expired evidence', () => {
  const source = '# Editor role in Lahore\n[Apply on company website](https://employer.example.test/jobs/editor)\nCreate new clips.';
  assert.equal(checkSnapshot('jobs', source, window).availability, 'application');
  for (const text of ['No longer accepting applications', 'Job has been filled', 'Job posting is unavailable', 'Application deadline: 2026-11-16', 'validThrough="2026-11-17T13:00:00Z"', '**Apply by:** Nov 16, 2026', 'Closing date is 16 November 2026']) {
    assert.equal(checkSnapshot('jobs', `${source}\n${text}`, window).exclude, 'unavailable', text);
  }
  assert.equal(checkSnapshot('jobs', `${source}\nApply by November 17, 2026`, window).availability, 'application');
  assert.equal(checkSnapshot('jobs', 'The job posting is unavailable.\n## Similar jobs\nApply', window).exclude, 'unavailable');
  assert.equal(checkSnapshot('jobs', 'Sign in to see the position\n## Similar jobs\nApply', window).exclude, 'unconfirmed');
  assert.equal(checkSnapshot('jobs', '[Apply](https://employer.example) No longer accepting applications [Details](https://employer.example)', window).exclude, 'unavailable');
});

test('leads and social posts need positive evidence, not just a reachable page', () => {
  assert.equal(checkSnapshot('companies', '# Studio\nWebsite\n[See the company page](https://company.example.test)', window).availability, 'contact');
  assert.equal(checkSnapshot('companies', 'No longer operating\n[Visit website](https://company.example.test)', window).exclude, 'unavailable');
  assert.equal(checkSnapshot('companies', 'Sign in to see company details', window).exclude, 'unconfirmed');
  assert.equal(checkSnapshot('maps', 'Open ⋅ Closes 9 PM', window).availability, 'hours');
  assert.equal(checkSnapshot('maps', 'Closed ⋅ Opens 9 AM', window).availability, 'hours');
  assert.equal(checkSnapshot('maps', 'Temporarily closed\nOpen 24 hours', window).exclude, 'unavailable');
  assert.equal(checkSnapshot('maps', 'Reviews for the business', window).exclude, 'unconfirmed');
  assert.equal(checkSnapshot('tiktok', '# Example public clip\n1.2K Likes', window).availability, 'publicVideo');
  assert.equal(checkSnapshot('instagram', 'This reel is unavailable.\n13 likes', window).exclude, 'unavailable');
  assert.equal(checkSnapshot('youtube', '# Welcome to YouTube\nRelated videos\n40 views', window).exclude, 'unconfirmed');
});
