import { appendFile } from 'node:fs/promises';

// Network fixture only. Used instead of sending test searches to providers.
const realFetch = globalThis.fetch;
const trace = process.env.FIXTURE_DISCOVERY_TRACE;
const now = () => new Date(Date.now() - 2 * 86_400_000).toISOString();
const record = (entry) => appendFile(trace, `${JSON.stringify(entry)}\n`);

function results(params) {
  switch (params.includeDomains[0]) {
    case 'youtube.com': return [
      { title: 'Fixture YouTube Short', url: 'https://www.youtube.com/shorts/TrendVideo1?feature=share', author: 'Fixture creator', publishedDate: now() },
      { title: 'Duplicate Short', url: 'https://youtu.be/TrendVideo1' },
      { title: 'Too old', url: 'https://youtu.be/OldFixture1', publishedDate: '2008-01-01T00:00:00Z' },
      { title: 'Channel, not a video', url: 'https://www.youtube.com/@fixture/live' },
      { title: 'Wrong host', url: 'https://www.youtube.com.not-youtube.example/watch?v=TrendVideo1' },
    ];
    case 'tiktok.com': return [
      { title: 'Fixture TikTok post', url: 'https://www.tiktok.com/@fixture/video/1234567890123?tracker=1' },
      { title: 'Hashtag page', url: 'https://www.tiktok.com/tag/podcastclips' },
    ];
    case 'instagram.com': return params.query.includes('empty test') ? [] : [
      { title: 'Fixture Reel', url: 'https://www.instagram.com/reel/TestReel1/?igsh=track', publishedDate: now() },
      { title: 'Photo', url: 'https://www.instagram.com/p/TestReel2' },
    ];
    case 'linkedin.com': return params.query.includes('linkedin.com/jobs/view/') ? [
      { title: '=1+1 & "Fixture video editor"', url: 'https://pk.linkedin.com/jobs/view/editor-at-fixture-7365432101?trk=tracking', publishedDate: now(), text: 'A video editing role with <public> details & location.' },
      { title: 'Duplicate role', url: 'https://www.linkedin.com/jobs/view/7365432101/' },
      { title: 'Not a job', url: 'https://www.linkedin.com/jobs/search/?keywords=editor' },
      { title: 'Not a hyperlink', url: 'javascript:void(0)' },
    ] : [
      { title: 'Fixture Studio & Partners', url: 'https://www.linkedin.com/company/fixture-studio/about/?trk=tracking', text: 'Public video editing business profile.' },
      { title: 'Not a company', url: 'https://www.linkedin.com/in/fixture-person' },
    ];
    case 'google.com': return [
      { title: 'Listing name not copied to export', url: 'https://www.google.com/maps/place/Fixture+Studio/@31.5,74.3,18z/data=!4m5?entry=ttu', text: 'A business address not copied to the workbook.' },
      { title: 'Wrong result type', url: 'https://www.google.com/maps/search/?api=1&query=studio' },
      { title: 'Redirect', url: 'https://www.google.com/url?q=https://disallowed.example/' },
    ];
    default: return [];
  }
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
      } finally { await record({ aborted: true }); }
    }
    if (args.includeDomains[0] === 'instagram.com' && args.query.includes('limited test')) {
      return reply({ isError: true, content: [{ type: 'text', text: '429 rate limited (provider internals hidden)' }] });
    }
    const content = results(args);
    if (args.includeDomains[0] === 'linkedin.com') {
      const envelope = JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [], structuredContent: { results: content } } });
      return new Response(`event: message\ndata: ${envelope}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    return reply({ content: [{ type: 'text', text: JSON.stringify({ results: content }) }] });
  }
  if (url.hostname === 'api.exa.ai') {
    const body = JSON.parse(options.body);
    await record({ method: 'exa-api', keyed: options.headers['x-api-key'] === 'fixture-exa-key', arguments: body });
    return Response.json({ results: results(body) });
  }
  if (url.hostname === 'www.googleapis.com' && url.pathname.startsWith('/youtube/v3/')) {
    await record({ method: 'youtube-api', path: url.pathname, params: Object.fromEntries(url.searchParams), keyed: options.headers['X-Goog-Api-Key'] === 'fixture-youtube-key' });
    if (url.searchParams.get('q') === 'test fallback') return Response.json({ error: 'provider internals hidden' }, { status: 429 });
    if (url.pathname.endsWith('/search')) return Response.json({ items: ['TrendVideo1', 'TrendVideo2', 'TrendVideo3', 'TrendVideo1'].map((videoId) => ({ id: { videoId } })) });
    const video = (id, title, views, liveBroadcastContent = 'none', privacyStatus = 'public') => ({ id, snippet: { title, channelTitle: 'Fixture YouTube', publishedAt: now(), liveBroadcastContent }, statistics: { viewCount: views }, status: { privacyStatus } });
    return Response.json({ items: [video('TrendVideo1', 'Fixture on demand', '100'), video('TrendVideo2', 'Fixture live broadcast', '20000', 'live'), video('TrendVideo3', 'Private fixture', '999999', 'none', 'private')] });
  }
  return realFetch(input, options);
};
