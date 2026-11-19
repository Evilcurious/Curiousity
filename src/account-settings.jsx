import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BadgeCheck, Check, Cpu, Crown, Globe2, ImagePlus, KeyRound, Moon, Palette, Plug, RefreshCw, Search, Shield, Sun, UserRound, Users } from 'lucide-react';
import { ActionLink, api, Banner, Button, EmptyState, Glyph, Modal, PageHeading, PanelHeading } from './ui.jsx';
import { Logo } from './brand.jsx';
import { PasswordSettings } from './password-settings.jsx';
import { defaultTheme, themes, themeStyle } from '../shared/themes.mjs';
import { limitLabels, overrideMax, planLabel, plans } from '../shared/membership.mjs';
import { PlanPicker, PlanUsage } from './membership.jsx';
import { Field, Select } from './forms.jsx';
import { ComposioAdmin } from './composio.jsx';

export const sections = [
  { id: 'account', label: 'Account', icon: UserRound, copy: 'Your sign-in, membership and limits.' },
  { id: 'appearance', label: 'Appearance', icon: Palette, copy: 'See the theme your administrator set.' },
  { id: 'providers', label: 'AI Providers', icon: Cpu, copy: 'Manage private AI keys and model profiles.' },
  { id: 'integrations', label: 'Integrations', icon: Plug, copy: 'Connect your own apps to Chat.' },
  { id: 'admin', label: 'Admin', icon: Shield, copy: 'Configure Composio, memberships and branding.', admin: true },
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
    account: planLabel(user.plan?.id),
    appearance: themes[branding?.theme || defaultTheme]?.label, providers: `${workspace?.providers?.length || 0} personal profiles`,
    integrations: workspace?.composio?.ready ? 'Powered by Composio' : 'App connections', admin: 'Workspace controls',
  };
  return <div className="view-enter">
    <PageHeading label="WORKSPACE / SETTINGS" title="Settings" subtitle="Manage your tools, connections, and how Curiousity looks. Credentials stay private to each account."/>
    <div className="settings-grid">{visibleSections(user).map(({ id, icon: Icon, label, copy }) => <a className="panel settings-card" key={id} href={`#/settings/${id}`}><div className="settings-card-top"><Glyph icon={Icon}/><ArrowRight size={17}/></div><h2>{label}</h2><p>{copy}</p><span>{stats[id]}</span></a>)}</div>
  </div>;
}

const expires = (value) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function AccountSettings({ user, workspace, showPlans, signOut, signingOut, onPasswordChanged }) {
  const [picker, setPicker] = useState(Boolean(showPlans));
  const plan = user.plan;
  useEffect(() => { if (showPlans) setPicker(true); }, [showPlans]);
  function closePicker() {
    setPicker(false);
    if (showPlans) window.location.hash = '#/settings/account';
  }
  return <div className="view-enter">
    <PageHeading label="SETTINGS / ACCOUNT" title="Your account" subtitle="Your sign-in, plan, and workspace access."/>
    <section className="panel service-panel">
      <PanelHeading icon={UserRound} title="Account details" description={user.email}><Button onClick={signOut} busy={signingOut}>Sign out</Button></PanelHeading>
    </section>
    <section className="panel service-panel premium-panel">
      <PanelHeading icon={Crown} title={`${planLabel(plan?.id)}${user.role === 'admin' ? '' : ' plan'}`} description={plan?.expiresAt ? `Active until ${expires(plan.expiresAt)}` : user.role === 'admin' ? 'Manage access and limits in Admin.' : 'Your Free membership does not expire.'}>
        {user.role === 'member' && <Button tone="primary" icon={Crown} onClick={() => setPicker(true)}>{plan?.id === 'free' || !plan ? 'Activate Premium' : 'View plans'}</Button>}
      </PanelHeading>
      {plan && user.role === 'member' && <><PlanUsage plan={plan} accounts={workspace?.tiktok?.accounts?.length || 0}/><p>Shared AI limits apply only to models supplied by the administrator. Your own keys never use that allowance. Daily and monthly usage reset in UTC.</p></>}
    </section>
    <PasswordSettings user={user} onChanged={onPasswordChanged}/>
    {picker && user.role === 'member' && <PlanPicker current={plan?.id || 'free'} onClose={closePicker}/>}
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

export function Appearance({ user, branding }) {
  const theme = themes[branding?.theme || defaultTheme] || themes[defaultTheme];
  return <div className="view-enter">
    <PageHeading label="SETTINGS / APPEARANCE" title="Appearance" subtitle="One theme for everyone in this workspace.">{user.role === 'admin' && <ActionLink href="#/settings/admin" icon={Palette}>Manage workspace theme</ActionLink>}</PageHeading>
    <section className="panel service-panel"><PanelHeading icon={BadgeCheck} title={theme.label} description="The administrator sets the palette used on every account and sign-in page."/></section>
  </div>;
}

function MemberEdit({ member, kind, onClose, onSaved }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [plan, setPlan] = useState(member.plan.id), [overrides, setOverrides] = useState(member.planOverrides), [renew, setRenew] = useState(false);
  const [email, setEmail] = useState(member.email), [reset, setReset] = useState(false), [password, setPassword] = useState(''), [confirm, setConfirm] = useState(''), [adminPassword, setAdminPassword] = useState('');
  const editingPlan = kind === 'plan';
  async function submit(event) {
    event.preventDefault();
    setError(''); setBusy(true);
    try {
      const body = editingPlan ? { plan, renew, overrides: Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== '').map(([key, value]) => [key, Number(value)])) }
        : { email, adminPassword, ...(reset && { temporaryPassword: password, confirmPassword: confirm }) };
      const updated = await api(`/admin/accounts/${member.id}/${kind}`, { method: 'PUT', body });
      setPassword(''); setConfirm(''); setAdminPassword('');
      onSaved(updated, editingPlan ? 'Membership and limits saved.' : 'Member updated. Existing sessions were signed out.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <Modal title={editingPlan ? 'Edit plan & limits' : 'Edit member sign-in'} subtitle={member.email} onClose={() => { if (!busy) onClose(); }}>
    <form className="modal-form" onSubmit={submit}>
      {editingPlan ? <>
        <Field label="Membership plan" hint="Changing to a paid plan starts a one-month term. Payment is arranged separately on WhatsApp."><Select value={plan} onChange={(event) => { setPlan(event.target.value); setRenew(false); }}>{Object.entries(plans).map(([id, tier]) => <option key={id} value={id}>{tier.label}</option>)}</Select></Field>
        {plan === member.plan.id && plan !== 'free' && <label className="consent"><input type="checkbox" checked={renew} onChange={(event) => setRenew(event.target.checked)}/><span>Extend the current membership by one month.</span></label>}
        <p className="edit-limits-note">Leave a limit blank to use the plan allowance. Overrides can only increase limits and stay in effect when the plan changes.</p>
        <div className="form-pair">{Object.entries(limitLabels).map(([key, label]) => <Field key={key} label={label}><input type="number" min="1" max={overrideMax[key]} step="1" value={overrides[key] ?? ''} placeholder={plans[plan]?.limits[key] ?? 'Unlimited'} onChange={(event) => setOverrides((previous) => ({ ...previous, [key]: event.target.value }))}/></Field>)}</div>
      </> : <>
        <p className="edit-limits-note">Changing the email or password signs the member out on all devices. Their projects and connections stay with the same account.</p>
        <Field label="Member email"><input required type="email" autoComplete="off" maxLength="254" value={email} onChange={(event) => setEmail(event.target.value)}/></Field>
        <label className="consent"><input type="checkbox" checked={reset} onChange={(event) => { setReset(event.target.checked); setPassword(''); setConfirm(''); }}/><span>Reset this member’s password</span></label>
        {reset && <div className="form-pair"><Field label="Temporary password" hint="At least 14 characters. Expires in 24 hours; the member must replace it at sign-in."><input type="password" autoComplete="new-password" required minLength="14" maxLength="256" value={password} onChange={(event) => setPassword(event.target.value)}/></Field><Field label="Confirm temporary password"><input type="password" autoComplete="new-password" required minLength="14" maxLength="256" value={confirm} onChange={(event) => setConfirm(event.target.value)}/></Field></div>}
        <Field label="Your administrator password"><input type="password" autoComplete="current-password" required maxLength="256" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)}/></Field>
      </>}
      {error && <Banner>{error}</Banner>}
      <div className="modal-actions"><Button onClick={onClose} disabled={busy}>Cancel</Button><Button icon={Check} type="submit" tone="primary" busy={busy}>Save changes</Button></div>
    </form>
  </Modal>;
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

export function AdminSettings({ user, branding, onBrand, notify, refresh }) {
  const [rows, setRows] = useState([]), [query, setQuery] = useState(''), [next, setNext] = useState(null), [canList, setCanList] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(''), [edit, setEdit] = useState(null);
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
    <PageHeading label="SETTINGS / ADMIN" title="Workspace admin" subtitle="Configure app connections, member access, and how the workspace looks."/>
    <ComposioAdmin refresh={refresh} notify={notify}/>
    <section className="panel service-panel">
      <PanelHeading icon={Users} title="Member access" description="Activate or extend plans here after payment is arranged on WhatsApp."><Button icon={RefreshCw} onClick={() => setRevision((n) => n + 1)} disabled={loading || Boolean(busy)}>Refresh</Button></PanelHeading>
      <label className="search-field admin-search"><Search size={16}/><input type="search" aria-label="Search accounts" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find an account by email…"/></label>
      {error && <Banner>{error}</Banner>}
      {loading && <p className="muted admin-search" role="status">Loading accounts…</p>}
      {!loading && canList && !rows.length && <p className="muted admin-search">No accounts match this search.</p>}
      {!loading && rows.map((row) => <div className="connection-row admin-row" key={row.id}>
        <div><div className="admin-row-title"><strong>{row.email}</strong><span className="badge">{planLabel(row.plan?.id)}</span></div>
          <p>{row.plan?.expiresAt ? `Active until ${expires(row.plan.expiresAt)}` : row.premiumRequested ? 'Legacy Premium request' : row.role === 'member' ? 'No plan expiration' : 'Workspace administrator'}</p>
          <p className="member-ip">Last sign-in IP: <code>{row.lastSignIn?.ip || 'Not recorded'}</code>{row.lastSignIn?.at && <> · {expires(row.lastSignIn.at)}</>}</p>
        </div>
        {row.role === 'member' && <div className="connection-actions"><Button icon={Crown} onClick={() => setEdit({ kind: 'plan', member: row })}>Plan &amp; limits</Button><Button icon={KeyRound} onClick={() => setEdit({ kind: 'credentials', member: row })}>Edit sign-in</Button></div>}
      </div>)}
      {!loading && next !== null && <Button className="admin-search" busy={busy === 'more'} onClick={more}>Show more accounts</Button>}
      <p className="privacy-note"><Cpu size={15}/><span>Share individual chat models under <a href="#/settings/providers">AI Providers</a>. Members never receive the stored key.</span></p>
    </section>
    <section className="panel service-panel branding-panel">
      <PanelHeading icon={Globe2} title="Workspace branding" description="This logo and theme apply to every member and the sign-in page."/>
      <div className="connection-row logo-controls"><Logo branding={branding}/><div><strong>Workspace logo</strong><p>Used in the sidebar and on sign-in and sign-up.</p></div><div className="connection-actions"><Button icon={ImagePlus} onClick={() => fileRef.current?.click()} busy={busy === 'brand'}>Upload logo</Button>{branding?.logoUrl && <Button disabled={busy === 'brand'} onClick={() => saveBrand(branding.theme, null)}>Restore original</Button>}</div><input type="file" ref={fileRef} accept="image/png,image/jpeg,image/webp" aria-label="Upload logo file" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) saveBrand(branding?.theme || defaultTheme, file); }}/></div>
      <h3>Workspace theme</h3><ThemeChooser current={branding?.theme || defaultTheme} onChoose={(theme) => saveBrand(theme)} disabled={busy === 'brand'}/>
    </section>
    {edit && <MemberEdit key={`${edit.member.id}:${edit.kind}`} {...edit} onClose={() => setEdit(null)} onSaved={(updated, message) => { setRows((previous) => previous.map((row) => row.id === updated.id ? updated : row)); setEdit(null); notify(message); }}/>}
  </div>;
}
