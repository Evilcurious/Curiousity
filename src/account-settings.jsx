import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BadgeCheck, Check, Cpu, Crown, Globe2, ImagePlus, Moon, Palette, Plug, RefreshCw, Search, Server, Shield, Sun, UserRound, Users } from 'lucide-react';
import { ActionLink, api, Banner, Button, Confirm, EmptyState, Glyph, PageHeading, PanelHeading } from './ui.jsx';
import { Logo } from './brand.jsx';
import { PasswordSettings } from './password-settings.jsx';
import { defaultTheme, themes, themeStyle } from '../shared/themes.mjs';

export const sections = [
  { id: 'account', label: 'Account', icon: UserRound, copy: 'Your sign-in and premium access.' },
  { id: 'appearance', label: 'Appearance', icon: Palette, copy: 'Pick a palette from 14 workspace themes.' },
  { id: 'providers', label: 'AI Providers', icon: Cpu, copy: 'Manage private AI keys and model profiles.' },
  { id: 'mcp', label: 'MCP servers', icon: Server, copy: 'Connect Buffer and other remote MCP tools.' },
  { id: 'integrations', label: 'Integrations', icon: Plug, copy: 'Connect your delivery accounts.' },
  { id: 'admin', label: 'Admin', icon: Shield, copy: 'Manage memberships and workspace branding.', admin: true },
];
const visibleSections = (user) => sections.filter((section) => !section.admin || user?.role === 'admin');
export function SettingsTabs({ tab, user }) {
  return <nav className="settings-tabs" aria-label="Settings sections">
    <a href="#/settings" aria-current={!tab ? 'page' : undefined}>Overview</a>
    {visibleSections(user).map(({ id, icon: Icon, label }) => <a href={`#/settings/${id}`} aria-current={tab === id ? 'page' : undefined} key={id}><Icon size={15}/>{label}</a>)}
  </nav>;
}

export function SettingsHome({ user, workspace, branding }) {
  const stats = {
    account: user.role === 'admin' ? 'Administrator' : user.premium ? 'Premium active' : 'Personal account',
    appearance: themes[user.theme || branding?.theme || defaultTheme]?.label, providers: `${workspace?.providers?.length || 0} personal profiles`,
    mcp: `${workspace?.mcps?.length || 0} saved servers`, integrations: `${Number(Boolean(workspace?.google?.connected)) + Number(Boolean(workspace?.tiktok?.connected)) + Number(Boolean(workspace?.mcps?.some((row) => row.kind === 'buffer' && row.checkedAt)))} connected`, admin: 'Workspace controls',
  };
  return <div className="view-enter">
    <PageHeading label="WORKSPACE / SETTINGS" title="Settings" subtitle="Manage your tools, connections, and how Curiousity looks. Credentials stay private to each account."/>
    <div className="settings-grid">{visibleSections(user).map(({ id, icon: Icon, label, copy }) => <a className="panel settings-card" key={id} href={`#/settings/${id}`}><div className="settings-card-top"><Glyph icon={Icon}/><ArrowRight size={17}/></div><h2>{label}</h2><p>{copy}</p><span>{stats[id]}</span></a>)}</div>
  </div>;
}

export function AccountSettings({ user, onSession, notify, signOut, signingOut, onPasswordChanged }) {
  const [busy, setBusy] = useState(false);
  const premium = user.role === 'admin' || user.premium;
  async function request() {
    setBusy(true);
    try { onSession(await api('/account/premium', { method: 'POST' })); notify('Premium request sent to the administrator.'); }
    catch (error) { notify(error.message, 'error'); }
    finally { setBusy(false); }
  }
  return <div className="view-enter">
    <PageHeading label="SETTINGS / ACCOUNT" title="Your account" subtitle="Your sign-in, plan, and workspace access."/>
    <section className="panel service-panel">
      <PanelHeading icon={UserRound} title="Account details" description={user.email}><Button onClick={signOut} busy={signingOut}>Sign out</Button></PanelHeading>
    </section>
    <PasswordSettings user={user} onChanged={onPasswordChanged}/>
    <section className="panel service-panel premium-panel">
      <PanelHeading icon={Crown} title={premium ? 'Premium is active' : 'Curiousity Premium'} description={premium ? 'Use models your administrator has made available, or continue with your own.' : 'Get access to approved AI models without adding an API key. Your administrator activates access.'}/>
      <p>Premium adds access to shared chat models for highlight ranking and caption translation. Personal API providers, transcription, and MCP servers remain separate.</p>
      {premium ? <ActionLink href="#/settings/providers" icon={Cpu}>View available AI models</ActionLink> : <Button tone="primary" icon={Crown} onClick={request} busy={busy} disabled={user.premiumRequested}>{user.premiumRequested ? 'Request pending' : 'Request premium'}</Button>}
    </section>
  </div>;
}

function ThemeChooser({ current, onChoose, disabled = false }) {
  return <div className="theme-grid" aria-label="Theme palettes" role="group">{Object.entries(themes).map(([id, theme]) => {
    const Mode = theme.mode === 'light' ? Sun : Moon;
    return <button type="button" className="theme-card" key={id} disabled={disabled} aria-pressed={current === id} onClick={() => onChoose(id)}>
      <span className="theme-swatch" style={themeStyle(id)} aria-hidden="true"><i/><b/><b/><em/></span>
      <span className="theme-label"><Mode size={13}/>{theme.label}{id === current && <Check size={14} className="theme-check"/>}</span>
    </button>;
  })}</div>;
}

export function Appearance({ user, branding, onSession, notify }) {
  const [busy, setBusy] = useState(false);
  async function select(theme) {
    if (theme === user.theme) return;
    setBusy(true);
    try { onSession(await api('/account/theme', { method: 'PUT', body: { theme } })); }
    catch (error) { notify(error.message, 'error'); }
    finally { setBusy(false); }
  }
  return <div className="view-enter">
    <PageHeading label="SETTINGS / APPEARANCE" title="Appearance" subtitle="Choose your personal palette. It follows your account on any device."><Button onClick={() => select(null)} disabled={!user.theme || busy}>Use workspace default</Button></PageHeading>
    {!user.theme && <p className="appearance-default"><BadgeCheck size={15}/> Following the workspace default</p>}
    <ThemeChooser current={user.theme || branding?.theme || defaultTheme} onChoose={select} disabled={busy}/>
  </div>;
}

async function pngLogo(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or WebP image under 4 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas'), ratio = Math.min(160 / bitmap.width, 160 / bitmap.height, 1);
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  } finally { bitmap.close(); }
}

export function AdminSettings({ user, branding, onBrand, notify }) {
  const [rows, setRows] = useState([]), [query, setQuery] = useState(''), [next, setNext] = useState(null), [canList, setCanList] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(''), [confirm, setConfirm] = useState(null), [confirmError, setConfirmError] = useState('');
  const fileRef = useRef(null);
  useEffect(() => {
    if (user.role !== 'admin') return;
    const controller = new AbortController();
    setLoading(true); setError(''); setCanList(false);
    const timer = setTimeout(() => {
      api(`/admin/accounts?q=${encodeURIComponent(query)}`, { signal: controller.signal }).then((data) => {
        setRows(data.users); setNext(data.next); setCanList(true);
      }).catch((err) => { if (!controller.signal.aborted) setError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, revision, user.role]);
  async function more() {
    const q = query;
    setBusy('more');
    try {
      const data = await api(`/admin/accounts?q=${encodeURIComponent(q)}&offset=${next}`);
      if (q === search.current) { setRows((prev) => [...prev, ...data.users]); setNext(data.next); }
    } catch (err) { notify(err.message, 'error'); }
    finally { setBusy(''); }
  }
  // Query ref is only needed to ignore a page arriving after a new search.
  const search = useRef(query);
  search.current = query;
  async function setPremium() {
    setBusy(confirm.id); setConfirmError('');
    try {
      const updated = await api(`/admin/accounts/${confirm.id}/premium`, { method: 'PUT', body: { premium: !confirm.premium } });
      setRows((previous) => previous.map((row) => row.id === updated.id ? updated : row));
      notify(updated.premium ? 'Premium activated.' : 'Premium access removed.'); setConfirm(null);
    } catch (err) { setConfirmError(err.message); }
    finally { setBusy(''); }
  }
  async function saveBrand(theme, file) {
    setBusy('brand');
    try {
      const logo = file === undefined ? undefined : file === null ? null : await pngLogo(file);
      onBrand(await api('/admin/branding', { method: 'PUT', body: { theme, logo } }));
      notify('Workspace branding updated.');
    } catch (err) { notify(err.message, 'error'); }
    finally { setBusy(''); }
  }
  if (user.role !== 'admin') return <div className="panel"><EmptyState icon={Shield} title="Admin access required">This page is only available to the workspace administrator.</EmptyState></div>;
  return <div className="view-enter">
    <PageHeading label="SETTINGS / ADMIN" title="Workspace admin" subtitle="Approve premium access and manage the brand seen by every member."/>
    <section className="panel service-panel">
      <PanelHeading icon={Users} title="Member access" description="Premium is granted here. No billing or checkout is connected."><Button icon={RefreshCw} onClick={() => setRevision((n) => n + 1)} disabled={loading || Boolean(busy)}>Refresh</Button></PanelHeading>
      <label className="search-field admin-search"><Search size={16}/><input type="search" aria-label="Search accounts" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find an account by email…"/></label>
      {error && <Banner>{error}</Banner>}
      {loading && <p className="muted admin-search" role="status">Loading accounts…</p>}
      {!loading && canList && !rows.length && <p className="muted admin-search">No accounts match this search.</p>}
      {!loading && rows.map((row) => <div className="connection-row admin-row" key={row.id}><div><strong>{row.email}</strong><p>{row.role === 'admin' ? 'Administrator' : row.premium ? 'Premium active' : row.premiumRequested ? 'Premium requested' : 'Standard'}</p></div>{row.role !== 'admin' && <Button icon={row.premium ? null : Crown} onClick={() => { setConfirmError(''); setConfirm(row); }}>{row.premium ? 'Remove premium' : 'Activate premium'}</Button>}</div>)}
      {!loading && next !== null && <Button className="admin-search" busy={busy === 'more'} onClick={more}>Show more accounts</Button>}
      <p className="privacy-note"><Cpu size={15}/><span>Share individual chat models under <a href="#/settings/providers">AI Providers</a>. Members never receive the stored key.</span></p>
    </section>
    <section className="panel service-panel branding-panel">
      <PanelHeading icon={Globe2} title="Workspace branding" description="Change the logo and the default theme. Personal theme choices are kept."/>
      <div className="connection-row logo-controls"><Logo branding={branding}/><div><strong>Workspace logo</strong><p>Used in the sidebar and on sign-in and sign-up.</p></div><div className="connection-actions"><Button icon={ImagePlus} onClick={() => fileRef.current?.click()} busy={busy === 'brand'}>Upload logo</Button>{branding?.logoUrl && <Button disabled={busy === 'brand'} onClick={() => saveBrand(branding.theme, null)}>Restore original</Button>}</div><input type="file" ref={fileRef} accept="image/png,image/jpeg,image/webp" aria-label="Upload logo file" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) saveBrand(branding?.theme || defaultTheme, file); }}/></div>
      <h3>Default theme</h3><ThemeChooser current={branding?.theme || defaultTheme} onChoose={(theme) => saveBrand(theme)} disabled={busy === 'brand'}/>
    </section>
    {confirm && <Confirm title={`${confirm.premium ? 'Remove premium from' : 'Activate premium for'} this account?`} message={`${confirm.email} ${confirm.premium ? 'will lose access to administrator-provided AI models.' : 'will be able to use the chat models you share with premium members.'}`} label={confirm.premium ? 'Remove premium' : 'Activate premium'} onClose={() => setConfirm(null)} onConfirm={setPremium} busy={busy === confirm.id} error={confirmError} danger={confirm.premium}/>}
  </div>;
}
