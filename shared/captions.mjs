export const captionFonts = Object.freeze({
  auto: { label: 'Automatic', family: 'DejaVu Sans' },
  sans: { label: 'Bold sans', family: 'DejaVu Sans' },
  serif: { label: 'Editorial serif', family: 'DejaVu Serif' },
  mono: { label: 'Monospace', family: 'DejaVu Sans Mono' },
});

export const captionEffects = Object.freeze({
  outline: { label: 'Outline', color: '#f5fff7', edge: '#0a100b', outline: 3.5, shadow: 1 },
  shadow: { label: 'Drop shadow', color: '#fff7e7', edge: '#120e08', outline: 1.6, shadow: 4.5 },
  glow: { label: 'Lime glow', color: '#cdff8b', edge: '#172f08', glow: '#72dc2a', outline: 2.7, shadow: 4.5 },
  box: { label: 'Dark box', color: '#ffffff', edge: '#101710', outline: 4.5, shadow: 0, box: true },
  sky: { label: 'Sky blue', color: '#a6dcff', edge: '#0c1931', outline: 2, shadow: 1, highlight: '#61aaff', rest: '#f6faff' },
  orange: { label: 'Orange glow', color: '#ffd275', edge: '#4b2106', glow: '#ff7918', outline: 2.1, shadow: 4 },
  green: { label: 'Clear green', color: '#bafb89', edge: '#123312', glow: '#4bd640', outline: 2.4, shadow: 3.4, highlight: '#8cff55', rest: '#f6fff3' },
  focus: { label: 'Blue label', color: '#e4f6ff', edge: '#13334e', outline: 6.5, shadow: 0, box: true },
  electric: { label: 'Electric blue', color: '#74bbff', edge: '#182356', glow: '#397dff', outline: 2.8, shadow: 3.5, highlight: '#7bd9ff', rest: '#f2f5ff' },
  frost: { label: 'Soft ice', color: '#b9e4ff', edge: '#152445', glow: '#6fa9e8', outline: 1.4, shadow: 3 },
  aqua: { label: 'Aqua glow', color: '#84fff0', edge: '#063834', glow: '#1bcfcb', outline: 2.5, shadow: 3.8 },
  tape: { label: 'Tape white', color: '#faf8ff', edge: '#361843', glow: '#5bdaff', outline: 1.5, shadow: 3.8 },
  gold: { label: 'Spotlight gold', color: '#ffe677', edge: '#3c2b0c', outline: 2.7, shadow: 1.5, highlight: '#ffda51', rest: '#fff9e5' },
  ember: { label: 'Rising amber', color: '#ffab62', edge: '#4c2218', glow: '#ff6234', outline: 3, shadow: 4.5 },
  honey: { label: 'Honey shadow', color: '#ffc15e', edge: '#321b13', outline: 2, shadow: 5.4 },
  digital: { label: 'Digital violet', color: '#efacf8', edge: '#370a44', glow: '#e142fb', outline: 2.4, shadow: 3.2 },
  mint: { label: 'Fresh mint', color: '#baf5d2', edge: '#11392a', glow: '#58cc94', outline: 2, shadow: 3, highlight: '#96f6b6', rest: '#eefcf3' },
});

export const captionSizes = Object.freeze({
  small: { label: 'Small', scale: 0.047 }, medium: { label: 'Medium', scale: 0.057 }, large: { label: 'Large', scale: 0.072 },
});

export const captionAnimations = Object.freeze({
  none: { label: 'None' },
  fade: { label: 'Fade in' },
  pop: { label: 'Pop' },
  rise: { label: 'Rise' },
  highlight: { label: 'Word highlight' },
  wave: { label: 'Wave in' },
  rotate: { label: 'Rotate in' },
  flicker: { label: 'Tape flicker' },
});

export const captionExitAnimations = Object.freeze({
  none: { label: 'None' },
  fade: { label: 'Fade out' },
  shrink: { label: 'Shrink out' },
});

export const captionStyleOptions = Object.freeze({ font: captionFonts, effect: captionEffects, size: captionSizes, animation: captionAnimations, exitAnimation: captionExitAnimations });
export const defaultCaptionStyle = Object.freeze({ font: 'auto', effect: 'outline', size: 'medium', animation: 'none', exitAnimation: 'none' });
export const highlightColor = '#c7ff76';
export const highlightRestColor = '#f5fff7';

const preset = (label, sample, effect, style = {}) => Object.freeze({ label, sample, style: Object.freeze({ ...defaultCaptionStyle, effect, ...style }) });
export const captionPresets = Object.freeze({
  minimal: preset('Minimal Style', ['less is', 'more.'], 'sky', { size: 'small', animation: 'fade' }),
  orange: preset('Orange', ['golden hour'], 'orange', { animation: 'pop' }),
  green: preset('Clear Green', ['clear', 'green'], 'green', { animation: 'highlight' }),
  focused: preset('Text Focused', ['stay focused'], 'focus', { size: 'small' }),
  vibrant: preset('Modern Vibrant', ['modern', 'vibrant'], 'electric', { animation: 'highlight', size: 'large', exitAnimation: 'shrink' }),
  soft: preset('Soft Motion', ['soft motion'], 'frost', { font: 'serif', animation: 'fade', exitAnimation: 'fade' }),
  wave: preset('Wave', ['ride the wave'], 'aqua', { animation: 'wave' }),
  vhs: preset('VHS', ['PLAY ▷'], 'tape', { font: 'mono', animation: 'flicker', size: 'small' }),
  spotlight: preset('Text Spotlight', ['text', 'spotlight'], 'gold', { animation: 'highlight', size: 'large' }),
  rising: preset('Energy Rising', ['energy', 'rising'], 'ember', { animation: 'rise', size: 'large' }),
  rotating: preset('Dynamic Rotating', ['keep it', 'rotating'], 'honey', { animation: 'rotate' }),
  future: preset('Future Digital', ['future', 'digital'], 'digital', { font: 'mono', animation: 'flicker', exitAnimation: 'shrink' }),
  mint: preset('Fresh Mint', ['fresh', 'mint'], 'mint', { animation: 'highlight', exitAnimation: 'fade' }),
});

export function matchingPreset(input) {
  const style = resolveCaptionStyle(input);
  return Object.keys(captionPresets).find((key) => sameCaptionStyle(style, captionPresets[key].style)) || '';
}

export function sameCaptionStyle(a, b) {
  return Boolean(a && b) && Object.keys(captionStyleOptions).every((key) => a[key] === b[key]);
}

const scriptFonts = Object.freeze({ ar: 'Noto Sans Arabic', ur: 'Noto Sans Arabic', hi: 'Noto Sans Devanagari', bn: 'Noto Sans Bengali' });
export const captionScriptFont = (language) => Object.hasOwn(scriptFonts, language) ? scriptFonts[language] : null;
export const captionFontFamily = (style, language) => captionScriptFont(language) || captionFonts[style.font].family;
export const captionBottom = (width, height) => height > width ? .175 : .105;

export function resolveCaptionStyle(input) {
  return Object.fromEntries(Object.entries(captionStyleOptions).map(([key, choices]) => {
    const value = input?.[key];
    return [key, typeof value === 'string' && Object.hasOwn(choices, value) ? value : defaultCaptionStyle[key]];
  }));
}

export function captionStyleLabel(input) {
  const { font, effect, animation, exitAnimation } = resolveCaptionStyle(input);
  return [font !== 'auto' && captionFonts[font].label, captionEffects[effect].label, animation !== 'none' && captionAnimations[animation].label, exitAnimation !== 'none' && captionExitAnimations[exitAnimation].label].filter(Boolean).join(' · ');
}
