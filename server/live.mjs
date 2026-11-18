// Only consume the public media URLs returned by yt-dlp, never URLs from form input.
export function publicLiveUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && /(^|\.)(googlevideo\.com|youtube\.com)$/.test(url.hostname) ? url.href : null;
  } catch { return null; }
}

const asNumber = (input) => Number(input) || 0;
const videoOrder = (a, b) => asNumber(b.height) - asNumber(a.height) || asNumber(b.tbr) - asNumber(a.tbr);
const audioOrder = (a, b) => asNumber(b.language_preference) - asNumber(a.language_preference) || asNumber(b.source_preference) - asNumber(a.source_preference) || asNumber(b.abr ?? b.tbr) - asNumber(a.abr ?? a.tbr);
const isVideo = (format) => format.vcodec !== 'none' && (format.acodec !== 'none' || Boolean(format.vcodec || format.height || format.width));
const isAudio = (format) => format.vcodec === 'none' && format.acodec !== 'none';
const isHls = (format) => /^m3u8/.test(format.protocol || '') || /\.m3u8(?:[?#]|$)|\/manifest\/hls_(?:playlist|variant)\b/.test(format.url || '');
const isDash = (format) => /^http_dash_segments/.test(format.protocol || '') || /\.mpd(?:[?#]|$)|\/manifest\/dash\b/.test(format.manifest_url || format.url || '');

export const livePlanKey = ({ url, audioUrl, silent }) => JSON.stringify([url, audioUrl || null, Boolean(silent)]);

export function livePlans(meta) {
  const available = Array.isArray(meta.formats) ? meta.formats.filter((format) => format && !format.has_drm && publicLiveUrl(format.url)) : [];
  const hls = available.filter(isHls);
  const ranked = hls.filter(isVideo).sort(videoOrder);
  const videos = ranked.filter((format) => !format.height || format.height <= 1080);
  if (!videos.length && ranked.length) videos.push(ranked.at(-1));
  const audios = hls.filter(isAudio).sort(audioOrder);
  const plans = [], distinct = new Set();
  function add(type, format, audio, uri = format.url) {
    const url = publicLiveUrl(uri), audioUrl = audio && publicLiveUrl(audio.url);
    if (!url || url === audioUrl) return;
    const label = { muxed: 'HLS playlist', split: 'HLS with separate audio', master: 'HLS master playlist', dash: 'DASH manifest', silent: 'video-only HLS' }[type];
    const plan = { type, label, kind: type === 'dash' ? 'dash' : 'hls', url, audioUrl, headers: format.http_headers || meta.http_headers,
      audioHeaders: audio?.http_headers || meta.http_headers, silent: type === 'silent' };
    const key = livePlanKey(plan);
    if (!distinct.has(key)) { distinct.add(key); plans.push(plan); }
  }
  const groups = [];
  for (const video of videos) {
    const master = publicLiveUrl(video.manifest_url);
    const audio = audios.find((candidate) => master && publicLiveUrl(candidate.manifest_url) === master) || (!master && audios.length === 1 ? audios[0] : undefined);
    const knownMuxed = video.acodec && video.acodec !== 'none';
    if (knownMuxed || (!audio && video.acodec !== 'none')) add('muxed', video);
    if (audio && !knownMuxed) add('split', video, audio);
    if (!knownMuxed && master && master !== publicLiveUrl(video.url)) groups.push(video);
  }
  // The master playlist can supply default audio when the extractor omits the rendition URI.
  for (const video of groups) add('master', video, undefined, video.manifest_url);
  for (const format of available.filter(isDash).sort(videoOrder)) {
    const master = publicLiveUrl(format.manifest_url) || (/\.mpd(?:[?#]|$)|\/manifest\/dash\b/.test(format.url) ? publicLiveUrl(format.url) : null);
    if (master) add('dash', format, undefined, master);
  }
  for (const video of videos.filter((format) => !format.acodec || format.acodec === 'none')) add('silent', video);
  return plans;
}

function mediaInput(url, kind, headers) {
  const agent = headers?.['User-Agent'];
  const ua = typeof agent === 'string' && agent.length <= 250 && !/[\r\n]/.test(agent) ? ['-user_agent', agent] : [];
  return ['-rw_timeout', '16000000', '-protocol_whitelist', 'https,http,tls,tcp,crypto', ...ua,
    ...(kind === 'hls' ? ['-live_start_index', '-2', '-f', 'hls'] : ['-f', 'dash']), '-i', url];
}

export function liveArgs(plan, seconds, destination, maxBytes) {
  return ['-hide_banner', '-loglevel', 'error', '-y', ...mediaInput(plan.url, plan.kind, plan.headers),
    ...(plan.audioUrl ? mediaInput(plan.audioUrl, plan.kind, plan.audioHeaders) : []),
    '-t', String(seconds), '-map', '0:v:0', '-map', plan.audioUrl ? '1:a:0' : plan.silent ? '0:a:0?' : '0:a:0', '-sn', '-dn',
    ...(maxBytes ? ['-fs', String(Math.floor(maxBytes) + 1)] : []), '-c', 'copy', '-f', 'matroska', '-stats_period', '0.5', '-progress', 'pipe:1', destination];
}
