export const discoveryNames = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram Reels' };
export const reachSources = ['youtube', 'tiktok', 'instagram'];
export const discoveryWindows = [1, 2, 4, 7];
export const defaultDiscoveryDays = 7;
export const discoveryLimits = { query: 180, days: 365 };
export const discoveryVerificationVersion = 1;
export const coverageLabels = { found: 'Results found', empty: 'No matches passed', limited: 'Rate limited', unavailable: 'Unavailable' };
export const availabilityLabels = { publicVideo: 'Public video listing' };
export const reviewLabels = { complete: 'AI review complete', failed: 'AI review unavailable', skipped: 'No matches to review', source_only: 'Source checks only' };
export const lookbackLabel = (days) => `Last ${days} ${days === 1 ? 'day' : 'days'}`;

const exclusions = { undated: 'missing a date', outsideWindow: 'outside the date range', unavailable: 'unavailable or restricted', unconfirmed: 'availability not confirmed', review: 'not cleared by AI review' };
export function exclusionSummary(totals) {
  return Object.entries(exclusions).filter(([key]) => totals?.[key]).map(([key, label]) => `${totals[key]} ${label}`).join(' · ');
}
