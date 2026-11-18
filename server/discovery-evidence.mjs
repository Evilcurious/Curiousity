const isoSourceDate = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/i;
const day = 86_400_000;

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

const secondary = /^\s*(?:#{1,6}\s*)?(?:similar jobs|other jobs|related jobs|more jobs like this|people also viewed|similar companies|similar places|related videos|you may also like|suggested for you)\s*:?[\t ]*$/im;
const pageUnavailable = /^\s*(?:#{1,6}\s*)?(?:(?:sorry,? )?(?:this )?page (?:was not found|not found|does not exist|doesn['’]t exist|is not available|isn['’]t available)|404\s*[–-]?\s*not found)[.!]?\s*$/im;
const jobClosed = /\b(?:(?:no longer|not) accepting (?:new |job )?applications|applications? (?:are|is|have|has) (?:now )?closed|(?:job|position|(?:job )?posting|listing|vacancy) (?:is |has |was )?(?:no longer (?:available|active|open|posted)|unavailable|inactive|expired|closed|filled|removed|been filled|been removed)|could not find (?:this|the) (?:job|listing))\b/i;
const businessClosed = /\b(?:permanently closed|temporarily closed|closed permanently|out of business|no longer (?:operating|in business)|business has closed|(?:company profile|business listing) (?:is |was )?(?:inactive|removed|unavailable))\b/i;
const videoClosed = /\b(?:video unavailable|(?:video|reel|post|content) (?:is )?(?:unavailable|no longer available|not available|private|removed|deleted)|this (?:video|reel|post) (?:has been|was) (?:removed|deleted)|available (?:only )?to (?:subscribers|members)|(?:this )?video is age.restricted|(?:is|video) not available in your country)\b/i;
const jobApply = /^\s*(?:[-*]\s+)?(?:apply(?: now| for this (?:job|position)| on company website)?|easy apply|apply externally|accepting applications)\s*[.!]?\s*$/im;
const jobDeadline = /\b(?:application deadline|apply by|validThrough|closing date)(?:\s+is\b)?[\s"':=–-]*((?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?|(?:[a-z]{3,9}\s+\d{1,2},?|\d{1,2}\s+[a-z]{3,9},?)\s+\d{4}))(?![\w:])/gi;
const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function deadlineTime(value) {
  if (/^\d{4}-/.test(value)) return sourceTime(value) + (value.length === 10 ? day : 0);
  const [first, second, year] = value.toLowerCase().replace(',', '').split(/\s+/);
  const [number, name] = /^\d/.test(first) ? [first, second] : [second, first];
  const month = months.findIndex((item) => item === name || item.slice(0, 3) === name) + 1;
  // Calendar-only dates are considered expired after the listed UTC day.
  return month ? sourceTime(`${year}-${String(month).padStart(2, '0')}-${number.padStart(2, '0')}`) + day : NaN;
}
const contactLink = /\[(?:visit (?:our |company )?website|website|contact (?:us|the company))\]\(https?:\/\//i;
const websiteField = /^\s*(?:#{1,6}\s*)?website\s*:?[\t ]*(?:\n\s*)?(?:www\.|https?:\/\/|\[[^\]\n]{1,140}\]\(https?:\/\/)/im;
const hours = /(?:^|\n)\s*(?:open 24 hours\s*(?:\n|$)|(?:open|closed)\s*(?:[·⋅•|–\-]\s*|\n\s*)(?:opens?|closes?)\s+\d)/i;
const videoSignals = {
  youtube: /\b\d[\d,.]*\s*[kmb]?\s+views\b|\bstreamed live (?:on|at)\b/i,
  tiktok: /\b\d[\d,.]*\s*[kmb]?\s+likes\b/i,
  instagram: /\b\d[\d,.]*\s*[kmb]?\s+likes\b|\bview all \d[\d,.]* comments\b/i,
};

// Look for positive evidence in the primary document, not an index title,
// sign-in screen or a recommendation for a different listing. Never turn the
// absence of a "closed" notice into a positive verdict by itself.
export function checkSnapshot(source, snapshot, window) {
  if (typeof snapshot !== 'string' || !snapshot.trim()) return { exclude: 'unconfirmed' };
  const main = snapshot.slice(0, 8000).split(secondary, 1)[0];
  const lines = main.replace(/\[([^\]\n]{1,160})\]\([^\s()]{1,950}(?: +"[^"\n]{1,120}")?\)/g, '$1').replace(/\*\*|__/g, '');
  // Keep negative status text even if a formatting token is malformed.
  const flat = main.replace(/\*\*|__/g, '').replace(/\s+/g, ' ');
  const near = (match, value = lines) => value.slice(Math.max(0, match.index - 110), match.index + match[0].length + 130);
  if (pageUnavailable.test(lines)) return { exclude: 'unavailable' };
  if (source === 'jobs') {
    if (jobClosed.test(flat) || /\b(?:do not|don['’]t) apply (?:for this (?:job|role)|now)\b/i.test(flat)) return { exclude: 'unavailable' };
    for (const [, value] of lines.matchAll(jobDeadline)) {
      if (deadlineTime(value) <= window.end) return { exclude: 'unavailable' };
    }
    const apply = jobApply.exec(lines.slice(0, 3200));
    if (apply && lines.trim().length >= 30) return { availability: 'application', evidence: near(apply) };
  } else if (source === 'companies' || source === 'maps') {
    if (businessClosed.test(flat)) return { exclude: 'unavailable' };
    const contact = source === 'companies' && (contactLink.exec(main) || websiteField.exec(main));
    if (contact) return { availability: 'contact', evidence: near(contact, main) };
    if (source === 'maps' && hours.test(lines)) return { availability: 'hours' };
  } else {
    if (videoClosed.test(flat)) return { exclude: 'unavailable' };
    const video = videoSignals[source]?.exec(lines);
    if (video) return { availability: 'publicVideo', evidence: near(video) };
  }
  return { exclude: 'unconfirmed' };
}
