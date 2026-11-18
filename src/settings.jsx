import { cloneElement, useEffect, useId, useState } from 'react';
import { ArrowUpRight, BookOpen, Captions, Check, ChevronDown, CircleHelp, Clipboard, Cpu, Download, Eye, EyeOff, KeyRound, Link2, LockKeyhole, Plus, RefreshCw, Server, ShieldCheck, Sparkles, Terminal, Trash2, Unplug } from 'lucide-react';
import { ActionLink, api, Banner, Button, Confirm, EmptyState, Glyph, Modal, PageHeading, PanelHeading, TikTokIcon } from './ui.jsx';

const providers = {
  openai: { name: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic: { name: 'Anthropic', url: 'https://api.anthropic.com/v1' },
  gemini: { name: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta' },
  openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  groq: { name: 'Groq', url: 'https://api.groq.com/openai/v1' },
  ollama: { name: 'Ollama', url: 'http://127.0.0.1:11434/v1' },
  custom: { name: 'OpenAI-compatible', url: '' },
};
function Field({ label, hint, children }) {
  const id = useId();
  return <div className="form-field"><label htmlFor={id}>{label}</label>{cloneElement(children, { id, 'aria-describedby': hint ? `${id}-hint` : undefined })}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
function PasswordInput({ show, onToggle, ...props }) {
  return <div className="password-field"><input type={show ? 'text' : 'password'} autoComplete="new-password" spellCheck="false" {...props}/><button type="button" className="field-icon-button" aria-label={show ? 'Hide key' : 'Show key'} onClick={onToggle}>{show ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div>;
}
function Select({ onChange, children, ...attrs }) { return <span className="select-wrap"><select {...attrs} onChange={onChange}>{children}</select><ChevronDown size={15}/></span>; }

function ProviderDialog({ existing, onClose, onSaved }) {
  const [fields, setFields] = useState(existing ? { ...existing, apiKey: '' } : { type: 'openai', name: '', baseUrl: providers.openai.url, apiKey: '', model: providers.openai.model });
  const [showKey, setShowKey] = useState(false), [models, setModels] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const definition = providers[fields.type];
  const configurable = ['custom', 'ollama'].includes(fields.type);
  const set = (key, value) => setFields((state) => ({ ...state, [key]: value }));
  function setType(type) {
    setModels(null); setError('');
    setFields((state) => ({ ...state, type, baseUrl: providers[type].url, model: providers[type].model || '', apiKey: '' }));
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
  return <Modal title={existing ? 'Edit provider' : 'Add an AI provider'} subtitle="Save a named profile with its own key and model. You can add more than one profile per provider." onClose={onClose}>
    <form className="modal-form" onSubmit={(event) => { event.preventDefault(); submit('save'); }}>
      <div className="form-pair"><Field label="Provider"><Select value={fields.type} onChange={(event) => setType(event.target.value)}>{Object.entries(providers).map(([key, val]) => <option key={key} value={key}>{val.name}</option>)}</Select></Field><Field label="Profile name"><input value={fields.name} maxLength={60} onChange={(event) => set('name', event.target.value)} placeholder={definition.name}/></Field></div>
      {configurable && <Field label="API base URL" hint="Include /v1 or the path your server expects. The address is resolved from the Clipforge host."><input type="url" value={fields.baseUrl} onChange={(event) => { set('baseUrl', event.target.value); setModels(null); }} placeholder="https://example.com/v1" required={fields.type === 'custom'}/></Field>}
      <Field label={configurable ? 'API key (optional)' : 'API key'} hint="Keys are encrypted on the server and never returned to the browser."><PasswordInput show={showKey} onToggle={() => setShowKey(!showKey)} value={fields.apiKey} onChange={(event) => { set('apiKey', event.target.value); setModels(null); }} placeholder={existing?.hasKey && existing.type === fields.type ? 'Leave blank to keep the saved key' : 'Paste your API key'}/></Field>
      <div className="model-field"><Field label="Chat model ID" hint="Enter a model manually or fetch the provider’s catalog."><input value={fields.model} maxLength={160} onChange={(event) => set('model', event.target.value)} placeholder="Model ID" spellCheck="false"/></Field><Button onClick={() => submit('models')} busy={busy === 'models'} disabled={busy === 'save'} icon={RefreshCw}>Fetch models</Button></div>
      {models && (models.length ? <Field label="Available models"><Select value={models.includes(fields.model) ? fields.model : ''} onChange={(event) => { if (event.target.value) set('model', event.target.value); }}><option value="">Choose a model</option>{models.map((model) => <option key={model} value={model}>{model}</option>)}</Select></Field> : <Banner tone="warning" icon={CircleHelp}>No models were listed. You can still enter a model ID manually.</Banner>)}
      {error && <Banner>{error}</Banner>}
      <div className="modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" icon={Check} tone="primary" busy={busy === 'save'} disabled={busy === 'models'}>Save profile</Button></div>
    </form>
  </Modal>;
}

export function Providers({ workspace, refresh, notify }) {
  const [dialog, setDialog] = useState(null), [confirm, setConfirm] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [captionId, setCaptionId] = useState(''), [captionModel, setCaptionModel] = useState('');
  const profiles = workspace?.providers || [];
  const active = profiles.find((p) => p.id === workspace?.activeProviderId);
  const compatible = profiles.filter((p) => !['anthropic', 'gemini'].includes(p.type));
  useEffect(() => { setCaptionId(workspace?.captions.providerId || ''); setCaptionModel(workspace?.captions.model || ''); }, [workspace?.captions.providerId, workspace?.captions.model]);
  async function run(action, fn, message) {
    setBusy(action); setError('');
    try { await fn(); await refresh(); notify(message); setConfirm(null); }
    catch (err) { setError(err.message); if (!confirm) notify(err.message, 'error'); }
    finally { setBusy(''); }
  }
  const activate = (id) => run(id || 'local', () => api('/settings/ranking', { method: 'PUT', body: { providerId: id } }), id ? 'Highlight model updated.' : 'Switched to local analysis.');
  return <div className="view-enter">
    <PageHeading label="WORKSPACE / AI" title="AI providers" subtitle="Bring your own API keys and choose the model that ranks your highlights."><Button tone="primary" icon={Plus} onClick={() => setDialog('new')}>Add provider</Button></PageHeading>
    <div className="panel feature-panel ranking-banner"><Glyph icon={Sparkles}/><div><p className="eyebrow">ACTIVE HIGHLIGHT ENGINE</p><h2>{active?.name || 'Local analysis'}</h2><p>{active ? active.model : 'Scores transcript cues, audio activity, and replay data when available. No API key required.'}</p></div>{active ? <Button icon={Cpu} busy={busy === 'local'} onClick={() => activate(null)}>Use local analysis</Button> : <span className="badge badge-green"><i/>Active</span>}</div>
    <div className="section-heading settings-section-title"><h2>Provider profiles</h2><span className="muted">{profiles.length} saved</span></div>
    <div className="panel profile-panel">
      {profiles.length ? profiles.map((profile) => <div className="profile-row" key={profile.id}><Glyph icon={Cpu} subtle/><div className="profile-info"><h3>{profile.name}</h3><p>{providers[profile.type]?.name} · {profile.model || 'No chat model selected'}</p></div><div className="profile-actions">{active?.id === profile.id ? <span className="badge badge-green"><i/>Active</span> : <Button disabled={!profile.model} busy={busy === profile.id} onClick={() => activate(profile.id)}>Use model</Button>}<Button onClick={() => setDialog(profile)}>Edit</Button><button className="icon-button" title="Remove provider" aria-label={`Remove ${profile.name}`} onClick={() => { setError(''); setConfirm(profile); }}><Trash2 size={16}/></button></div></div>) : <EmptyState icon={KeyRound} title="No providers added" action={<Button icon={Plus} onClick={() => setDialog('new')}>Add a provider</Button>}>Add OpenAI, Anthropic, Gemini, OpenRouter, Groq, Ollama, or an OpenAI-compatible endpoint.</EmptyState>}
    </div>
    <section className="panel service-panel">
      <PanelHeading icon={Captions} title="Caption engine" description="Used when no usable captions come with the source."/>
      <form className="caption-form" onSubmit={(event) => { event.preventDefault(); run('captions', () => api('/settings/captions', { method: 'PUT', body: { providerId: captionId, model: captionModel } }), 'Caption engine updated.'); }}>
        <Field label="Transcription provider"><Select value={captionId} onChange={(event) => { setCaptionId(event.target.value); const profile = compatible.find((item) => item.id === event.target.value); setCaptionModel(profile?.type === 'openai' ? 'whisper-1' : profile?.type === 'groq' ? 'whisper-large-v3-turbo' : ''); }}><option value="">Local Whisper</option>{compatible.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        {captionId && <Field label="Transcription model" hint="Must support verbose_json with segment timestamps."><input value={captionModel} onChange={(event) => setCaptionModel(event.target.value)} maxLength={160} spellCheck="false" placeholder="e.g. whisper-1" required/></Field>}
        <Button type="submit" busy={busy === 'captions'} icon={Check}>Save transcription</Button>
      </form>
      <p className="privacy-note"><ShieldCheck size={16}/> External models may receive transcript excerpts or audio and incur usage costs. Keep Local analysis and Local Whisper selected to avoid sending content to AI providers.</p>
    </section>
    {dialog && <ProviderDialog existing={dialog === 'new' ? null : dialog} onClose={() => setDialog(null)} onSaved={(message) => { setDialog(null); refresh(); notify(message); }}/>}
    {confirm && <Confirm title={`Remove ${confirm.name}?`} message="Any workflow using this profile will return to its local engine." label="Remove profile" onClose={() => setConfirm(null)} busy={busy === 'remove'} error={error} onConfirm={() => run('remove', () => api(`/providers/${confirm.id}`, { method: 'DELETE' }), 'Provider removed.')}/>}
  </div>;
}

export function Integrations({ workspace, refresh, notify, notice }) {
  const tiktok = workspace?.tiktok;
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
  return <div className="view-enter">
    <PageHeading label="WORKSPACE / CONNECTIONS" title="Integrations" subtitle="Connect services to your self-hosted workspace."/>
    {notice && <Banner tone={notice === 'TikTok connected.' ? 'success' : 'error'} icon={notice === 'TikTok connected.' ? Check : CircleHelp}>{notice}</Banner>}
    <section className="panel service-panel integration-panel">
      <PanelHeading icon={TikTokIcon} title="TikTok" description="Send approved video drafts to the TikTok inbox."><span className={`badge ${tiktok?.connected ? 'badge-green' : ''}`}><i/>{tiktok?.connected ? 'Connected' : 'Not connected'}</span></PanelHeading>
      {tiktok?.connected ? <div className="connection-row"><div><strong>{tiktok.account.name}</strong><p>To publish a draft, open its notification in TikTok.</p></div><Button icon={Unplug} onClick={() => { setError(''); setDisconnect(true); }}>Disconnect</Button></div> : <div className="connection-row"><div><strong>Creator account</strong><p>{tiktok?.configured ? 'Authorize the account that should receive drafts.' : 'Save your developer app settings to connect an account.'}</p></div><Button icon={Link2} tone="primary" busy={busy === 'connect'} disabled={!tiktok?.configured} onClick={() => run('connect')}>Connect account</Button></div>}
      {tiktok?.managedByEnv ? <p className="privacy-note"><LockKeyhole size={16}/> This app is configured with server environment variables.</p> : <form className="modal-form integration-form" onSubmit={(event) => { event.preventDefault(); run('save'); }}>
        <h3>Developer app settings</h3>
        <div className="form-pair"><Field label="Client key"><input required value={fields.clientKey} onChange={(event) => field('clientKey', event.target.value)} autoComplete="off" maxLength={180} placeholder="TikTok app client key"/></Field><Field label="Client secret"><input type="password" required={!tiktok?.configured} value={fields.clientSecret} onChange={(event) => field('clientSecret', event.target.value)} autoComplete="new-password" maxLength={500} placeholder={tiktok?.configured ? 'Leave blank to keep saved secret' : 'TikTok app client secret'}/></Field></div>
        <Field label="OAuth redirect URL" hint="Open Clipforge on this HTTPS domain and register this exact URL in TikTok’s Login Kit."><input type="url" required value={fields.redirectUri} onChange={(event) => field('redirectUri', event.target.value)} placeholder="https://clips.example.com/api/tiktok/callback"/></Field>
        <div className="integration-save"><Button icon={Check} type="submit" busy={busy === 'save'}>Save configuration</Button></div>
      </form>}
      {error && !disconnect && <Banner>{error}</Banner>}
    </section>
    <section className="panel service-panel how-to-panel"><PanelHeading icon={BookOpen} title="Set up TikTok access" description="Use TikTok’s official Login Kit and Content Posting API."/><ol><li>Create an app in <a href="https://developers.tiktok.com/" target="_blank" rel="noreferrer">TikTok for Developers <ArrowUpRight size={13}/></a> and add Login Kit and Content Posting API.</li><li>Register the HTTPS callback and request the <code>user.info.basic</code> and <code>video.upload</code> scopes for the account.</li><li>Connect the account here. In a finished project, select clips and confirm the draft upload after previewing them.</li></ol><p className="privacy-note"><ShieldCheck size={16}/> TikTok approval and upload limits apply. Clipforge does not publish unattended to a public feed.</p></section>
    {disconnect && <Confirm title="Disconnect TikTok?" message="This removes the saved account tokens from Clipforge. Drafts already sent to TikTok will stay there." label="Disconnect" onClose={() => setDisconnect(false)} onConfirm={() => run('disconnect')} busy={busy === 'disconnect'} error={error}/>}
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
    <PageHeading label="SELF-HOSTED WORKSPACE" title="Setup guide" subtitle="Run Clipforge on your computer or bring it to your own server."/>
    <div className="setup-grid"><section className="panel service-panel"><PanelHeading icon={Terminal} title="Run locally" description="Node.js 22+, Python 3.10+ and a terminal."/><p className="setup-copy">From the repository folder, install the website and media tools. Then open <code>http://localhost:5173</code>.</p><CommandBlock notify={notify}>{'npm ci\nnpm run setup\nnpm run dev'}</CommandBlock><p className="setup-copy">The first local transcription downloads the Whisper model. To fetch it ahead of time, run <code>npm run setup -- --download-model</code>.</p></section>
    <section className="panel service-panel"><PanelHeading icon={Server} title="Run on a VPS" description="Use Docker Compose or a Node process."/><p className="setup-copy">Copy the example environment file and set a strong <code>AUTH_PASSWORD</code> before starting.</p><CommandBlock notify={notify}>{'cp .env.example .env\n# Edit .env to set AUTH_PASSWORD\ndocker compose up -d --build'}</CommandBlock><p className="setup-copy">Proxy the app through HTTPS and keep port 5173 private. See the repository README for example deployment and data backup instructions.</p></section></div>
    <section className="panel service-panel tool-panel"><PanelHeading icon={Download} title="System checks" description="Tools detected on this server."><Button icon={RefreshCw} busy={busy} onClick={check}>Recheck</Button></PanelHeading><div className="tool-list">{[['FFmpeg', online?.ffmpeg, 'Reads and renders media'], ['yt-dlp', online?.ytDlp, 'Imports authorized YouTube sources'], ['Burned captions', online?.subtitles, 'FFmpeg libass subtitle filter'], ['Whisper', online?.whisper, 'Local speech recognition package']].map(([title, ready, detail]) => <div key={title}><div><strong>{title}</strong><p>{detail}</p></div><span className={`badge ${ready ? 'badge-green' : ''}`}><i/>{ready ? 'Installed' : ready === false ? 'Not found' : 'Unknown'}</span></div>)}</div></section>
  </div>;
}
