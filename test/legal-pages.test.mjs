import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { startEngine } from './helpers/http.mjs';

const site = 'https://ai.devzard.online';

test('clean legal URLs serve complete public HTML without a session or the SPA', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'curiousity-legal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { url, agent } = await startEngine(t, { env: { DATA_DIR: root, ALLOW_SIGNUP: 'false', PUBLIC_ORIGIN: site, TRUST_PROXY: 'loopback' } });
  const headers = { Host: 'ai.devzard.online', 'X-Forwarded-Proto': 'https' };
  const documents = [
    { path: 'terms', other: 'privacy', title: 'Terms of Service', required: ['Content and permissions', 'Acceptable use', 'YouTube API Services', 'https://www.youtube.com/t/terms', 'workflow requests'] },
    { path: 'privacy', other: 'terms', title: 'Privacy Policy', required: ['How we use information', 'Sharing and retention', 'Google Drive and YouTube', 'drive.file', 'youtube.upload', 'https://policies.google.com/privacy', 'https://myaccount.google.com/permissions', 'deletion of your data', 'timestamped video frames', 'n8n Workflows', 'workspace member ID'] },
  ];

  for (const { path, other, title, required } of documents) {
    const response = await fetch(`${url}/${path}`, { headers, redirect: 'manual' });
    assert.equal(response.status, 200, `GET /${path}`);
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.match(response.headers.get('content-type') || '', /^text\/html\b/);
    const html = await response.text();
    assert.ok(html.includes(`<h1>${title}</h1>`));
    assert.ok(html.includes(`<link rel="canonical" href="${site}/${path}"`));
    assert.ok(html.includes(`href="/${other}"`));
    assert.ok(html.includes('href="/legal.css"'));
    assert.ok(html.includes('<time datetime='));
    for (const text of required) assert.ok(html.includes(text), `/${path} should include ${text}`);
    assert.doesNotMatch(html, /<script\b|id="root"/i);
    const head = await fetch(`${url}/${path}`, { method: 'HEAD', headers, redirect: 'manual' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  }
  assert.equal((await agent().request('/projects', { headers })).status, 401);
});
