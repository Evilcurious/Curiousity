const isoSourceDate = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/i;

export function sourceTime(value) {
  if (typeof value !== 'string' || value.length > 40 || !isoSourceDate.test(value)) return NaN;
  const date = value.slice(0, 10);
  const midnight = Date.parse(date);
  const time = Date.parse(value);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== date) return NaN;
  return time;
}

export function checkDate(value, { start, end }) {
  const time = sourceTime(value);
  if (!Number.isFinite(time)) return { exclude: 'undated' };
  if (time < start || time > end) return { exclude: 'outsideWindow' };
  return { published: new Date(time).toISOString().slice(0, 10) };
}

const secondary = /^\s*(?:#{1,6}\s*)?(?:related videos|you may also like|suggested for you)\s*:?[\t ]*$/im;
const pageUnavailable = /^\s*(?:#{1,6}\s*)?(?:(?:sorry,? )?(?:this )?page (?:was not found|not found|does not exist|doesn['’]t exist|is not available|isn['’]t available)|404\s*[–-]?\s*not found)[.!]?\s*$/im;
const videoClosed = /\b(?:video unavailable|(?:video|reel|post|content) (?:is )?(?:unavailable|no longer available|not available|private|removed|deleted)|this (?:video|reel|post) (?:has been|was) (?:removed|deleted)|available (?:only )?to (?:subscribers|members)|(?:this )?video is age.restricted|(?:is|video) not available in your country)\b/i;
const videoSignals = {
  youtube: /\b\d[\d,.]*\s*[kmb]?\s+views\b|\bstreamed live (?:on|at)\b/i,
  tiktok: /\b\d[\d,.]*\s*[kmb]?\s+likes\b/i,
  instagram: /\b\d[\d,.]*\s*[kmb]?\s+likes\b|\bview all \d[\d,.]* comments\b/i,
};

// Look for positive evidence in the primary document, not an index title,
// sign-in screen or a recommendation for a different video. Never turn the
// absence of a "closed" notice into a positive verdict by itself.
export function checkSnapshot(source, snapshot) {
  if (typeof snapshot !== 'string' || !snapshot.trim()) return { exclude: 'unconfirmed' };
  const main = snapshot.slice(0, 8000).split(secondary, 1)[0];
  const lines = main.replace(/\[([^\]\n]{1,160})\]\([^\s()]{1,950}(?: +"[^"\n]{1,120}")?\)/g, '$1').replace(/\*\*|__/g, '');
  // Keep negative status text even if a formatting token is malformed.
  const flat = main.replace(/\*\*|__/g, '').replace(/\s+/g, ' ');
  if (pageUnavailable.test(lines)) return { exclude: 'unavailable' };
  if (videoClosed.test(flat)) return { exclude: 'unavailable' };
  const video = videoSignals[source]?.exec(lines);
  if (video) return { availability: 'publicVideo', evidence: lines.slice(Math.max(0, video.index - 110), video.index + video[0].length + 130) };
  return { exclude: 'unconfirmed' };
}
