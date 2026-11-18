export const discoveryNames = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram Reels', jobs: 'LinkedIn Jobs', companies: 'LinkedIn Companies', maps: 'Google Maps' };
export const reachSources = ['youtube', 'tiktok', 'instagram'];
export const leadSources = ['companies', 'maps'];
export const reachWindows = [7, 30, 90];
export const discoveryLimits = { query: 180, location: 100 };
export const coverageLabels = { found: 'Results found', empty: 'No matches', limited: 'Rate limited', unavailable: 'Unavailable' };

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
