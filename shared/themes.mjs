// Palettes are shared with the server so preferences and default branding are validated.
const dark = (label, hue, accent, art) => ({ label, mode: 'dark', hue, accent, art });
const light = (label, hue, accent, art) => ({ label, mode: 'light', hue, accent, art });
export const defaultTheme = 'signal';
export const themes = Object.freeze({
  signal: dark('Signal', 102, '#bafa62', 0),
  midnight: dark('Midnight', 225, '#8eb8ff', 135),
  amethyst: dark('Amethyst', 272, '#c7a7ff', 192),
  rosewood: dark('Rosewood', 346, '#ff9db2', 254),
  solar: dark('Solar Flare', 30, '#ffc480', -48),
  deepsea: dark('Deep Sea', 183, '#6ce4da', 95),
  copper: dark('Copper', 18, '#f3aa8e', -72),
  graphite: dark('Graphite', 215, '#dfecf9', 0),
  orchid: dark('Orchid', 302, '#ee9ded', 222),
  nord: dark('Nord Ice', 202, '#b0edff', 120),
  paper: light('Paper', 40, '#405aee', 148),
  mint: light('Mint', 150, '#128263', 68),
  lavender: light('Lavender', 270, '#7048b7', 184),
  sandstone: light('Sandstone', 33, '#9d522b', -56),
});
export const hasTheme = (id) => typeof id === 'string' && Object.hasOwn(themes, id);

export function themeStyle(id) {
  const { hue, mode, accent, art } = themes[hasTheme(id) ? id : defaultTheme];
  const d = mode === 'dark';
  const tint = id === 'graphite' ? 6 : 20;
  const hsl = (sat, l) => `hsl(${hue} ${sat}% ${l}%)`;
  return {
    colorScheme: mode,
    '--bg': hsl(tint, d ? 6 : 96), '--sidebar': hsl(tint, d ? 7.8 : 98), '--topbar': hsl(tint, d ? 7.2 : 98),
    '--panel': hsl(tint, d ? 9.6 : 99.5), '--field': hsl(tint, d ? 6.9 : 96), '--raised': hsl(tint, d ? 11.6 : 94),
    '--line': hsl(tint, d ? 17.5 : 87), '--line-strong': hsl(tint, d ? 24 : 76),
    '--ink': hsl(22, d ? 95 : 14), '--muted': hsl(12, d ? 71 : 33), '--quiet': hsl(11, d ? 64 : 37),
    '--lime': accent, '--lime-strong': `color-mix(in srgb, ${accent}, ${d ? 'white 18%' : 'black 13%'})`,
    '--ink-green': d ? '#14190e' : '#fff', '--accent-text': `color-mix(in srgb, ${accent}, ${d ? 'white 20%' : 'black 13%'})`,
    '--green-wash': `color-mix(in srgb, ${accent} ${d ? '13%' : '10%'}, var(--panel))`,
    '--danger': d ? '#ffaaa0' : '#9b2d23', '--warn': d ? '#eacd85' : '#775211',
    '--hero-hue': `${art}deg`, '--hero-sat': id === 'graphite' ? .1 : 1,
    '--hero-base': hsl(tint + 8, 12), '--hero-accent': d ? accent : '#e9f1ff',
    '--art-accent': d ? accent : '#eef2ff',
  };
}
