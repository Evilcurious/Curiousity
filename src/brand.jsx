import { defaultTheme, hasTheme, themes, themeStyle } from '../shared/themes.mjs';

export function Logo({ branding, className = '' }) {
  return <span className={`brand-mark ${className}`} aria-hidden="true">{branding?.logoUrl ? <img src={branding.logoUrl} alt=""/> : <svg width="64" height="64" viewBox="0 0 64 64" fill="none"><path d="M44 16A21 21 0 1 0 47 44" stroke="currentColor" strokeWidth="7" strokeLinecap="round"/><path d="M48 12c.9 8.4 3.7 11.2 12 12-8.3.9-11.1 3.7-12 12-.9-8.3-3.7-11.1-12-12 8.3-.8 11.1-3.6 12-12Z" fill="currentColor"/><circle cx="32" cy="32" r="3" fill="currentColor" opacity=".66"/></svg>}</span>;
}

export function Wordmark({ branding }) {
  return <><Logo branding={branding}/><span>Curiousity<span className="brand-dot">.</span></span></>;
}

export function applyBrand(branding, personal) {
  const id = hasTheme(personal) ? personal : branding?.theme || defaultTheme;
  const root = document.documentElement;
  root.dataset.theme = id;
  root.dataset.mode = themes[id]?.mode || 'dark';
  for (const [key, value] of Object.entries(themeStyle(id))) {
    if (key.startsWith('--')) root.style.setProperty(key, value);
    else root.style[key] = value;
  }
  const icon = document.querySelector('link[rel="icon"]');
  icon?.setAttribute('href', branding?.logoUrl || '/favicon.svg');
  icon?.setAttribute('type', branding?.logoUrl ? 'image/png' : 'image/svg+xml');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', root.style.getPropertyValue('--bg'));
}
