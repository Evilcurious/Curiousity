import { useEffect, useState } from 'react';
import { Captions, Check, ChevronDown, Clipboard, Cpu, Crown, Download, KeyRound, Plus, RefreshCw, Search, Server, ShieldCheck, Sparkles, Terminal, Trash2, Unplug } from 'lucide-react';
import { ActionLink, api, Banner, Button, Confirm, EmptyState, Glyph, Modal, PageHeading, PanelHeading } from './ui.jsx';
import { ConnectedApps } from './composio.jsx';
import { providerCatalog as providers } from '../shared/providers.mjs';

import { Field, PasswordInput, Select } from './forms.jsx';

function ProviderDialog({ existing, onClose, onSaved, allowLocal }) {
  const [fields, setFields] = useState(existing ? { ...existing, apiKey: '' } : { type: 'openai', name: '', baseUrl: providers.openai.baseUrl, apiKey: '', model: providers.openai.model });
  const [showKey, setShowKey] = useState(false), [models, setModels] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const definition = providers[fields.type];
  const configurable = definition.editableUrl;
  const initialUrl = (type) => allowLocal || !providers[type].baseUrl.startsWith('http://') ? providers[type].baseUrl : '';
  const keepsKey = existing?.hasKey && existing.type === fields.type && (!configurable || fields.baseUrl.trim().replace(/\/$/, '') === existing.baseUrl);
  const set = (key, value) => setFields((state) => ({ ...state, [key]: value }));
  function setType(type) {
    setModels(null); setError('');
    setFields((state) => ({ ...state, type, baseUrl: initialUrl(type), model: providers[type].model || '', apiKey: '' }));
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
      {configurable && <Field label="API base URL" hint={allowLocal ? 'Use public HTTPS or a loopback AI server on this host. Include the API path (e.g. /v1).' : 'Use your public HTTPS API address (such as https://ai.example.com/v1). A server on your device must be reachable from this VPS. Changing the address does not reuse the saved key.'}><input type="url" value={fields.baseUrl} onChange={(event) => { set('baseUrl', event.target.value); setModels(null); }} placeholder="https://example.com/v1" required={!allowLocal || fields.type === 'custom'}/></Field>}
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
  const [shareConfirm, setShareConfirm] = useState(null), [shareMode, setShareMode] = useState('private');
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
    <PageHeading label="WORKSPACE / AI" title="AI providers" subtitle="Add your own API keys and models on any plan. Use your saved models in Chat or choose a default for highlight analysis."><Button tone="primary" icon={Plus} onClick={() => setDialog('new')}>Add provider</Button></PageHeading>
    <div className="panel feature-panel ranking-banner"><Glyph icon={Sparkles}/><div><p className="eyebrow">YOUR DEFAULT HIGHLIGHT MODEL</p><h2>{active?.name || 'Local analysis'}</h2><p>{active ? active.model : 'Scores transcript cues, audio activity, and replay data when available. No API key required.'}</p></div>{active ? <Button icon={Cpu} busy={busy === 'local'} onClick={() => activate(null)}>Use local analysis</Button> : <span className="badge badge-green"><i/>Active</span>}</div>
    <div className="section-heading settings-section-title"><h2>Your provider profiles</h2><span className="muted">{profiles.length} saved</span></div>
    {profiles.length > 0 && <div className="profiles-toolbar">
      <label className="search-field"><Search size={16}/><input type="search" aria-label="Search provider profiles" value={search} onChange={(event) => { setSearch(event.target.value); setShown(12); }} placeholder="Search profiles, models or endpoints…"/></label>
      <Select aria-label="Filter by provider" value={providerType} onChange={(event) => { setProviderType(event.target.value); setShown(12); }}><option value="">All providers</option>{types.map(([key, value]) => <option key={key} value={key}>{value.name}</option>)}</Select>
    </div>}
    <div className="panel profile-panel">
      {filtered.length ? filtered.slice(0, shown).map((profile) => <div className="profile-row" key={profile.id}><Glyph icon={Cpu} subtle/><div className="profile-info"><h3>{profile.name}</h3><p>{providers[profile.type]?.name} · {profile.model || 'No chat model selected'}</p></div><div className="profile-actions">{active?.id === profile.id ? <span className="badge badge-green"><i/>Default</span> : <Button disabled={!profile.model} busy={busy === profile.id} onClick={() => activate(profile.id)}>Use model</Button>}{isAdmin && <Button icon={Crown} aria-pressed={profile.premiumShared} disabled={!profile.model} busy={busy === `share-${profile.id}`} onClick={() => { setError(''); setShareMode(profile.freeShared ? 'all' : profile.premiumShared ? 'paid' : 'private'); setShareConfirm(profile); }}>{profile.freeShared ? 'Shared with all plans' : profile.premiumShared ? 'Shared with paid plans' : 'Share model'}</Button>}<Button onClick={() => setDialog(profile)}>Edit</Button><button className="icon-button" title="Remove provider" aria-label={`Remove ${profile.name}`} onClick={() => { setError(''); setConfirm(profile); }}><Trash2 size={16}/></button></div></div>)
        : profiles.length ? <EmptyState icon={Search} title="No matching profiles" action={<Button onClick={resetFilter}>Clear filters</Button>}>Search by profile name, provider, model, or endpoint.</EmptyState>
        : <EmptyState icon={KeyRound} title="No providers added" action={<Button icon={Plus} onClick={() => setDialog('new')}>Add a provider</Button>}>Choose a preset like OpenAI, Gemini, DeepSeek or LM Studio, or enter a public OpenAI-compatible HTTPS URL.</EmptyState>}
      {filtered.length > 0 && (filtered.length > shown || filtered.length < profiles.length) && <div className="profiles-footer"><span>Showing {Math.min(shown, filtered.length)} of {profiles.length} profiles</span>{filtered.length > shown && <Button onClick={() => setShown((count) => count + 12)}>Show more</Button>}</div>}
    </div>
    {!isAdmin && <section className="panel service-panel premium-panel">
      <PanelHeading icon={Crown} title="Shared AI models" description="Use these models in Chat and Studio under your plan’s shared AI allowance. The administrator’s keys stay private."/>
      {shared.length ? shared.map((profile) => <div className="connection-row" key={profile.id}><div><strong>{profile.name}</strong><p>{profile.model} · Shared chat model</p></div>{active?.id === profile.id ? <span className="badge badge-green"><i/>Default</span> : <Button busy={busy === profile.id} onClick={() => activate(profile.id)}>Use model</Button>}</div>) : <p>No shared models are available to your plan. Use your own key or <a href="#/settings/account?plans=1">view plans</a>.</p>}
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
    {shareConfirm && <Modal title="Share this chat model" subtitle={`${shareConfirm.name} · Usage can be billed to your provider account. Members never see your key or endpoint.`} onClose={() => { if (!busy) setShareConfirm(null); }}>
      <form className="modal-form" onSubmit={(event) => { event.preventDefault(); run(`share-${shareConfirm.id}`, () => api(`/admin/providers/${shareConfirm.id}/share`, { method: 'PUT', body: { shared: shareMode !== 'private', includeFree: shareMode === 'all' } }), 'AI model sharing updated.'); }}>
        <Field label="Available to"><Select value={shareMode} onChange={(event) => setShareMode(event.target.value)}><option value="private">Only me</option><option value="paid">Basic, Premium and Elite</option><option value="all">All plans, including Free</option></Select></Field>
        {error && <Banner>{error}</Banner>}
        <div className="modal-actions"><Button onClick={() => setShareConfirm(null)} disabled={Boolean(busy)}>Cancel</Button><Button type="submit" tone="primary" busy={Boolean(busy)}>Save sharing</Button></div>
      </form>
    </Modal>}
    {confirm && <Confirm title={`Remove ${confirm.name}?`} message="This removes the saved key. If this was your workspace default or transcription engine, new projects will use the local engine instead." label="Remove profile" onClose={() => setConfirm(null)} busy={busy === 'remove'} error={error} onConfirm={() => run('remove', () => api(`/providers/${confirm.id}`, { method: 'DELETE' }), 'Provider removed.')}/>}
  </div>;
}

function SavedDestinations({ workspace, refresh, notify }) {
  const [removing, setRemoving] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const google = workspace?.google;
  const destinations = [
    ...(google?.connected || google?.hasSavedAccount ? [{ label: google.connected ? `Google · ${google.account.name}` : 'Google (legacy)', copy: google.connected ? 'Drive and private YouTube delivery' : 'No longer authorized for clip delivery', route: '/google/disconnect', method: 'POST' }] : []),
    ...(workspace?.tiktok?.accounts || []).map((row) => ({ label: `TikTok · ${row.name}`, copy: row.available ? 'Reviewed inbox drafts' : 'Paused by your account’s plan limit', route: '/tiktok/disconnect', method: 'POST', body: { accountId: row.id } })),
    ...(workspace?.mcps || []).map((row) => ({ label: row.name, copy: row.kind === 'buffer' ? 'Buffer clip drafts with this saved credential' : 'Archived MCP profile; not available in Chat', route: `/mcp/${row.id}`, method: 'DELETE' })),
  ];
  if (!destinations.length) return null;
  async function remove() {
    setBusy(true); setError('');
    try {
      await api(removing.route, { method: removing.method, body: removing.body });
      await refresh(); setRemoving(null); notify('Saved connection removed.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <details className="panel service-panel composio-legacy"><summary>Previously saved integrations</summary>
    <p>Previously connected clip destinations still work from finished projects while their authorizations remain valid. New app connections use Composio and are separate from clip uploads. Old credentials aren’t transferred to Composio.</p>
    {destinations.map((row, index) => <div className="connection-row composio-legacy-row" key={`${row.route}:${row.body?.accountId || index}`}><div><strong>{row.label}</strong><p>{row.copy}</p></div><Button icon={Unplug} aria-label={`Remove ${row.label}`} onClick={() => { setRemoving(row); setError(''); }}>Remove</Button></div>)}
    {removing && <Confirm title={`Remove ${removing.label}?`} message="The saved account credential will be removed from Curiousity. Check the provider’s settings to revoke the grant too. Files and drafts already sent stay at their destination." label="Remove connection" onClose={() => { if (!busy) setRemoving(null); }} onConfirm={remove} busy={busy} error={error}/>}
  </details>;
}

export function Integrations({ user, workspace, refresh, notify, notice, composioNotice }) {
  return <div className="view-enter">
    <PageHeading label="WORKSPACE / CONNECTIONS" title="Integrations" subtitle="Connect and manage the app accounts you use with Curiousity."/>
    <ConnectedApps user={user} ready={workspace?.composio?.ready} notice={composioNotice}/>
    {notice && <Banner tone="info">{notice}</Banner>}
    <SavedDestinations workspace={workspace} refresh={refresh} notify={notify}/>
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
    <section className="panel service-panel how-to-panel"><PanelHeading icon={Search} title="Set up Reach and Finder" description="Public discovery in Chat is separate from your AI profiles."/><ol><li>Allow the server to reach the hosted Exa search service at <code>mcp.exa.ai</code> over HTTPS. It can work without a key, subject to free limits.</li><li>For your own Exa quota, set <code>EXA_API_KEY</code> in the server’s environment and allow access to <code>api.exa.ai</code>. An optional <code>YOUTUBE_DATA_API_KEY</code> enables total views for recent YouTube matches. Keep these keys on the server.</li><li>Restart Curiousity after changing the environment. Search skips undated or unconfirmed listings. With AI review on, your selected personal Chat model reviews every match that passes those checks. Without a model, the tools show Source checks only.</li></ol></section>
    <section className="panel service-panel tool-panel"><PanelHeading icon={Download} title="System checks" description="Tools detected on this server."><Button icon={RefreshCw} busy={busy} onClick={check}>Recheck</Button></PanelHeading><div className="tool-list">{[['FFmpeg', online?.ffmpeg, 'Reads and renders media'], ['yt-dlp', online?.ytDlp, 'Imports authorized YouTube sources'], ['Burned captions', online?.subtitles, 'FFmpeg libass subtitle filter'], ['Whisper', online?.whisper, 'Local speech recognition package']].map(([title, ready, detail]) => <div key={title}><div><strong>{title}</strong><p>{detail}</p></div><span className={`badge ${ready ? 'badge-green' : ''}`}><i/>{ready ? 'Installed' : ready === false ? 'Not found' : 'Unknown'}</span></div>)}</div></section>
  </div>;
}
