import { useEffect, useState } from 'react';
import { ArrowUpRight, Cable, Check, ChevronRight, Copy, Link2, LockKeyhole, Plug, Plus, RefreshCw, Search, Unplug } from 'lucide-react';
import { ActionLink, api, Banner, Button, Confirm, Glyph, Modal, PanelHeading } from './ui.jsx';
import { Field } from './forms.jsx';
import { isMissingApi } from './api-errors.mjs';
import './composio.css';

const returnPath = (from) => from === 'chat' ? '#/chat?apps=1' : '#/settings/integrations';
const notices = {
  connected: ['success', 'Authorization verified. Your app is ready to use if it’s listed as Connected.'],
  signin: ['warning', 'Sign in and start the connection again from the same browser tab.'],
  restart: ['warning', 'This connection was not started in this sign-in session or has expired. Start again with Connect.'],
  verifier: ['error', 'Authorization was not verified. Ask your administrator to set the Callback Identity Verifier in the Composio project, then try again.'],
  failed: ['error', 'Could not verify the connection. Check the permissions and try Connect again from this tab.'],
};
export function appAccountLabel(row) { return row.alias ? `${row.alias} · ${row.id.slice(-6)}` : `Account · ${row.id.slice(-6)}`; }

function AppCatalog({ from, onClose }) {
  const [input, setInput] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(null), [apps, setApps] = useState([]), [next, setNext] = useState(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  const [picked, setPicked] = useState(null), [alias, setAlias] = useState(''), [connecting, setConnecting] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const params = new URLSearchParams({ ...(query && { q: query }), ...(page && { cursor: page }) });
    api(`/composio/apps?${params}`, { signal: controller.signal }).then(({ apps: rows, next: cursor }) => {
      setApps((prior) => page ? [...new Map([...prior, ...rows].map((row) => [row.slug, row])).values()] : rows);
      setNext(cursor === page ? null : cursor);
    }).catch((err) => { if (!controller.signal.aborted) setError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, page, revision]);
  async function connect(event) {
    event.preventDefault();
    if (!picked || connecting) return;
    setConnecting(true); setError('');
    try {
      const { url } = await api('/composio/connect', { method: 'POST', body: { slug: picked.slug, alias, from } });
      window.location.assign(url);
    } catch (err) { setError(err.message); setConnecting(false); }
  }
  function search(event) {
    event.preventDefault();
    setApps([]); setNext(null); setQuery(input.trim()); setPage(null); setRevision((value) => value + 1);
  }
  return <Modal wide title={picked ? `Connect ${picked.name}` : 'Connect an app'} subtitle={picked ? 'Authorize your own account on Composio. You’ll return to Curiousity when it’s verified.' : 'Search Composio’s supported apps and choose the one you want to authorize.'} onClose={() => { if (!connecting) onClose(); }}>
    {picked ? <form className="modal-form" onSubmit={connect}>
      <Field label="Account label (optional)" hint="Use a label such as Work or Personal so you can tell your accounts apart in Chat."><input value={alias} maxLength={80} autoComplete="off" placeholder="e.g. Work" onChange={(event) => setAlias(event.target.value)}/></Field>
      <p className="privacy-note"><LockKeyhole size={15}/> Review the permissions on the sign-in page. Curiousity does not receive your app password or OAuth tokens.</p>
      {error && <Banner>{error}</Banner>}
      <div className="modal-actions"><Button disabled={connecting} onClick={() => { setPicked(null); setError(''); }}>Back to apps</Button><Button tone="primary" type="submit" icon={ArrowUpRight} busy={connecting}>Continue to Composio</Button></div>
    </form> : <div className="composio-catalog">
      <form className="composio-search" onSubmit={search}><label className="search-field"><Search size={17}/><input type="search" aria-label="Search apps" placeholder="Find an app…" value={input} maxLength={80} onChange={(event) => setInput(event.target.value)}/></label><Button type="submit">Search</Button></form>
      {error && <Banner>{error}</Banner>}
      {!loading && !error && !apps.length && <p className="composio-empty">No supported apps on this page. Try a different search{next ? ' or load more' : ''}.</p>}
      <div className="composio-app-list" aria-label="App catalog">{apps.map((app) => <button className="composio-app-option" type="button" key={app.slug} onClick={() => { setPicked(app); setAlias(''); setError(''); }}>
        <Glyph icon={Plug} subtle/><span><strong>{app.name}</strong>{app.description && <small>{app.description}</small>}</span><ChevronRight size={17}/>
      </button>)}</div>
      {loading ? <p className="composio-empty" role="status">Loading apps…</p> : next && <Button className="composio-more" onClick={() => setPage(next)}>Load more apps</Button>}
    </div>}
  </Modal>;
}

export function ConnectedApps({ user, ready, from = 'integrations', notice, onConnections }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  const [browse, setBrowse] = useState(false), [disconnect, setDisconnect] = useState(null), [removing, setRemoving] = useState(false), [removeError, setRemoveError] = useState('');
  const embedded = window.self !== window.top;
  const callback = Object.hasOwn(notices, notice) ? notices[notice] : null;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api('/composio/connections', { signal: controller.signal }).then((result) => { setData(result); onConnections?.(result.connections); }).catch((err) => {
      if (!controller.signal.aborted) {
        setError(isMissingApi(err) ? 'This server needs the Curiousity update that adds Composio.' : err.message);
        setData(null); onConnections?.([]);
      }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision, ready, onConnections]);
  async function remove() {
    if (!disconnect || removing) return;
    setRemoving(true); setRemoveError('');
    try {
      await api(`/composio/connections/${disconnect.id}`, { method: 'DELETE' });
      const connections = (data?.connections || []).filter(({ id }) => id !== disconnect.id);
      setData({ ...data, connections }); onConnections?.(connections); setDisconnect(null);
    } catch (err) { setRemoveError(err.message); }
    finally { setRemoving(false); }
  }
  const available = data?.ready === true && ready !== false;
  const rows = data?.connections || [];
  const count = rows.filter((row) => row.status === 'ACTIVE').length;
  return <section className={`panel composio-hub ${from === 'chat' ? 'composio-hub-compact' : ''}`} aria-label="Connected apps">
    <div className="composio-hero">
      <Glyph icon={Cable}/>
      <div><p className="eyebrow">POWERED BY COMPOSIO</p><h2>{from === 'chat' ? 'Connected apps' : 'Connect your apps'}</h2>
        <p>{from === 'chat' ? 'Choose an account below and ask your model to use it. Every action needs your review.' : 'Authorize the apps you use, then work with them directly in Chat. Only you can use your connections.'}</p></div>
      <div className="composio-hero-actions">
        {embedded && available ? <ActionLink tone="primary" icon={ArrowUpRight} href={`${window.location.origin}/${returnPath(from)}`} target="_blank" rel="noreferrer">Connect</ActionLink> : <Button icon={Plus} tone="primary" disabled={!available || loading} onClick={() => setBrowse(true)}>Connect</Button>}
        {embedded && available && <small>Opens in its own tab</small>}
      </div>
    </div>
    <div className="composio-accounts">
      {callback && <Banner tone={callback[0]} icon={callback[0] === 'success' ? Check : undefined}>{callback[1]}</Banner>}
      {error && <Banner>{error}</Banner>}
      {data && !available && <div className="composio-empty"><LockKeyhole size={17}/><span>{data.configured ? 'App connections are paused for this workspace.' : 'Composio is not set up for this workspace yet.'} {user?.role === 'admin' ? <a href="#/settings/admin">Open Admin to configure Composio</a> : 'Ask your administrator to enable it.'}</span></div>}
      {(available || loading || error) && <div className="composio-list-head"><div><h3>Your connections</h3>{available && <span className={`badge ${count ? 'badge-green' : ''}`}><i/>{count} connected</span>}</div><Button icon={RefreshCw} busy={loading} onClick={() => setRevision((n) => n + 1)}>Refresh</Button></div>}
      {!loading && !error && available && !rows.length && <div className="composio-empty"><Link2 size={17}/><span>No apps connected. Select <strong>Connect</strong> to get started.</span></div>}
      {available && rows.map((row) => <div className="composio-account" key={row.id}>
        <Glyph icon={Plug} subtle/><div><h4>{row.name}</h4><p>{appAccountLabel(row)}</p></div>
        <div><span className={`badge ${row.status === 'ACTIVE' ? 'badge-green' : ''}`}><i/>{row.status === 'ACTIVE' ? 'Connected' : 'Needs reconnect'}</span><Button icon={Unplug} aria-label={`Disconnect ${row.name} ${appAccountLabel(row)}`} onClick={() => { setRemoveError(''); setDisconnect(row); }}>Disconnect</Button></div>
      </div>)}
      {from === 'integrations' && available && count > 0 && <div className="composio-next"><ActionLink icon={ArrowUpRight} href={returnPath('chat')}>Use in Chat</ActionLink></div>}
    </div>
    {browse && available && <AppCatalog from={from} onClose={() => setBrowse(false)}/>}
    {disconnect && <Confirm title={`Disconnect ${disconnect.name}?`} message="This removes the connection from Curiousity and asks Composio to revoke its credentials. Content already sent or created stays in the app. You can also revoke access in the app’s security settings." label="Disconnect app" onClose={() => { if (!removing) setDisconnect(null); }} onConfirm={remove} busy={removing} error={removeError}/>}
  </section>;
}

export function ComposioAdmin({ refresh, notify }) {
  const [config, setConfig] = useState(null), [key, setKey] = useState(''), [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0), [error, setError] = useState('');
  const [forget, setForget] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true); setError('');
    api('/admin/composio', { signal: ctrl.signal }).then((result) => { setConfig(result); setEnabled(result.enabled); }).catch((err) => { if (!ctrl.signal.aborted) setError(err.message); }).finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [revision]);
  async function save(clear = false) {
    if (!config || busy) return;
    setBusy(true); setError('');
    try {
      const result = await api('/admin/composio', { method: 'PUT', body: { enabled: clear ? false : enabled, ...(clear ? { apiKey: null } : key.trim() && { apiKey: key.trim() }) } });
      setConfig(result); setEnabled(result.enabled); setKey(''); setForget(false);
      void refresh?.(); notify(clear ? 'Saved Composio key removed.' : 'Composio settings saved.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(config.callbackUrl); notify('Verifier URL copied.'); }
    catch { notify('Select the verifier URL to copy it.'); }
  }
  return <section className="panel service-panel composio-admin" aria-label="Composio setup">
    <PanelHeading icon={Cable} title="Composio" description="Set up one Platform project so members can connect their own apps.">
      {config && <span className={`badge ${config.ready ? 'badge-green' : ''}`}><i/>{config.ready ? 'Enabled' : config.configured ? 'Paused' : 'Not configured'}</span>}
    </PanelHeading>
    {!forget && error && <Banner>{error}</Banner>}
    {loading ? <p className="muted">Loading Composio settings…</p> : !config ? <Button icon={RefreshCw} onClick={() => setRevision((n) => n + 1)}>Retry</Button> : <div className="composio-admin-grid">
      <div className="composio-admin-guide">
        <h3>Platform setup</h3>
        <ol><li>Create a dedicated <strong>Platform</strong> project in the <a href="https://dashboard.composio.dev/" target="_blank" rel="noreferrer">Composio dashboard <ArrowUpRight size={13}/></a>.</li>
          <li>In that project’s Settings → General → Configuration, set <strong>Callback Identity Verifier</strong> to this URL:</li></ol>
        {config.callbackUrl ? <div className="composio-url"><code>{config.callbackUrl}</code><button type="button" className="icon-button" aria-label="Copy verifier URL" onClick={copy}><Copy size={16}/></button></div> : <Banner tone="warning">Set <code>PUBLIC_ORIGIN</code> to your public HTTPS origin on the server and restart to get a verifier URL.</Banner>}
        <p>Enter the project key, then enable member access. Test a connection from Integrations before inviting members.</p>
      </div>
      <form className="modal-form" onSubmit={(event) => { event.preventDefault(); save(); }}>
        {config.keySource === 'environment' ? <p className="privacy-note"><LockKeyhole size={15}/> The project key is supplied by the server’s <code>COMPOSIO_API_KEY</code>.</p> : <Field label="Composio project API key" hint={config.configured ? 'Leave blank to keep the saved key. It is never shown after saving.' : 'Use a Platform project key, not a For You key.'}>
          <input type="password" spellCheck={false} value={key} onChange={(event) => setKey(event.target.value)} autoComplete="new-password" maxLength={512} placeholder={config.configured ? 'Key saved securely' : 'Paste the project key'}/>
        </Field>}
        <label className="consent composio-enable"><input type="checkbox" checked={enabled} disabled={!config.callbackUrl || busy} onChange={(event) => setEnabled(event.target.checked)}/><span>Enable Composio for members<br/><small>Enable only after setting the verifier URL in this project.</small></span></label>
        <div className="composio-admin-actions"><Button tone="primary" type="submit" icon={Check} busy={busy && !forget} disabled={busy || (enabled && !config.configured && !key.trim())}>Save Composio settings</Button>{config.configured && config.keySource === 'workspace' && <Button disabled={busy} icon={Unplug} onClick={() => { setError(''); setForget(true); }}>Remove key</Button>}</div>
      </form>
    </div>}
    {forget && <Confirm title="Remove the Composio project key?" message="This pauses app access for everyone. It doesn’t revoke their remote accounts or remove their verified connection records. To revoke access, disconnect the app while the original project is active or revoke it at the provider." label="Remove saved key" onClose={() => { if (!busy) setForget(false); }} onConfirm={() => save(true)} busy={busy} error={error}/>}
  </section>;
}
