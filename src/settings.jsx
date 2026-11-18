import { useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, Captions, Check, ChevronDown, CircleHelp, Clipboard, Cloud, Cpu, Crown, Download, KeyRound, Link2, LockKeyhole, Plus, RefreshCw, Search, Server, ShieldCheck, Sparkles, Terminal, Trash2, Unplug } from 'lucide-react';
import { ActionLink, api, Banner, Button, Confirm, EmptyState, Glyph, Modal, PageHeading, PanelHeading, TikTokIcon } from './ui.jsx';
import { googleDestinations } from './delivery.jsx';
import { providerCatalog as providers } from '../shared/providers.mjs';

import { Field, PasswordInput, Select } from './forms.jsx';
import { BufferIcon } from './mcp.jsx';

function ProviderDialog({ existing, onClose, onSaved, allowLocal }) {
  const [fields, setFields] = useState(existing ? { ...existing, apiKey: '' } : { type: 'openai', name: '', baseUrl: providers.openai.baseUrl, apiKey: '', model: providers.openai.model });
  const [showKey, setShowKey] = useState(false), [models, setModels] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const definition = providers[fields.type];
  const configurable = definition.editableUrl;
  const keepsKey = existing?.hasKey && existing.type === fields.type && (!configurable || fields.baseUrl.trim().replace(/\/$/, '') === existing.baseUrl);
  const set = (key, value) => setFields((state) => ({ ...state, [key]: value }));
  function setType(type) {
    setModels(null); setError('');
    setFields((state) => ({ ...state, type, baseUrl: providers[type].baseUrl, model: providers[type].model || '', apiKey: '' }));
  }
  async function submit(action) {
    setBusy(action); setError('');
    const body = { ...fields, name: fields.name.trim() || definition.name };
    try {
      if (action === 'models') {
        const response = await api('/providers/catalog', { method: 'POST', body });
        setModels(response.models);
      } else {
        await api(existing ? `/providers/${existing.id}` : '/providers', { method: existing ? 'PUT' : 'POST', body });
        onSaved(existing ? 'Provider updated.' : 'Provider profile added.');
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  return <Modal title={existing ? 'Edit provider' : 'Add an AI provider'} subtitle="Save a named profile with its own API key and model. Add more profiles for other keys, models or servers—even from the same provider." onClose={onClose}>
    <form className="modal-form" onSubmit={(event) => { event.preventDefault(); submit('save'); }}>
      <div className="form-pair"><Field label="Provider"><Select value={fields.type} onChange={(event) => setType(event.target.value)}>{Object.entries(providers).map(([key, val]) => <option key={key} value={key}>{val.name}</option>)}</Select></Field><Field label="Profile name"><input value={fields.name} maxLength={60} onChange={(event) => set('name', event.target.value)} placeholder={definition.name}/></Field></div>
      {configurable && <Field label="API base URL" hint={allowLocal ? 'Use public HTTPS or a loopback AI server on this host. Include the API path (e.g. /v1).' : 'Use a public HTTPS endpoint with its API path (e.g. /v1). Changing the address does not reuse the saved key.'}><input type="url" value={fields.baseUrl} onChange={(event) => { set('baseUrl', event.target.value); setModels(null); }} placeholder="https://example.com/v1" required={fields.type === 'custom'}/></Field>}
      <Field label={definition.optionalKey ? 'API key (optional)' : 'API key'} hint="Keys are encrypted on the server and never returned to the browser."><PasswordInput noun="key" show={showKey} onToggle={() => setShowKey(!showKey)} value={fields.apiKey} onChange={(event) => { set('apiKey', event.target.value); setModels(null); }} placeholder={keepsKey ? 'Leave blank to keep the saved key' : 'Paste your API key'}/></Field>
      <div className="model-field"><Field label="Chat model ID" hint="Enter a model manually or fetch the provider’s catalog."><input value={fields.model} maxLength={160} onChange={(event) => set('model', event.target.value)} placeholder="Model ID" spellCheck="false"/></Field><Button onClick={() => submit('models')} busy={busy === 'models'} disabled={busy === 'save'} icon={RefreshCw}>Fetch models</Button></div>
      {models && (models.length ? <Field label="Available models"><Select value={models.includes(fields.model) ? fields.model : ''} onChange={(event) => { if (event.target.value) set('model', event.target.value); }}><option value="">Choose a model</option>{models.map((model) => <option key={model} value={model}>{model}</option>)}</Select></Field> : <Banner tone="warning" icon={CircleHelp}>No models were listed. You can still enter a model ID manually.</Banner>)}
      {error && <Banner>{error}</Banner>}
      <div className="modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" icon={Check} tone="primary" busy={busy === 'save'} disabled={busy === 'models'}>Save profile</Button></div>
    </form>
  </Modal>;
}

export function Providers({ user, workspace, refresh, notify }) {
  const [dialog, setDialog] = useState(null), [confirm, setConfirm] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [shareConfirm, setShareConfirm] = useState(null);
  const [captionId, setCaptionId] = useState(''), [captionModel, setCaptionModel] = useState('');
  const [search, setSearch] = useState(''), [providerType, setProviderType] = useState(''), [shown, setShown] = useState(12);
  const profiles = workspace?.providers || [];
  const shared = workspace?.sharedProviders || [];
  const active = [...profiles, ...shared].find((p) => p.id === workspace?.activeProviderId);
  const isAdmin = user.role === 'admin';
  const compatible = profiles.filter((p) => providers[p.type]?.kind === 'compatible');
  const query = search.trim().toLowerCase();
  const filtered = profiles.filter((p) => (!providerType || p.type === providerType) && `${p.name} ${providers[p.type]?.name || ''} ${p.model} ${p.baseUrl}`.toLowerCase().includes(query)).reverse();
  const types = Object.entries(providers).filter(([type]) => profiles.some((p) => p.type === type));
  const resetFilter = () => { setSearch(''); setProviderType(''); setShown(12); };
  useEffect(() => { setCaptionId(workspace?.captions.providerId || ''); setCaptionModel(workspace?.captions.model || ''); }, [workspace?.captions.providerId, workspace?.captions.model]);
  async function run(action, fn, message) {
    setBusy(action); setError('');
    try { await fn(); await refresh(); notify(message); setConfirm(null); setShareConfirm(null); }
    catch (err) { setError(err.message); if (!confirm && !shareConfirm) notify(err.message, 'error'); }
    finally { setBusy(''); }
  }
  const activate = (id) => run(id || 'local', () => api('/settings/ranking', { method: 'PUT', body: { providerId: id } }), id ? 'Highlight model updated.' : 'Switched to local analysis.');
  return <div className="view-enter">
    <PageHeading label="WORKSPACE / AI" title="AI providers" subtitle="Add your own API keys and models. Choose your default here or select a different chat model in the Clip Studio."><Button tone="primary" icon={Plus} onClick={() => setDialog('new')}>Add provider</Button></PageHeading>
    <div className="panel feature-panel ranking-banner"><Glyph icon={Sparkles}/><div><p className="eyebrow">YOUR DEFAULT HIGHLIGHT MODEL</p><h2>{active?.name || 'Local analysis'}</h2><p>{active ? active.model : 'Scores transcript cues, audio activity, and replay data when available. No API key required.'}</p></div>{active ? <Button icon={Cpu} busy={busy === 'local'} onClick={() => activate(null)}>Use local analysis</Button> : <span className="badge badge-green"><i/>Active</span>}</div>
    <div className="section-heading settings-section-title"><h2>Your provider profiles</h2><span className="muted">{profiles.length} saved</span></div>
    {profiles.length > 0 && <div className="profiles-toolbar">
      <label className="search-field"><Search size={16}/><input type="search" aria-label="Search provider profiles" value={search} onChange={(event) => { setSearch(event.target.value); setShown(12); }} placeholder="Search profiles, models or endpoints…"/></label>
      <Select aria-label="Filter by provider" value={providerType} onChange={(event) => { setProviderType(event.target.value); setShown(12); }}><option value="">All providers</option>{types.map(([key, value]) => <option key={key} value={key}>{value.name}</option>)}</Select>
    </div>}
    <div className="panel profile-panel">
      {filtered.length ? filtered.slice(0, shown).map((profile) => <div className="profile-row" key={profile.id}><Glyph icon={Cpu} subtle/><div className="profile-info"><h3>{profile.name}</h3><p>{providers[profile.type]?.name} · {profile.model || 'No chat model selected'}</p></div><div className="profile-actions">{active?.id === profile.id ? <span className="badge badge-green"><i/>Default</span> : <Button disabled={!profile.model} busy={busy === profile.id} onClick={() => activate(profile.id)}>Use model</Button>}{isAdmin && <Button icon={Crown} aria-pressed={profile.premiumShared} disabled={!profile.model} busy={busy === `share-${profile.id}`} onClick={() => { setError(''); setShareConfirm(profile); }}>{profile.premiumShared ? 'Stop sharing' : 'Share to premium'}</Button>}<Button onClick={() => setDialog(profile)}>Edit</Button><button className="icon-button" title="Remove provider" aria-label={`Remove ${profile.name}`} onClick={() => { setError(''); setConfirm(profile); }}><Trash2 size={16}/></button></div></div>)
        : profiles.length ? <EmptyState icon={Search} title="No matching profiles" action={<Button onClick={resetFilter}>Clear filters</Button>}>Search by profile name, provider, model, or endpoint.</EmptyState>
        : <EmptyState icon={KeyRound} title="No providers added" action={<Button icon={Plus} onClick={() => setDialog('new')}>Add a provider</Button>}>Choose a preset like OpenAI, Gemini, DeepSeek or LM Studio, or enter a public OpenAI-compatible HTTPS URL.</EmptyState>}
      {filtered.length > 0 && (filtered.length > shown || filtered.length < profiles.length) && <div className="profiles-footer"><span>Showing {Math.min(shown, filtered.length)} of {profiles.length} profiles</span>{filtered.length > shown && <Button onClick={() => setShown((count) => count + 12)}>Show more</Button>}</div>}
    </div>
    {!isAdmin && <section className="panel service-panel premium-panel">
      <PanelHeading icon={Crown} title="Premium AI" description="Chat models provided by your workspace administrator. API keys are never shown or added to your profiles."/>
      {shared.length ? shared.map((profile) => <div className="connection-row" key={profile.id}><div><strong>{profile.name}</strong><p>{profile.model} · Shared chat model</p></div>{active?.id === profile.id ? <span className="badge badge-green"><i/>Default</span> : <Button busy={busy === profile.id} onClick={() => activate(profile.id)}>Use model</Button>}</div>) : <p>{user.premium ? 'No chat models have been shared yet.' : <>Want to use a shared model? <a href="#/settings/account">{user.premiumRequested ? 'View your pending request' : 'Request premium access'}</a>.</>}</p>}
    </section>}
    <section className="panel service-panel">
      <PanelHeading icon={Captions} title="Caption engine" description="For speech transcription when the source has no usable captions. This is separate from your project’s chat model."/>
      <form className="caption-form" onSubmit={(event) => { event.preventDefault(); run('captions', () => api('/settings/captions', { method: 'PUT', body: { providerId: captionId, model: captionModel } }), 'Caption engine updated.'); }}>
        <Field label="Transcription provider"><Select value={captionId} onChange={(event) => { setCaptionId(event.target.value); const profile = compatible.find((item) => item.id === event.target.value); setCaptionModel(profile?.type === 'openai' ? 'whisper-1' : profile?.type === 'groq' ? 'whisper-large-v3-turbo' : ''); }}><option value="">Local Whisper</option>{compatible.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        {captionId && <Field label="Transcription model" hint="Must support verbose_json with segment timestamps."><input value={captionModel} onChange={(event) => setCaptionModel(event.target.value)} maxLength={160} spellCheck="false" placeholder="e.g. whisper-1" required/></Field>}
        <Button type="submit" busy={busy === 'captions'} icon={Check}>Save transcription</Button>
      </form>
      <p className="privacy-note"><ShieldCheck size={16}/> External models may receive transcript excerpts or audio and incur usage costs. Keep Local analysis and Local Whisper selected to avoid sending content to AI providers.</p>
    </section>
    {dialog && <ProviderDialog allowLocal={isAdmin} existing={dialog === 'new' ? null : dialog} onClose={() => setDialog(null)} onSaved={(message) => { if (dialog === 'new') resetFilter(); setDialog(null); refresh(); notify(message); }}/>}
    {shareConfirm && <Confirm title={shareConfirm.premiumShared ? 'Make this chat model private?' : 'Share this chat model with premium members?'} message={shareConfirm.premiumShared ? 'New projects will not be able to use this model through Premium.' : `Premium members can send transcript excerpts to ${shareConfirm.name} for scoring and translation. They will not see your key, but use may be billed to your provider account.`} label={shareConfirm.premiumShared ? 'Stop sharing' : 'Share model'} danger={shareConfirm.premiumShared} onClose={() => setShareConfirm(null)} busy={busy === `share-${shareConfirm.id}`} error={error} onConfirm={() => run(`share-${shareConfirm.id}`, () => api(`/admin/providers/${shareConfirm.id}/share`, { method: 'PUT', body: { shared: !shareConfirm.premiumShared } }), shareConfirm.premiumShared ? 'Model is now private.' : 'Chat model shared with premium members.')}/>}
    {confirm && <Confirm title={`Remove ${confirm.name}?`} message="This removes the saved key. If this was your workspace default or transcription engine, new projects will use the local engine instead." label="Remove profile" onClose={() => setConfirm(null)} busy={busy === 'remove'} error={error} onConfirm={() => run('remove', () => api(`/providers/${confirm.id}`, { method: 'DELETE' }), 'Provider removed.')}/>}
  </div>;
}

function ConnectionBadge({ online }) { return <span className={`badge ${online ? 'badge-green' : ''}`}><i/>{online ? 'Connected' : 'Not connected'}</span>; }

function GoogleConnection({ google, refresh, notify, embedded }) {
  const origin = window.location.origin;
  const suggestedCallback = `${origin}/api/google/callback`;
  const [fields, setFields] = useState({ clientId: '', clientSecret: '', redirectUri: suggestedCallback });
  const [targets, setTargets] = useState({ drive: true, youtube: false });
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [disconnect, setDisconnect] = useState(false);
  useEffect(() => setFields({ clientId: google?.clientId || '', clientSecret: '', redirectUri: google?.redirectUri || suggestedCallback }), [google?.clientId, google?.redirectUri, suggestedCallback]);
  useEffect(() => {
    if (google?.connected) setTargets({ drive: google.grants.drive, youtube: google.grants.youtube });
  }, [google?.connected, google?.grants.drive, google?.grants.youtube]);
  const field = (name, value) => setFields((previous) => ({ ...previous, [name]: value }));
  const selected = Object.keys(googleDestinations).filter((target) => targets[target]);
  async function run(action) {
    setError(''); setBusy(action);
    try {
      if (action === 'connect') {
        const { url } = await api('/google/connect', { method: 'POST', body: { targets: selected } });
        window.location.assign(url);
      } else if (action === 'save') {
        await api('/google/config', { method: 'PUT', body: fields });
        field('clientSecret', ''); await refresh(); notify('Google OAuth settings saved.');
      } else {
        await api('/google/disconnect', { method: 'POST' });
        setDisconnect(false); await refresh(); notify('Google account disconnected.');
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  return <section className="panel service-panel integration-panel" aria-label="Google connections">
    <PanelHeading icon={Cloud} title="Google" description="One sign-in for Drive exports and private YouTube uploads."><ConnectionBadge online={google?.connected}/></PanelHeading>
    <fieldset className="google-destinations">
      <legend>Permissions to request</legend>
      {Object.entries(googleDestinations).map(([target, { icon: Icon, label, detail }]) => <label className="google-destination" key={target}>
        <input type="checkbox" checked={targets[target]} onChange={(event) => setTargets((previous) => ({ ...previous, [target]: event.target.checked }))}/><Icon size={18}/><div><strong>{label}</strong><span>{detail}</span>{google?.connected && <small>{google.grants[target] ? 'Granted' : 'Not granted'}</small>}</div>
      </label>)}
    </fieldset>
    <div className="connection-row"><div><strong>{google?.account?.name || 'Google account'}</strong><p>{google?.connected ? 'Reconnect to change the requested permissions or switch accounts.' : google?.configured ? 'Choose one or both permissions, then sign in.' : 'Save a Google OAuth web client below to sign in.'}</p></div><div className="connection-actions">
      {google?.connected && <Button icon={Unplug} disabled={Boolean(busy)} onClick={() => { setError(''); setDisconnect(true); }}>Disconnect Google</Button>}
      <Button icon={Link2} tone={google?.connected ? 'neutral' : 'primary'} busy={busy === 'connect'} disabled={embedded || !google?.configured || !selected.length || Boolean(busy && busy !== 'connect')} onClick={() => run('connect')}>{google?.connected ? 'Reconnect' : 'Connect Google'}</Button>
    </div></div>
    {google?.managedByEnv ? <p className="privacy-note"><LockKeyhole size={16}/> This app is configured with server environment variables.</p> : <form className="modal-form integration-form" onSubmit={(event) => { event.preventDefault(); run('save'); }}>
      <h3>Google OAuth web client</h3>
      <div className="form-pair"><Field label="Google client ID"><input required value={fields.clientId} onChange={(event) => field('clientId', event.target.value)} maxLength={300} placeholder="Client ID from Google Cloud" autoComplete="off"/></Field><Field label="Google client secret"><input type="password" required={!google?.configured} value={fields.clientSecret} onChange={(event) => field('clientSecret', event.target.value)} maxLength={500} placeholder={google?.configured ? 'Leave blank to keep saved secret' : 'Client secret from Google Cloud'} autoComplete="new-password"/></Field></div>
      <Field label="Google OAuth redirect URL" hint="Register this exact URL. Use localhost on your laptop or HTTPS on your VPS."><input type="url" required value={fields.redirectUri} onChange={(event) => field('redirectUri', event.target.value)} maxLength={500}/></Field>
      <div className="integration-save"><Button icon={Check} type="submit" busy={busy === 'save'} disabled={Boolean(busy && busy !== 'save')}>Save Google configuration</Button></div>
    </form>}
    {error && !disconnect && <Banner>{error}</Banner>}
    <details className="connection-help"><summary>Set up Google access</summary><ol>
      <li>In <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console <ArrowUpRight size={13}/></a>, enable the Drive API, YouTube Data API v3, or both.</li>
      <li>Set up the OAuth consent screen and a Web application client. Add yourself as a test user if required and register the exact callback above.</li>
      <li>Save the credentials here and connect. On a finished project, use <strong>Send to…</strong> to preview and approve the upload. Google account, project and API limits apply.</li>
    </ol><p>Drive access is limited to app-created or app-opened files. YouTube sign-in is not required to clip public sources.</p></details>
    {disconnect && <Confirm title="Disconnect Google?" message="This removes the saved Google tokens from Curiousity. An upload already in progress may finish. Uploaded files and videos stay in your account. Manage access in your Google account if you also want to revoke the grant." label="Disconnect Google" onClose={() => setDisconnect(false)} onConfirm={() => run('disconnect')} busy={busy === 'disconnect'} error={error}/>}
  </section>;
}

export function Integrations({ workspace, refresh, notify, notice }) {
  const tiktok = workspace?.tiktok;
  const embedded = window.parent !== window;
  const suggestedCallback = window.location.protocol === 'https:' ? `${window.location.origin}/api/tiktok/callback` : '';
  const [fields, setFields] = useState({ clientKey: '', clientSecret: '', redirectUri: suggestedCallback });
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [disconnect, setDisconnect] = useState(false);
  useEffect(() => setFields({ clientKey: tiktok?.clientKey || '', clientSecret: '', redirectUri: tiktok?.redirectUri || suggestedCallback }), [tiktok?.clientKey, tiktok?.redirectUri, suggestedCallback]);
  const field = (name, value) => setFields((prev) => ({ ...prev, [name]: value }));
  async function run(action) {
    setError(''); setBusy(action);
    try {
      if (action === 'connect') {
        const { url } = await api('/tiktok/connect', { method: 'POST' });
        window.location.assign(url);
      } else if (action === 'save') {
        await api('/tiktok/config', { method: 'PUT', body: fields });
        field('clientSecret', ''); await refresh(); notify('TikTok app settings saved.');
      } else {
        await api('/tiktok/disconnect', { method: 'POST' });
        setDisconnect(false); await refresh(); notify('TikTok account disconnected.');
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  const connectedNotice = ['Google connected.', 'TikTok connected.'].includes(notice);
  return <div className="view-enter">
    <PageHeading label="WORKSPACE / CONNECTIONS" title="Integrations" subtitle="Manage your Buffer, Google Drive, YouTube and TikTok connections. You can render and download clips without connecting any of them."/>
    {notice && <Banner tone={connectedNotice ? 'success' : 'error'} icon={connectedNotice ? Check : CircleHelp}>{notice}</Banner>}
    {embedded && <Banner tone="warning" icon={ArrowUpRight}>For Google or TikTok OAuth, <a href={`${window.location.origin}/#/settings/integrations`} target="_blank" rel="noreferrer">open Curiousity in its own tab</a> and sign in there.</Banner>}
    <section className="panel service-panel integration-panel"><PanelHeading icon={BufferIcon} title="Buffer" description="Connect via MCP to review and send draft posts using your own Buffer account."><ActionLink href={workspace?.mcps?.some((profile) => profile.kind === 'buffer') ? '#/settings/mcp' : '#/settings/mcp?preset=buffer'} icon={Link2}>{workspace?.mcps?.some((profile) => profile.kind === 'buffer') ? 'Manage in MCP' : 'Connect Buffer'}</ActionLink></PanelHeading></section>
    <GoogleConnection google={workspace?.google} refresh={refresh} notify={notify} embedded={embedded}/>
    <section className="panel service-panel integration-panel" aria-label="TikTok connection">
      <PanelHeading icon={TikTokIcon} title="TikTok" description="Send approved video drafts to the TikTok inbox."><ConnectionBadge online={tiktok?.connected}/></PanelHeading>
      {tiktok?.connected ? <div className="connection-row"><div><strong>{tiktok.account.name}</strong><p>To publish a draft, open its notification in TikTok.</p></div><Button icon={Unplug} onClick={() => { setError(''); setDisconnect(true); }}>Disconnect</Button></div> : <div className="connection-row"><div><strong>Creator account</strong><p>{tiktok?.configured ? 'Authorize the account that should receive drafts.' : 'Save your developer app settings to connect an account.'}</p></div><Button icon={Link2} tone="primary" busy={busy === 'connect'} disabled={embedded || !tiktok?.configured} onClick={() => run('connect')}>Connect account</Button></div>}
      {tiktok?.managedByEnv ? <p className="privacy-note"><LockKeyhole size={16}/> This app is configured with server environment variables.</p> : <form className="modal-form integration-form" onSubmit={(event) => { event.preventDefault(); run('save'); }}>
        <h3>Developer app settings</h3>
        <div className="form-pair"><Field label="Client key"><input required value={fields.clientKey} onChange={(event) => field('clientKey', event.target.value)} autoComplete="off" maxLength={180} placeholder="TikTok app client key"/></Field><Field label="Client secret"><input type="password" required={!tiktok?.configured} value={fields.clientSecret} onChange={(event) => field('clientSecret', event.target.value)} autoComplete="new-password" maxLength={500} placeholder={tiktok?.configured ? 'Leave blank to keep saved secret' : 'TikTok app client secret'}/></Field></div>
        <Field label="OAuth redirect URL" hint="Open Curiousity on this HTTPS domain and register this exact URL in TikTok’s Login Kit."><input type="url" required value={fields.redirectUri} onChange={(event) => field('redirectUri', event.target.value)} placeholder="https://clips.example.com/api/tiktok/callback"/></Field>
        <div className="integration-save"><Button icon={Check} type="submit" busy={busy === 'save'}>Save configuration</Button></div>
      </form>}
      {error && !disconnect && <Banner>{error}</Banner>}
    </section>
    <section className="panel service-panel how-to-panel"><PanelHeading icon={BookOpen} title="Set up TikTok access" description="Use TikTok’s official Login Kit and Content Posting API."/><ol><li>Create an app in <a href="https://developers.tiktok.com/" target="_blank" rel="noreferrer">TikTok for Developers <ArrowUpRight size={13}/></a> and add Login Kit and Content Posting API.</li><li>Register the HTTPS callback and request the <code>user.info.basic</code> and <code>video.upload</code> scopes for the account.</li><li>Connect the account here. In a finished project, select clips and confirm the draft upload after previewing them.</li></ol><p className="privacy-note"><ShieldCheck size={16}/> TikTok approval and upload limits apply. Curiousity does not publish unattended to a public feed.</p></section>
    {disconnect && <Confirm title="Disconnect TikTok?" message="This removes the saved account tokens from Curiousity. Drafts already sent to TikTok will stay there." label="Disconnect" onClose={() => setDisconnect(false)} onConfirm={() => run('disconnect')} busy={busy === 'disconnect'} error={error}/>}
  </div>;
}

function CommandBlock({ children, notify }) {
  async function copy() {
    try { await navigator.clipboard.writeText(children); notify('Commands copied.'); }
    catch { notify('Select the commands and copy them manually.'); }
  }
  return <div className="command-block"><pre><code>{children}</code></pre><button aria-label="Copy commands" title="Copy commands" className="icon-button" type="button" onClick={copy}><Clipboard size={16}/></button></div>;
}
export function Setup({ workspace, refresh, notify }) {
  const [busy, setBusy] = useState(false);
  const online = workspace?.tools;
  async function check() { setBusy(true); const found = await refresh(true); setBusy(false); if (found) notify('System checks refreshed.'); }
  return <div className="view-enter">
    <PageHeading label="SELF-HOSTED WORKSPACE" title="Setup guide" subtitle="Run Curiousity on your computer or bring it to your own server."/>
    <div className="setup-grid"><section className="panel service-panel"><PanelHeading icon={Terminal} title="Run locally" description="Node.js 22+, Python 3.10+ and a terminal."/><p className="setup-copy">From the repository folder, install the website and media tools. Then open <code>http://localhost:5173</code>.</p><CommandBlock notify={notify}>{'npm ci\nnpm run setup\nnpm run dev'}</CommandBlock><p className="setup-copy">The first local transcription downloads the Whisper model. To fetch it ahead of time, run <code>npm run setup -- --download-model</code>.</p></section>
    <section className="panel service-panel"><PanelHeading icon={Server} title="Run on a VPS" description="Run as a Node service. No Docker required."/><p className="setup-copy">Set up HTTPS and provision the administrator locally with a fresh secret. See the README for the exact steps.</p><CommandBlock notify={notify}>{'cp .env.example .env\n# Configure PUBLIC_ORIGIN and TRUST_PROXY\n# Provision the admin with npm run admin\nnpm ci\nnpm run setup\nnpm run build\nnpm start'}</CommandBlock><p className="setup-copy">Proxy the app through HTTPS and keep port 5173 private. See the repository README for example deployment and data backup instructions.</p></section></div>
    <section className="panel service-panel how-to-panel"><PanelHeading icon={Captions} title="Try the caption tools" description="No YouTube link or API key needed for the sample."/><ol><li>In <a href="#/studio">Studio</a>, choose <b>Auto</b> under Number of clips and set Caption language to <b>Roman Urdu</b>.</li><li>Open <b>Caption style → Customize</b> to preview fonts, effects, and in/out animations. Apply your style, then click <b>Try demo</b>.</li><li>Download an MP4 with burned-in styling, or a plain-text SRT. For your own videos, choose an AI provider profile to translate other languages into Roman Urdu when no suitable caption track is available.</li></ol></section>
    <section className="panel service-panel tool-panel"><PanelHeading icon={Download} title="System checks" description="Tools detected on this server."><Button icon={RefreshCw} busy={busy} onClick={check}>Recheck</Button></PanelHeading><div className="tool-list">{[['FFmpeg', online?.ffmpeg, 'Reads and renders media'], ['yt-dlp', online?.ytDlp, 'Imports authorized YouTube sources'], ['Burned captions', online?.subtitles, 'FFmpeg libass subtitle filter'], ['Whisper', online?.whisper, 'Local speech recognition package']].map(([title, ready, detail]) => <div key={title}><div><strong>{title}</strong><p>{detail}</p></div><span className={`badge ${ready ? 'badge-green' : ''}`}><i/>{ready ? 'Installed' : ready === false ? 'Not found' : 'Unknown'}</span></div>)}</div></section>
  </div>;
}
