import { captionBottom, captionEffects, captionFontFamily, captionSizes, highlightColor, highlightRestColor, resolveCaptionStyle } from '../shared/captions.mjs';

const pad = (n) => String(n).padStart(2, '0');
const ticksAt = (seconds, precision) => Math.max(0, Math.round(seconds * precision));
function timestamp(seconds, ass = false) {
  const precision = ass ? 100 : 1000, ticks = ticksAt(seconds, precision);
  const h = Math.floor(ticks / (precision * 3600)), m = Math.floor(ticks / (precision * 60)) % 60, s = Math.floor(ticks / precision) % 60;
  return `${ass ? h : pad(h)}:${pad(m)}:${pad(s)}${ass ? '.' : ','}${String(ticks % precision).padStart(ass ? 2 : 3, '0')}`;
}
export const makeSrt = (rows) => rows.map((cue, index) => `${index + 1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}\n`).join('\n');

const bgr = (hex) => `${hex.slice(5)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toUpperCase();
const assColor = (hex, alpha = '00') => `&H${alpha}${bgr(hex)}`;
const assText = (value) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').replaceAll('\\', '＼').replaceAll('{', '(').replaceAll('}', ')');

function motion({ animation, exitAnimation }, duration, width, height, marginBottom) {
  const fadeIn = animation === 'fade' ? Math.min(170, Math.round(duration * .25)) : 0;
  const fadeOut = exitAnimation === 'fade' ? Math.min(200, Math.round(duration * .24)) : 0;
  let tags = fadeIn || fadeOut ? `\\fad(${fadeIn},${fadeOut})` : '';
  if (animation === 'pop') {
    const bump = Math.min(110, Math.round(duration * .28));
    const settle = Math.min(230, Math.round(duration * .55));
    tags += `\\fscx80\\fscy80\\t(0,${bump},\\fscx107\\fscy107)\\t(${bump},${settle},\\fscx100\\fscy100)`;
  } else if (animation === 'rise') {
    const x = Math.round(width / 2), y = height - marginBottom;
    tags += `\\move(${x},${y + Math.round(height * .024)},${x},${y},0,${Math.min(210, Math.round(duration * .45))})`;
  }
  if (exitAnimation === 'shrink') {
    const start = duration - Math.min(210, Math.round(duration * .28));
    tags += `\\t(${start},${duration},\\fscx72\\fscy72\\alpha&HFF&)`;
  }
  return tags;
}

function karaoke(value, durationCs, language) {
  let parts = value.trim().match(/\S+\s*/gu) || [];
  if (parts.length === 1 && ['zh', 'ja', 'ko'].includes(language)) {
    // Keep punctuation attached to a nearby word so it has no timing of its own.
    parts = [];
    for (const { segment, isWordLike } of new Intl.Segmenter(language, { granularity: 'word' }).segment(value)) {
      if (!isWordLike && parts.length) parts[parts.length - 1] += segment;
      else parts.push(segment);
    }
  }
  if (!parts.length || durationCs < parts.length) return assText(value);
  return parts.map((part, index) => {
    const interval = Math.round((index + 1) * durationCs / parts.length) - Math.round(index * durationCs / parts.length);
    return `{\\k${interval}}${assText(part)}`;
  }).join('');
}

export function makeAss(rows, { width = 720, height = 1280 } = {}, language, styleInput) {
  const style = resolveCaptionStyle(styleInput);
  const face = captionFontFamily(style, language);
  const effect = captionEffects[style.effect];
  const highlight = style.animation === 'highlight';
  const primary = highlight ? highlightColor : effect.color;
  const secondary = highlight ? highlightRestColor : effect.color;
  const size = Math.max(16, Math.round(Math.min(width, height) * captionSizes[style.size].scale));
  const margin = Math.round(width * .08);
  const bottom = Math.round(height * captionBottom(width, height));
  const softGlow = effect.glow ? `\\4c&H${bgr(effect.glow)}&\\4a&H48&\\blur1.4` : '';
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${face},${size},${assColor(primary)},${assColor(secondary)},${assColor(effect.edge)},${assColor(effect.edge, '76')},-1,0,0,0,100,100,0,0,${effect.box ? 3 : 1},${effect.outline},${effect.shadow},2,${margin},${margin},${bottom},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${rows.map((cue) => {
    const durationCs = ticksAt(cue.end, 100) - ticksAt(cue.start, 100);
    const tags = softGlow + motion(style, durationCs * 10, width, height, bottom);
    const text = highlight ? karaoke(cue.text, durationCs, language) : assText(cue.text);
    return `Dialogue: 0,${timestamp(cue.start, true)},${timestamp(cue.end, true)},Default,,0,0,0,,${tags ? `{${tags}}` : ''}${text}`;
  }).join('\n')}
`;
}
