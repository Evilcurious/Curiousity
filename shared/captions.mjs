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
