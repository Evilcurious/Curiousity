import { withMcp } from './mcp.mjs';
import { boundedText, guardedFetch } from './outbound.mjs';
import { HttpError, youtubeSource } from './validation.mjs';
import { checkDate, checkSnapshot } from './discovery-evidence.mjs';
import { defaultDiscoveryDays, discoveryLimits, discoveryNames, discoveryVerificationVersion, leadSources, reachSources } from '../shared/discovery.mjs';

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
  const { query, location = '', source = 'all', mode = 'jobs', days = defaultDiscoveryDays } = body;
  if (typeof query !== 'string' || query.length > discoveryLimits.query || !clean(query, discoveryLimits.query)) throw new HttpError(400, `Enter a topic, hashtag or job title up to ${discoveryLimits.query} characters.`);
  if (!Number.isInteger(days) || days < 1 || days > discoveryLimits.days) throw new HttpError(400, `Choose a lookback of 1 to ${discoveryLimits.days} whole days.`);
  if (kind === 'reach') {
    if (source !== 'all' && !reachSources.includes(source)) throw new HttpError(400, 'Choose a supported platform.');
    return { query: clean(query, discoveryLimits.query), days, sources: source === 'all' ? reachSources : [source] };
  }
  if (!['jobs', 'leads'].includes(mode) || (mode === 'jobs' ? !['all', 'jobs'].includes(source) : source !== 'all' && !leadSources.includes(source))) throw new HttpError(400, 'Choose LinkedIn Jobs or a supported business source.');
  if (typeof location !== 'string' || location.length > discoveryLimits.location) throw new HttpError(400, `Enter a location up to ${discoveryLimits.location} characters.`);
  return { query: clean(query, discoveryLimits.query), location: clean(location, discoveryLimits.location), mode, days, sources: mode === 'jobs' ? ['jobs'] : source === 'all' ? leadSources : [source] };
}

// Only direct pages of the selected type make it into results or Excel. We
// do not fetch result URLs ourselves, embed them, or resolve short links.
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

const missed = (totals, key, count = 1) => { totals[key] = (totals[key] || 0) + count; };

function indexRows(source, payload, window) {
  if (!Array.isArray(payload?.results)) throw new HttpError(502, 'The search index returned an invalid reply.');
  const records = [], ids = new Set(), excluded = {};
  // Search does not always return document statuses. We request live text
  // under Exa's maxAgeHours: 0 contract, and reject explicit cache/errors or
  // a reply saying the provider did not honor the freshness request.
  const ignoredFreshness = Array.isArray(payload.warnings) && payload.warnings.some((item) =>
    /(?:ignored|unsupported)/i.test(item?.code || '') && /(?:^\/?contents\/?$|max.?age.?hours|live.?crawl)/i.test(item?.path || ''));
  const stale = new Set((Array.isArray(payload.statuses) ? payload.statuses.slice(0, 80) : [])
    .filter((item) => typeof item?.id === 'string' && (item.status !== 'success' || /(?:cache|fallback)/i.test(item.source || '')))
    .flatMap(({ id }) => [id, listing(source, id)?.id].filter(Boolean)));
  for (const item of payload.results.slice(0, 24)) {
    const link = listing(source, item?.url);
    if (!link || ids.has(link.id)) continue;
    ids.add(link.id);
    const { published, exclude } = checkDate(item.publishedDate, window);
    if (exclude) { missed(excluded, exclude); continue; }
    if (ignoredFreshness || stale.has(link.id) || stale.has(item.id) || stale.has(item.url)) { missed(excluded, 'unconfirmed'); continue; }
    // Snippets and index metadata alone are not proof of availability.
    // The search requested live content for this exact result page.
    const proof = checkSnapshot(source, item.text, window);
    if (proof.exclude) { missed(excluded, proof.exclude); continue; }
    // Do not copy Google Maps content into Excel or send it to an AI model.
    records.push({ source, url: link.url, title: source === 'maps' ? 'Indexed Maps listing' : clean(item.title, 160) || `${discoveryNames[source]} listing`,
      published, author: source === 'maps' ? '' : clean(item.author, 90), availability: proof.availability,
      excerpt: source === 'maps' ? '' : clean(proof.evidence, 260), clippable: source === 'youtube' });
    if (records.length === maxPerSource) break;
  }
  return { records, excluded };
}

async function remoteJson(url, options, signal) {
  const response = await guardedFetch(url, { ...options, signal }, { allowQuery: true });
  if (!response.ok) {
    response.body?.cancel().catch(() => {});
    throw new HttpError([402, 429].includes(response.status) ? 429 : 502, 'The search provider could not complete the request.');
  }
  return JSON.parse(await boundedText(response, 400 * 1024));
}

function readMcpSearch(reply) {
  const block = reply?.content?.find((entry) => entry.type === 'text' && typeof entry.text === 'string');
  if (reply?.isError) throw new HttpError(/(?:rate limit|too many requests|\b429\b)/i.test(block?.text || '') ? 429 : 502, 'The search index could not complete the request.');
  if (Array.isArray(reply?.structuredContent?.results)) return reply.structuredContent;
  if (/^No search results found\./i.test(block?.text || '')) return { results: [] };
  return JSON.parse(block?.text || '{}');
}

function unavailable(source, method, error) {
  const limited = error instanceof HttpError && error.status === 429;
  return { source, method, state: limited ? 'limited' : 'unavailable', records: [], excluded: {}, note: limited ? 'Provider limit reached. Try again later.' : 'Provider could not be reached or complete this search.' };
}

async function outcome(source, method, rank, find, signal) {
  try {
    const { records, excluded } = await find();
    return { source, method, rank, state: records.length ? 'found' : 'empty', records, excluded, note: records.length || Object.keys(excluded).length ? '' : 'No matching direct links were returned.' };
  } catch (error) {
    signal.throwIfAborted();
    return unavailable(source, method, error);
  }
}

async function searchIndex(sources, input, window, signal) {
  if (!sources.length) return [];
  const method = 'Exa · public page evidence';
  // Use the calendar day for candidate search, then enforce the exact rolling
  // UTC window locally, regardless of which filters the provider honored.
  const after = new Date(window.start).toISOString().slice(0, 10);
  async function search(getResults) {
    return Promise.all(sources.map((source) => outcome(source, method, 'Index relevance', async () => {
      const { domains, prompt } = targets[source];
      const query = `${prompt} matching: ${input.query}${input.location ? `; location: ${input.location}` : ''}; dated on or after ${after}`;
      const params = { query, numResults: 12, includeDomains: domains, startPublishedDate: after, type: 'auto' };
      return indexRows(source, await getResults(params), window);
    }, signal)));
  }
  const freshness = { maxAgeHours: 0, livecrawlTimeout: 9000 };
  if (exaKey) return search((params) => remoteJson('https://api.exa.ai/search', {
    method: 'POST', headers: { 'x-api-key': exaKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...params, contents: { ...freshness, text: { maxCharacters: 8000 } } }),
  }, AbortSignal.any([signal, AbortSignal.timeout(20_000)])));
  try {
    // Fixed, built-in read-only endpoint. User-saved MCP approvals and URL
    // validation are not part of this request and have not changed.
    return await withMcp(exaMcp, null, ({ call }) => search(async (params) => readMcpSearch(await call(exaTool, { ...params, ...freshness, textMaxCharacters: 8000 }))),
      (url, options) => guardedFetch(url, { ...options, signal: options.method === 'DELETE' ? options.signal : AbortSignal.any([signal, options.signal]) }, { allowQuery: true }));
  } catch (error) {
    signal.throwIfAborted();
    return sources.map((source) => unavailable(source, method, error));
  }
}

async function youtubeRows(query, window, signal) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const get = (path, params) => remoteJson(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams(params)}`, { headers: { 'X-Goog-Api-Key': youtubeKey } }, deadline);
  const search = await get('search', { part: 'snippet', type: 'video', q: query, order: 'viewCount', publishedAfter: new Date(window.start).toISOString(), maxResults: String(maxPerSource), fields: 'items(id/videoId)' });
  if (!Array.isArray(search.items)) throw new HttpError(502, 'YouTube did not return a list.');
  const ids = [...new Set(search.items.map((item) => item?.id?.videoId).filter((id) => typeof id === 'string' && /^[\w-]{11}$/.test(id)))].slice(0, maxPerSource);
  const excluded = {};
  if (!ids.length) return { records: [], excluded };
  const payload = await get('videos', { part: 'snippet,statistics,status', id: ids.join(','), fields: 'items(id,snippet(title,publishedAt,channelTitle,liveBroadcastContent),statistics(viewCount),status(privacyStatus,uploadStatus))' });
  if (!Array.isArray(payload.items)) throw new HttpError(502, 'YouTube did not return video information.');
  const videos = new Map(payload.items.map((item) => [item?.id, item]));
  const records = ids.flatMap((id) => {
    const item = videos.get(id);
    if (!item || item.status?.privacyStatus !== 'public' || item.snippet?.liveBroadcastContent === 'upcoming' || (item.status.uploadStatus && item.status.uploadStatus !== 'processed')) {
      missed(excluded, 'unavailable'); return [];
    }
    const { published, exclude } = checkDate(item.snippet?.publishedAt, window);
    if (exclude) { missed(excluded, exclude); return []; }
    const views = /^\d+$/.test(item.statistics?.viewCount || '') ? Number(item.statistics.viewCount) : null;
    return [{ source: 'youtube', url: `https://www.youtube.com/watch?v=${id}`, title: clean(item.snippet?.title, 160) || 'YouTube video',
      author: clean(item.snippet?.channelTitle, 90), published, availability: 'publicVideo',
      views: Number.isSafeInteger(views) ? views : null, live: item.snippet?.liveBroadcastContent === 'live', clippable: true }];
  }).sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
  return { records, excluded };
}

async function reviewResults(results, criteria, review, signal) {
  if (!review) return { state: 'source_only', checked: 0 };
  const records = results.flatMap((item) => item.records);
  if (!records.length) return { state: 'skipped', checked: 0 };
  const candidates = records.map(({ title, source, published, availability, excerpt }, i) => ({ id: `r${i + 1}`, title, source, published, availability, excerpt }));
  const approved = new Set();
  let state = 'complete';
  try {
    const decisions = await review(criteria, candidates, AbortSignal.any([signal, AbortSignal.timeout(20_000)]));
    candidates.forEach(({ id }, i) => { if (decisions.get(id) === true) approved.add(records[i]); });
  } catch {
    signal.throwIfAborted();
    approved.clear();
    state = 'failed';
  }
  // Model decisions can only narrow the already source-checked set. No row
  // can be introduced or mutated by the model, including its URL or date.
  for (const result of results) {
    const accepted = result.records.filter((record) => approved.has(record));
    const rejected = result.records.length - accepted.length;
    if (rejected) missed(result.excluded, 'review', rejected);
    if (result.records.length && !accepted.length) result.state = 'empty';
    result.records = accepted;
  }
  return { state, checked: state === 'complete' ? records.length : 0 };
}

export async function discover(input, signal, review) {
  const end = Date.now(), window = { start: end - input.days * day, end };
  const searchedAt = new Date(end).toISOString();
  const useYoutube = youtubeKey && input.sources.includes('youtube');
  const web = searchIndex(useYoutube ? input.sources.filter((source) => source !== 'youtube') : input.sources, input, window, signal);
  const youtube = useYoutube && (async () => {
    const result = await outcome('youtube', 'YouTube Data API', 'Total views on recent matches', () => youtubeRows(input.query, window, signal), signal);
    if (!['unavailable', 'limited'].includes(result.state)) return [result];
    const [fallback] = await searchIndex(['youtube'], input, window, signal);
    return [{ ...fallback, note: `YouTube Data API ${result.state === 'limited' ? 'limit reached' : 'unavailable'}; tried the public index instead.${fallback.note ? ` ${fallback.note}` : ''}` }];
  })();
  const [others, yt] = await Promise.all([web, youtube || []]);
  signal.throwIfAborted();
  const bySource = new Map([...yt, ...others].map((result) => [result.source, result]));
  const results = input.sources.map((source) => bySource.get(source));
  const { sources: _, ...query } = input;
  const aiReview = await reviewResults(results, query, review, signal);
  signal.throwIfAborted();
  return { ...query, searchedAt, from: new Date(window.start).toISOString(), verificationVersion: discoveryVerificationVersion, aiReview,
    records: results.flatMap(({ records }) => records), coverage: results.map(({ records, ...source }) => ({ ...source, count: records.length })) };
}
