export const platforms = Object.freeze({
  universal: { name: 'Universal', detail: 'Any destination', ratio: '9:16' },
  tiktok: { name: 'TikTok', detail: 'Vertical video', ratio: '9:16' },
  instagram: { name: 'Instagram Reels', detail: 'Vertical Reels', ratio: '9:16' },
  facebook: { name: 'Facebook Reels', detail: 'Vertical Reels', ratio: '9:16' },
  youtube: { name: 'YouTube Shorts', detail: 'Vertical Shorts', ratio: '9:16' },
  'youtube-landscape': { name: 'YouTube video', detail: 'Landscape video', ratio: '16:9' },
});

export const ratioChoices = [
  { value: '9:16', name: 'Vertical' }, { value: '4:5', name: 'Portrait' }, { value: '1:1', name: 'Square' }, { value: '16:9', name: 'Landscape' },
];

export const languages = Object.freeze({
  en: 'English', ur: 'Urdu', hi: 'Hindi', ar: 'Arabic', bn: 'Bengali', zh: 'Chinese', fr: 'French', de: 'German', id: 'Indonesian', it: 'Italian', ja: 'Japanese', ko: 'Korean', pt: 'Portuguese', ru: 'Russian', es: 'Spanish', tr: 'Turkish',
});

export function frameFor(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,3})\s*[:x×/]\s*(\d{1,3})$/i);
  if (!match) return null;
  const width = Number(match[1]), height = Number(match[2]);
  if (Math.min(width, height) < 1 || Math.max(width, height) > 100 || width / height > 4 || height / width > 4) return null;
  let a = width, b = height;
  while (b) [a, b] = [b, a % b];
  const scale = 1280 / Math.max(width, height);
  return { ratio: `${width / a}:${height / a}`, width: 2 * Math.round(width * scale / 2), height: 2 * Math.round(height * scale / 2) };
}

export function exportFrame(options = {}) {
  const platform = Object.hasOwn(platforms, options.platform) ? platforms[options.platform] : platforms.universal;
  return frameFor(options.aspectRatio) || frameFor(platform.ratio);
}

export function languageCode(value) {
  const cleaned = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const ISO = cleaned.match(/^([a-z]{2})(?:[-_].+)?$/)?.[1];
  return ISO || Object.entries(languages).find(([, name]) => name.toLowerCase() === cleaned)?.[0] || null;
}

export function languageLabel(value, fallback = 'Original') {
  if (value === 'off') return 'Off';
  return Object.hasOwn(languages, value) ? languages[value] : value && value !== 'source' ? value.toUpperCase() : fallback;
}
