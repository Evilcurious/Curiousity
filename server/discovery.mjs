import { withMcp } from './mcp.mjs';
import { boundedText, guardedFetch } from './outbound.mjs';
import { HttpError, youtubeSource } from './validation.mjs';
import { discoveryLimits, discoveryNames, leadSources, reachSources, reachWindows } from '../shared/discovery.mjs';

const exaKey = process.env.EXA_API_KEY?.trim();
const youtubeKey = process.env.YOUTUBE_DATA_API_KEY?.trim();
const exaTool = 'web_search_advanced_exa';
const exaMcp = { url: `https://mcp.exa.ai/mcp?tools=${exaTool}` };
const maxPerSource = 10;
const day = 86_400_000;
export const discoveryEnabled = !/^(?:0|false|off)$/i.test(process.env.DISCOVERY_ENABLED?.trim() || '');

const clean = (value, limit) => typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, limit).toWellFormed() : '';
const targets = {
  youtube: { domains: ['youtube.com', 'youtu.be'], prompt: 'Direct YouTube video, Short or livestream replay pages' },
  tiktok: { domains: ['tiktok.com'], prompt: 'Direct TikTok video posts, not hashtag or account pages' },
  instagram: { domains: ['instagram.com'], prompt: 'Direct Instagram Reels, not profiles or photo posts' },
  jobs: { domains: ['linkedin.com'], prompt: 'Current public LinkedIn job listings (linkedin.com/jobs/view/), not job search pages or articles' },
  companies: { domains: ['linkedin.com'], prompt: 'Public LinkedIn company pages (linkedin.com/company/) for businesses, not people or posts' },
  maps: { domains: ['google.com'], prompt: 'Indexed Google Maps business place links (google.com/maps/place/), not generic searches' },
};

export function discoveryInput(kind, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Enter a search query.');
  const { query, location = '', source = 'all', mode = 'jobs', days = 30 } = body;
  if (typeof query !== 'string' || query.length > discoveryLimits.query || !clean(query, discoveryLimits.query)) throw new HttpError(400, `Enter a topic, hashtag or job title up to ${discoveryLimits.query} characters.`);
  if (kind === 'reach') {
    if (!reachWindows.includes(days) || (source !== 'all' && !reachSources.includes(source))) throw new HttpError(400, 'Choose a supported platform and date range.');
    return { query: clean(query, discoveryLimits.query), days, sources: source === 'all' ? reachSources : [source] };
  }
  if (!['jobs', 'leads'].includes(mode) || (mode === 'jobs' ? !['all', 'jobs'].includes(source) : source !== 'all' && !leadSources.includes(source))) throw new HttpError(400, 'Choose LinkedIn Jobs or a supported business source.');
  if (typeof location !== 'string' || location.length > discoveryLimits.location) throw new HttpError(400, `Enter a location up to ${discoveryLimits.location} characters.`);
  return { query: clean(query, discoveryLimits.query), location: clean(location, discoveryLimits.location), mode, sources: mode === 'jobs' ? ['jobs'] : source === 'all' ? leadSources : [source] };
}

// Only direct pages of the selected type make it into results or Excel. Never
// fetch a result URL, embed it, execute its content, or resolve a short link.
function listing(source, raw) {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.port || url.username || url.password) return null;
  const { hostname: host, pathname: path } = url;
  let found;
  switch (source) {
    case 'youtube': {
      try { const video = youtubeSource(raw); return video.id ? video : null; } catch { return null; }
    }
    case 'tiktok':
      found = /^(?:www\.|m\.)?tiktok\.com$/.test(host) && path.match(/^\/@([\w.-]{1,60})\/video\/(\d{8,24})\/?$/);
      return found ? { id: found[2], url: `https://www.tiktok.com/@${found[1]}/video/${found[2]}` } : null;
    case 'instagram':
      found = /^(?:www\.)?instagram\.com$/.test(host) && path.match(/^\/(reel|tv)\/([\w-]{3,32})\/?$/);
      return found ? { id: found[2], url: `https://www.instagram.com/${found[1]}/${found[2]}/` } : null;
    case 'jobs':
      found = /^(?:www\.|[a-z]{2}\.)?linkedin\.com$/.test(host) && path.match(/^\/jobs\/view\/(?:[\w%-]+-)?(\d{4,20})\/?$/i);
      return found ? { id: found[1], url: `https://www.linkedin.com/jobs/view/${found[1]}/` } : null;
    case 'companies':
      found = /^(?:www\.|[a-z]{2}\.)?linkedin\.com$/.test(host) && path.match(/^\/company\/([\w%-]{1,130})(?:\/about)?\/?$/i);
      return found ? { id: found[1].toLowerCase(), url: `https://www.linkedin.com/company/${found[1]}/` } : null;
    case 'maps': {
      if (!/^(?:www\.|maps\.)?google\.com$/.test(host)) return null;
      if (/^\/maps\/place\/[^/]+/.test(path)) return { id: path.replace(/\/$/, ''), url: `https://www.google.com${path}` };
      const cid = url.searchParams.get('cid');
      return /^\/maps\/?$/.test(path) && /^\d{4,24}$/.test(cid || '') ? { id: cid, url: `https://www.google.com/maps?cid=${cid}` } : null;
    }
    default: return null;
  }
}

function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return '';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : '';
}

function indexRows(source, raw, after, today) {
  if (!Array.isArray(raw)) throw new HttpError(502, 'The search index returned an invalid reply.');
  const records = [], ids = new Set();
  for (const item of raw.slice(0, 24)) {
    const link = listing(source, item?.url);
    if (!link || ids.has(link.id)) continue;
    const published = dateOnly(item.publishedDate);
    if (after && published && (published < after || published > today)) continue;
    ids.add(link.id);
    const excerpt = typeof item.highlights?.[0] === 'string' ? item.highlights[0] : item.text;
    // Maps content is not copied into the workbook. An indexed place URL is
    // a reference to review on Google Maps, not a saved business record.
    records.push({ source, url: link.url, title: source === 'maps' ? 'Indexed Maps listing' : clean(item.title, 160) || `${discoveryNames[source]} listing`,
      published: source === 'maps' ? '' : published, author: source === 'maps' ? '' : clean(item.author, 90),
      excerpt: source === 'maps' ? '' : clean(excerpt, 260), clippable: source === 'youtube' });
    if (records.length === maxPerSource) break;
  }
  return records;
}

async function remoteJson(url, options, signal) {
  const response = await guardedFetch(url, { ...options, signal }, { allowQuery: true });
  if (!response.ok) {
    response.body?.cancel().catch(() => {});
    throw new HttpError([402, 429].includes(response.status) ? 429 : 502, 'The search provider could not complete the request.');
  }
  return JSON.parse(await boundedText(response, 400 * 1024));
}

function readMcpResults(reply) {
  const block = reply?.content?.find((entry) => entry.type === 'text' && typeof entry.text === 'string');
  if (reply?.isError) throw new HttpError(/(?:rate limit|too many requests|\b429\b)/i.test(block?.text || '') ? 429 : 502, 'The search index could not complete the request.');
  if (Array.isArray(reply?.structuredContent?.results)) return reply.structuredContent.results;
  if (/^No search results found\./i.test(block?.text || '')) return [];
  return JSON.parse(block?.text || '{}').results;
}

function unavailable(source, method, error) {
  const limited = error instanceof HttpError && error.status === 429;
  return { source, method, state: limited ? 'limited' : 'unavailable', records: [], note: limited ? 'Provider limit reached. Try again later.' : 'Provider could not be reached or complete this search.' };
}

async function outcome(source, method, rank, find, signal) {
  try {
    const records = await find();
    return { source, method, rank, state: records.length ? 'found' : 'empty', records, note: records.length ? '' : 'No matching direct links were returned.' };
  } catch (error) {
    signal.throwIfAborted();
    return unavailable(source, method, error);
  }
}

async function searchIndex(sources, input, after, today, signal) {
  if (!sources.length) return [];
  const method = 'Exa public index';
  async function search(getResults) {
    return Promise.all(sources.map((source) => outcome(source, method, 'Index relevance', async () => {
      const { domains, prompt } = targets[source];
      const query = `${prompt} matching: ${input.query}${input.location ? `; location: ${input.location}` : ''}${after ? `; published since ${after}` : ''}`;
      const params = { query, numResults: 16, includeDomains: domains, ...(after ? { startPublishedDate: after } : {}), type: 'lite' };
      return indexRows(source, await getResults(params, source === 'maps' ? 1 : 400), after, today);
    }, signal)));
  }
  if (exaKey) return search(async (params, maxCharacters) => (await remoteJson('https://api.exa.ai/search', {
    method: 'POST', headers: { 'x-api-key': exaKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...params, contents: { text: { maxCharacters } } }),
  }, AbortSignal.any([signal, AbortSignal.timeout(20_000)])))?.results);
  try {
    // This is a fixed built-in read-only tool, not a user-saved MCP profile.
    // Keep the latter's approval and endpoint rules unchanged.
    return await withMcp(exaMcp, null, ({ call }) => search(async (params, textMaxCharacters) => readMcpResults(await call(exaTool, { ...params, textMaxCharacters }))),
      (url, options) => guardedFetch(url, { ...options, signal: options.method === 'DELETE' ? options.signal : AbortSignal.any([signal, options.signal]) }, { allowQuery: true }));
  } catch (error) {
    signal.throwIfAborted();
    return sources.map((source) => unavailable(source, method, error));
  }
}

async function youtubeRows(query, publishedAfter, signal) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const get = (path, params) => remoteJson(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams(params)}`, { headers: { 'X-Goog-Api-Key': youtubeKey } }, deadline);
  const search = await get('search', { part: 'snippet', type: 'video', q: query, order: 'viewCount', publishedAfter, maxResults: String(maxPerSource), fields: 'items(id/videoId)' });
  if (!Array.isArray(search.items)) throw new HttpError(502, 'YouTube did not return a list.');
  const ids = [...new Set(search.items.map((item) => item?.id?.videoId).filter((id) => typeof id === 'string' && /^[\w-]{11}$/.test(id)))].slice(0, maxPerSource);
  if (!ids.length) return [];
  const payload = await get('videos', { part: 'snippet,statistics,status', id: ids.join(','), fields: 'items(id,snippet(title,publishedAt,channelTitle,liveBroadcastContent),statistics(viewCount),status(privacyStatus))' });
  if (!Array.isArray(payload.items)) throw new HttpError(502, 'YouTube did not return video information.');
  const videos = new Map(payload.items.map((item) => [item?.id, item]));
  return ids.flatMap((id) => {
    const item = videos.get(id);
    if (!item || item.status?.privacyStatus !== 'public') return [];
    const views = /^\d+$/.test(item.statistics?.viewCount || '') ? Number(item.statistics.viewCount) : null;
    return [{ source: 'youtube', url: `https://www.youtube.com/watch?v=${id}`, title: clean(item.snippet?.title, 160) || 'YouTube video',
      author: clean(item.snippet?.channelTitle, 90), published: dateOnly(item.snippet?.publishedAt),
      views: Number.isSafeInteger(views) ? views : null, live: item.snippet?.liveBroadcastContent === 'live', clippable: true }];
  }).sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
}

export async function discover(input, signal) {
  const searchedAt = new Date().toISOString();
  const today = searchedAt.slice(0, 10);
  const cutoff = input.days ? new Date(Date.parse(searchedAt) - input.days * day).toISOString() : '';
  const after = cutoff.slice(0, 10);
  const useYoutube = youtubeKey && input.sources.includes('youtube');
  const web = searchIndex(useYoutube ? input.sources.filter((source) => source !== 'youtube') : input.sources, input, after, today, signal);
  const youtube = useYoutube && (async () => {
    const result = await outcome('youtube', 'YouTube Data API', 'Total views on recent matches', () => youtubeRows(input.query, cutoff, signal), signal);
    if (!['unavailable', 'limited'].includes(result.state)) return [result];
    const [fallback] = await searchIndex(['youtube'], input, after, today, signal);
    return [{ ...fallback, note: `YouTube Data API ${result.state === 'limited' ? 'limit reached' : 'unavailable'}; used the public index instead.${fallback.note ? ` ${fallback.note}` : ''}` }];
  })();
  const [others, yt] = await Promise.all([web, youtube || []]);
  signal.throwIfAborted();
  const bySource = new Map([...yt, ...others].map((result) => [result.source, result]));
  const results = input.sources.map((source) => bySource.get(source));
  const { sources: _, ...query } = input;
  return { ...query, searchedAt, records: results.flatMap(({ records }) => records), coverage: results.map(({ records, ...source }) => ({ ...source, count: records.length })) };
}
