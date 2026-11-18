import { languageLabel } from '../shared/exports.mjs';
import { translateWithProvider } from './providers.mjs';

export async function localizeClips({ original, sourceLanguage, target, provider, store, tryTrack, tryEnglish, signal }) {
  const fallback = { tracks: original, language: sourceLanguage || null };
  if (!target || target === 'source' || target === sourceLanguage) return fallback;
  const usable = (result) => result && result.tracks.some((rows) => rows.length) && result.tracks.every((rows, i) => !original[i].length || rows.length);
  const fromTrack = await tryTrack();
  if (usable(fromTrack)) return { ...fromTrack, language: target };
  if (provider?.model && original.some((rows) => rows.length)) {
    try {
      const tracks = await translateWithProvider(provider, store, target, original, signal);
      return { tracks, language: target, label: `${provider.name} translation` };
    } catch (error) { if (signal.aborted) throw signal.reason; }
  }
  if (target === 'en' && tryEnglish) {
    const english = await tryEnglish();
    if (usable(english)) return { ...english, language: 'en' };
  }
  return { ...fallback, warning: original.some((rows) => rows.length)
    ? `Could not produce ${languageLabel(target)} captions. Original captions were used.${provider?.model ? ' The selected provider did not return a usable translation.' : ' Select an AI chat model in AI Providers when a translated source track is unavailable.'}`
    : `No usable captions were available in ${languageLabel(target)}.` };
}

const tags = {
  en: ['Highlights', 'ShortVideo', 'LiveHighlights'], ur: ['جھلکیاں', 'مختصرویڈیو', 'لائیوجھلکیاں'], hi: ['झलकियाँ', 'छोटावीडियो', 'लाइवझलकियाँ'],
  ar: ['أبرز_اللحظات', 'فيديو_قصير', 'لقطات_البث'], bn: ['সেরামুহূর্ত', 'ছোটভিডিও', 'লাইভঝলক'], zh: ['精彩片段', '短视频', '直播精华'],
  fr: ['TempsForts', 'VidéoCourte', 'ExtraitDuDirect'], de: ['Höhepunkte', 'Kurzvideo', 'LivestreamHighlights'], id: ['MomenTerbaik', 'VideoPendek', 'SorotanSiaran'],
  it: ['MomentiMigliori', 'VideoBreve', 'MomentiDellaDiretta'], ja: ['見どころ', '短い動画', '配信切り抜き'], ko: ['하이라이트', '짧은영상', '라이브하이라이트'],
  pt: ['MelhoresMomentos', 'VídeoCurto', 'DestaquesDaLive'], ru: ['ЛучшиеМоменты', 'КороткоеВидео', 'МоментыЭфира'],
  es: ['MejoresMomentos', 'VideoCorto', 'MomentosDelDirecto'], tr: ['ÖneÇıkanlar', 'KısaVideo', 'CanlıYayınKesiti'],
};
const stop = new Set('about across after again almost along already always another around before being between both came could does doing each first from have here into just last less made many might more most much must never next only other ours over said same should some such take than that their them then there these they thing this those through time very want were what when where which while will with without would your para como pero este esta esto sobre hace todo todos toda cuando donde vous dans pour avec cela nous elle plus être eine einer eines mich nach sich über oder'.split(' '));

export function suggestHashtags({ choice, transcriptLanguage, localizedLanguage, excerpt, translated, live }) {
  if (choice === 'off') return { hashtags: [], hashtagLanguage: null };
  const requested = choice && choice !== 'source' ? choice : transcriptLanguage;
  const hashtagLanguage = Object.hasOwn(tags, requested) ? requested : 'en';
  const base = tags[hashtagLanguage];
  const topical = localizedLanguage === hashtagLanguage ? translated || excerpt : transcriptLanguage === hashtagLanguage ? excerpt : '';
  const terms = new Map();
  if (topical) {
    const words = new Intl.Segmenter(hashtagLanguage, { granularity: 'word' }).segment(topical);
    for (const { segment, isWordLike } of words) {
      if (!isWordLike) continue;
      const word = segment.toLocaleLowerCase(hashtagLanguage);
      const min = ['zh', 'ja', 'ko'].includes(hashtagLanguage) ? 2 : 4;
      if (word.length < min || word.length > 26 || !/^\p{L}[\p{L}\p{M}\p{N}]+$/u.test(word) || stop.has(word)) continue;
      terms.set(word, (terms.get(word) || 0) + 1);
    }
  }
  const topicTags = [...terms].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([word]) => word);
  return { hashtagLanguage, hashtags: [...new Set([...topicTags, base[0], base[1], ...(live ? [base[2]] : [])])].map((tag) => `#${tag}`) };
}
