export const discoveryNames = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram Reels', jobs: 'LinkedIn Jobs', companies: 'LinkedIn Companies', maps: 'Google Maps' };
export const reachSources = ['youtube', 'tiktok', 'instagram'];
export const leadSources = ['companies', 'maps'];
export const discoveryWindows = [1, 2, 4, 7];
export const defaultDiscoveryDays = 7;
export const discoveryLimits = { query: 180, location: 100, days: 365 };
export const discoveryVerificationVersion = 1;
export const coverageLabels = { found: 'Results found', empty: 'No matches passed', limited: 'Rate limited', unavailable: 'Unavailable' };
export const availabilityLabels = { application: 'Application option visible', contact: 'Public contact link shown', hours: 'Opening hours shown', publicVideo: 'Public video listing' };
export const reviewLabels = { complete: 'AI review complete', failed: 'AI review unavailable', skipped: 'No matches to review', source_only: 'Source checks only' };
export const lookbackLabel = (days) => `Last ${days} ${days === 1 ? 'day' : 'days'}`;

const exclusions = { undated: 'missing a date', outsideWindow: 'outside the date range', unavailable: 'closed or restricted', unconfirmed: 'availability not confirmed', review: 'not cleared by AI review' };
export function exclusionSummary(totals) {
  return Object.entries(exclusions).filter(([key]) => totals?.[key]).map(([key, label]) => `${totals[key]} ${label}`).join(' · ');
}

export function browseFinder(source, query, location) {
  const text = [query, location].filter(Boolean).join(' ');
  if (source === 'maps') return `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query: text })}`;
  if (source === 'companies') return `https://www.linkedin.com/search/results/companies/?${new URLSearchParams({ keywords: text })}`;
  return `https://www.linkedin.com/jobs/search/?${new URLSearchParams({ keywords: query, ...(location ? { location } : {}) })}`;
}

// Only divert explicit requests. Unrelated questions about LinkedIn still go
// to the selected model. An empty string opens Finder without a search term.
export function finderCommand(raw) {
  const prompt = raw.trim();
  const command = prompt.match(/^\/finder(?:\s+([\s\S]*))?$/i);
  if (command) return (command[1] || '').trim();
  const jobs = prompt.match(/^(?:please\s+)?(?:find|search\s+for)(?:\s+me)?\s+(?:(.*?)\s+)?jobs\s+on\s+linkedin(?:\s+(.+?))?[.!?]*$/i);
  return jobs ? [jobs[1], jobs[2]].filter(Boolean).join(' ') : null;
}
