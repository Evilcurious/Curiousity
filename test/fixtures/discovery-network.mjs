import { appendFile } from 'node:fs/promises';

// Network fixture only. Used instead of sending test searches to providers.
const realFetch = globalThis.fetch;
const trace = process.env.FIXTURE_DISCOVERY_TRACE;
const now = (ms = 3_600_000) => new Date(Date.now() - ms).toISOString();
const record = (entry) => appendFile(trace, `${JSON.stringify(entry)}\n`);

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
  ]) : []);
  return {
    results,
    statuses: params.query.includes('cached freshness') ? [{ id: 'https://youtu.be/TrendVideo1', status: 'success', source: 'cached' }] : [],
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
    if (args.includeDomains[0] === 'youtube.com' && args.query.includes('range fixture')) {
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
    if (['test fallback', 'ignored freshness fixture', 'cached freshness fixture'].includes(url.searchParams.get('q'))) return Response.json({ error: 'provider internals hidden' }, { status: 429 });
    if (url.pathname.endsWith('/search')) return Response.json({ items: ['TrendVideo1', 'TrendVideo2', 'TrendVideo3', 'TrendVideo4', 'TrendVideo5', 'TrendVideo1'].map((videoId) => ({ id: { videoId } })) });
    const video = (id, title, views, liveBroadcastContent = 'none', privacyStatus = 'public') => ({ id, snippet: { title, channelTitle: 'Fixture YouTube', publishedAt: now(), liveBroadcastContent }, statistics: { viewCount: views }, status: { privacyStatus } });
    return Response.json({ items: [video('TrendVideo1', 'Fixture on demand', '100'), video('TrendVideo2', 'Fixture live broadcast', '20000', 'live'), video('TrendVideo3', 'Private fixture', '999999', 'none', 'private'), video('TrendVideo4', 'Upcoming fixture', '158210', 'upcoming'), { ...video('TrendVideo5', 'Out-of-range fixture', '999999'), snippet: { publishedAt: '2007-01-01T00:00:00Z' } }] });
  }
  return realFetch(input, options);
};
