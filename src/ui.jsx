import { useEffect, useId, useRef } from 'react';
import { AlertCircle, ArrowRight, Check, LoaderCircle, X } from 'lucide-react';

export const ACTIVE = new Set(['queued', 'fetching', 'downloading', 'capturing', 'analyzing', 'rendering']);
export const STATES = { queued: 'In queue', fetching: 'Checking source', downloading: 'Downloading', capturing: 'Capturing live', analyzing: 'Analyzing', rendering: 'Rendering', ready: 'Ready', failed: 'Failed', cancelled: 'Stopped' };
export const POSTING = { queued: 'Queued for TikTok', uploading: 'Uploading to TikTok', processing: 'TikTok processing', sent: 'Sent to TikTok inbox', failed: 'TikTok upload failed', unconfirmed: 'Delivery not confirmed' };
export const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
export function timecode(sec) {
  if (!Number.isFinite(sec)) return '00:00';
  const seconds = Math.max(0, Math.floor(sec));
  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(seconds / 3600);
  return `${h ? `${h}:` : ''}${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

export async function api(path, opts = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, { method: opts.method || 'GET', signal: opts.signal, headers: { 'X-Clipforge': 'workspace', ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  } catch (error) {
    if (opts.signal?.aborted || error.name === 'AbortError') throw error;
    throw new Error('Cannot reach the Curiousity engine. Check that the server is running.');
  }
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw Object.assign(new Error(payload?.error || 'The Curiousity engine could not complete the request.'), { status: response.status });
  return payload;
}

export function TikTokIcon({ size = 18, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d="M14.5 3v12.25a4.5 4.5 0 1 1-4.5-4.5h.5v3.1H10a1.4 1.4 0 1 0 1.4 1.4V3z"/><path d="M14.5 3c.4 2.8 2.4 4.7 5.25 5v3.15A8.3 8.3 0 0 1 14.5 9"/></svg>;
}
export function Glyph({ icon: Icon, subtle = false, className = '' }) { return <span className={`glyph ${subtle ? 'glyph-subtle' : ''} ${className}`}><Icon size={19} strokeWidth={1.7}/></span>; }
export function PanelHeading({ icon, title, description, children }) {
  return <div className="panel-heading"><Glyph icon={icon}/><div className="panel-heading-text"><h2>{title}</h2>{description && <p>{description}</p>}</div>{children && <div className="panel-heading-actions">{children}</div>}</div>;
}
export function PageHeading({ label, title, subtitle, children }) {
  return <header className="page-heading"><div>{label && <p className="eyebrow">{label}</p>}<h1>{title}</h1>{subtitle && <p className="page-description">{subtitle}</p>}</div>{children && <div className="page-actions">{children}</div>}</header>;
}
export function Button({ icon: Icon, busy, tone = 'neutral', children, className = '', ...props }) {
  return <button type="button" className={`button button-${tone} ${className}`} {...props} disabled={props.disabled || busy}>{busy ? <LoaderCircle size={16} className="spin"/> : Icon && <Icon size={16}/>}<span>{children}</span></button>;
}
export function ActionLink({ href, icon: Icon, tone = 'neutral', children, className = '', ...props }) {
  return <a className={`button button-${tone} ${className}`} href={href} {...props}>{Icon && <Icon size={16}/>}<span>{children}</span></a>;
}
export function TextLink({ href, children }) { return <a className="text-link" href={href}>{children}<ArrowRight size={15}/></a>; }
export function Switch({ enabled, label, onChange }) {
  return <button type="button" className={`switch ${enabled ? 'is-on' : ''}`} role="switch" aria-checked={enabled} aria-label={label} onClick={() => onChange(!enabled)}><span>{enabled && <Check size={11} strokeWidth={2.8}/>}</span></button>;
}
export function JobBadge({ state }) { return <span className={`badge job-badge ${state === 'ready' ? 'badge-green' : state === 'failed' ? 'badge-error' : ACTIVE.has(state) ? 'badge-green' : ''}`}><i/>{STATES[state] || state}</span>; }
export function Banner({ children, tone = 'error', icon: Icon = AlertCircle }) { return <div className={`banner ${tone}`} role={tone === 'error' ? 'alert' : undefined}><Icon size={17}/><div>{children}</div></div>; }

export function Modal({ title, subtitle, onClose, children, wide = false }) {
  const ref = useRef(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog.showModal();
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { dialog.close(); document.body.style.overflow = original; previous?.focus?.(); };
  }, []);
  return <dialog className={`modal ${wide ? 'modal-wide' : ''}`} ref={ref} aria-labelledby={id} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); } }}>
    <div className="modal-heading"><div><h2 id={id}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={19}/></button></div>
    {children}
  </dialog>;
}

export function Confirm({ title, message, label, onClose, onConfirm, busy, error, danger = true }) {
  return <Modal title={title} subtitle={message} onClose={onClose}>
    {error && <Banner>{error}</Banner>}
    <div className="modal-actions"><Button onClick={onClose}>Cancel</Button><Button tone={danger ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>{label}</Button></div>
  </Modal>;
}
export function EmptyState({ icon, title, children, action }) { return <div className="empty-state"><Glyph icon={icon}/><h2>{title}</h2><p>{children}</p>{action}</div>; }
