import { appendFile } from 'node:fs/promises';

// Network fixture only. Used instead of sending test searches to providers.
const realFetch = globalThis.fetch;
const trace = process.env.FIXTURE_DISCOVERY_TRACE;
const now = (ms = 3_600_000) => new Date(Date.now() - ms).toISOString();
const record = (entry) => appendFile(trace, `${JSON.stringify(entry)}\n`);

const openJob = '[Apply](https://fixture.example.test/job)\nA video editing role with <public> details & location in Lahore.';
const cachedJob = 'https://www.linkedin.com/jobs/view/7365432107/';
const job = (id, title, text, publishedDate = now()) => ({ title, url: `https://www.linkedin.com/jobs/view/736543210${id}/`, text, publishedDate });
function searchPayload(params) {
  const domain = params.includeDomains[0];
  const results = (domain === 'youtube.com' ? [
    { title: 'Fixture YouTube Short', url: 'https://www.youtube.com/shorts/TrendVideo1?feature=share', author: 'Fixture creator', publishedDate: now(), text: '# Fixture YouTube Short\n12,346 views' },
    { title: 'Duplicate Short', url: 'https://youtu.be/TrendVideo1' },
    { title: 'Too old', url: 'https://youtu.be/OldFixture1', publishedDate: '2008-01-01T00:00:00Z', text: '40 views' },
    { title: 'Channel, not a video', url: 'https://www.youtube.com/@fixture/live' },
    { title: 'Wrong host', url: 'https://www.youtube.com.not-youtube.example/watch?v=TrendVideo1' },
    ...(params.query.includes('range fixture') ? [{ title: 'Earlier fixture upload', url: 'https://youtu.be/RangeVideo1', publishedDate: now(25 * 3_600_000), text: '421 views' }] : []),
  ] : domain === 'tiktok.com' ? [
    { title: 'Fixture TikTok post', url: 'https://www.tiktok.com/@fixture/video/1234567890123?tracker=1', publishedDate: now(), text: '22 Likes' },
    { title: 'Undated TikTok', url: 'https://www.tiktok.com/@fixture/video/1234567890124', text: '50 Likes' },
    { title: 'Hashtag page', url: 'https://www.tiktok.com/tag/podcastclips' },
  ] : domain === 'instagram.com' ? (params.query.includes('empty test') ? [] : [
    { title: 'Fixture Reel', url: 'https://www.instagram.com/reel/TestReel1/?igsh=track', publishedDate: now(), text: 'View all 14 comments' },
    { title: 'Unavailable Reel', url: 'https://www.instagram.com/reel/TestReel3/', publishedDate: now(), text: 'This reel is unavailable. 15 likes' },
    { title: 'Photo', url: 'https://www.instagram.com/p/TestReel2' },
  ]) : domain === 'linkedin.com' ? (params.query.includes('linkedin.com/jobs/view/') ? [
    { title: '=1+1 & "Fixture video editor"', url: 'https://pk.linkedin.com/jobs/view/editor-at-fixture-7365432101?trk=tracking', publishedDate: now(), text: openJob },
    { title: 'Duplicate role', url: 'https://www.linkedin.com/jobs/view/7365432101/' },
    { title: 'Not a job', url: 'https://www.linkedin.com/jobs/search/?keywords=editor' },
    { title: 'Not a hyperlink', url: 'javascript:void(0)' },
    job(2, 'Expired synthetic role', `${openJob}\nNo longer accepting applications`),
    job(3, 'Undated synthetic role', openJob, null),
    job(4, 'Deadline synthetic role', `${openJob}\nClosing date: 2009-01-01`),
    job(5, 'Unknown synthetic role', 'A page with no application option.\n\n## Similar jobs\nApply\nVideo editing job.'),
    job(6, 'Stale synthetic role', openJob, '2008-01-01'),
    job(7, 'Cached synthetic role', openJob),
    ...(params.query.includes('range fixture') ? [job(8, 'Earlier fixture role', openJob, now(25 * 3_600_000))] : []),
  ] : [
    { title: 'Fixture Studio & Partners', url: 'https://www.linkedin.com/company/fixture-studio/about/?trk=tracking', publishedDate: now(), text: 'Public video editing business profile.\nWebsite\n[Fixture Studio](https://fixture.example.test)\n' },
    { title: 'Closed company', url: 'https://www.linkedin.com/company/fixture-closed/', publishedDate: now(), text: 'Business has closed\n[Visit website](https://fixture.example.test)' },
    { title: 'Undated company', url: 'https://www.linkedin.com/company/fixture-undated/', text: '[Visit website](https://fixture.example.test)' },
    { title: 'Not a company', url: 'https://www.linkedin.com/in/fixture-person' },
  ]) : domain === 'google.com' ? [
    { title: 'Listing name not copied to export', url: 'https://www.google.com/maps/place/Fixture+Studio/@31.5,74.3,18z/data=!4m5?entry=ttu', publishedDate: now(), text: 'A business address not copied to the workbook.\nOpen ⋅ Closes 5 PM' },
    { title: 'Closed place', url: 'https://www.google.com/maps/place/Closed+Fixture/', publishedDate: now(), text: 'Permanently closed\nOpen 24 hours' },
    { title: 'Undated place', url: 'https://www.google.com/maps/place/Undated+Fixture/', text: 'Open 24 hours' },
    { title: 'Wrong result type', url: 'https://www.google.com/maps/search/?api=1&query=studio' },
    { title: 'Redirect', url: 'https://www.google.com/url?q=https://disallowed.example/' },
  ] : []);
  return {
    results,
    statuses: domain === 'linkedin.com' ? [{ id: cachedJob, status: 'success', source: 'cached' }] : [],
    ...(params.query.includes('ignored freshness') ? { warnings: [{ code: 'IGNORED_FIELD', path: '/contents/maxAgeHours', message: 'Fixture: freshness not honored' }] } : {}),
  };
}

if (trace) globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  if (url.hostname === 'mcp.exa.ai') {
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    const body = JSON.parse(options.body);
    await record({ method: body.method, tools: url.searchParams.get('tools'), arguments: body.params?.arguments });
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const reply = (result, headers) => Response.json({ jsonrpc: '2.0', id: body.id, result }, { headers });
    if (body.method === 'initialize') return reply({ protocolVersion: '2025-06-18', serverInfo: { name: 'Fixture Exa' }, capabilities: { tools: {} } }, { 'Mcp-Session-Id': 'fixture-session' });
    if (body.method !== 'tools/call' || body.params.name !== 'web_search_advanced_exa' || options.headers['Mcp-Session-Id'] !== 'fixture-session') return new Response(null, { status: 400 });
    const args = body.params.arguments;
    if (args.query.includes('Wait for disconnect')) {
      try {
        options.signal.throwIfAborted();
        await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
      } finally {
        await record({ aborted: true });
        if (args.query.includes('cleanup pause')) await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    if (args.includeDomains[0] === 'instagram.com' && args.query.includes('limited test')) {
      return reply({ isError: true, content: [{ type: 'text', text: '429 rate limited (provider internals hidden)' }] });
    }
    const content = searchPayload(args);
    if (args.includeDomains[0] === 'linkedin.com') {
      const envelope = JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [], structuredContent: content } });
      return new Response(`event: message\ndata: ${envelope}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    return reply({ content: [{ type: 'text', text: JSON.stringify(content) }] });
  }
  if (url.hostname === 'api.exa.ai') {
    const body = JSON.parse(options.body);
    await record({ method: 'exa-api', keyed: options.headers['x-api-key'] === 'fixture-exa-key', arguments: body });
    return Response.json(searchPayload(body));
  }
  if (url.hostname === 'www.googleapis.com' && url.pathname.startsWith('/youtube/v3/')) {
    await record({ method: 'youtube-api', path: url.pathname, params: Object.fromEntries(url.searchParams), keyed: options.headers['X-Goog-Api-Key'] === 'fixture-youtube-key' });
    if (url.searchParams.get('q') === 'test fallback') return Response.json({ error: 'provider internals hidden' }, { status: 429 });
    if (url.pathname.endsWith('/search')) return Response.json({ items: ['TrendVideo1', 'TrendVideo2', 'TrendVideo3', 'TrendVideo4', 'TrendVideo5', 'TrendVideo1'].map((videoId) => ({ id: { videoId } })) });
    const video = (id, title, views, liveBroadcastContent = 'none', privacyStatus = 'public') => ({ id, snippet: { title, channelTitle: 'Fixture YouTube', publishedAt: now(), liveBroadcastContent }, statistics: { viewCount: views }, status: { privacyStatus } });
    return Response.json({ items: [video('TrendVideo1', 'Fixture on demand', '100'), video('TrendVideo2', 'Fixture live broadcast', '20000', 'live'), video('TrendVideo3', 'Private fixture', '999999', 'none', 'private'), video('TrendVideo4', 'Upcoming fixture', '158210', 'upcoming'), { ...video('TrendVideo5', 'Out-of-range fixture', '999999'), snippet: { publishedAt: '2007-01-01T00:00:00Z' } }] });
  }
  return realFetch(input, options);
};
