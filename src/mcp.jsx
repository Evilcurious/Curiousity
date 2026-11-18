import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Code2, Layers, Link2, Play, Plus, RefreshCw, Server, ShieldCheck, Trash2 } from 'lucide-react';
import { api, Banner, Button, Confirm, EmptyState, Glyph, Modal, PageHeading } from './ui.jsx';
import { Field, Select } from './forms.jsx';

const bufferUrl = 'https://mcp.buffer.com/mcp';
export function BufferIcon({ size = 18, ...props }) { return <Layers size={size} strokeWidth={1.8} {...props}/>; }

function McpDialog({ existing, preset, onClose, onSaved }) {
  const [kind, setKind] = useState(existing?.kind || preset || 'remote');
  const [name, setName] = useState(existing?.name || ''), [url, setUrl] = useState(existing?.url || ''), [token, setToken] = useState('');
  const [clearToken, setClearToken] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api(existing ? `/mcp/${existing.id}` : '/mcp', { method: existing ? 'PUT' : 'POST', body: { name, kind, url: kind === 'buffer' ? bufferUrl : url, token, clearToken } });
      onSaved();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <Modal onClose={onClose} title={existing ? 'Edit MCP connection' : kind === 'buffer' ? 'Connect Buffer' : 'Add an MCP server'} subtitle="Your saved connections and credentials are private to your account.">
    <form className="modal-form" onSubmit={save}>
      {!existing && <Field label="Connection type"><Select value={kind} onChange={(event) => { setKind(event.target.value); setToken(''); setClearToken(false); }}><option value="remote">Remote MCP (Streamable HTTP)</option><option value="buffer">Buffer (official)</option></Select></Field>}
      <Field label="Connection name"><input required={kind !== 'buffer'} maxLength={64} value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === 'buffer' ? 'Buffer' : 'e.g. My publishing tools'}/></Field>
      <Field label="Server URL" hint={kind === 'buffer' ? 'Buffer’s official MCP endpoint.' : 'Use an HTTPS Streamable HTTP endpoint. Local commands and stdio are not run.'}><input type="url" value={kind === 'buffer' ? bufferUrl : url} readOnly={kind === 'buffer'} required onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/mcp"/></Field>
      <Field label={kind === 'buffer' ? 'Buffer API key' : 'Bearer token (optional)'} hint={existing?.hasToken ? 'Leave blank to keep the saved token for this URL. Changing the URL clears it.' : 'Paste only the token; it is encrypted on this server.'}><input type="password" autoComplete="new-password" maxLength={4000} value={token} required={kind === 'buffer' && !existing?.hasToken} disabled={clearToken} onChange={(event) => setToken(event.target.value)}/></Field>
      {kind === 'buffer' && <p className="privacy-note"><Link2 size={15}/> <a href="https://publish.buffer.com/settings/api" target="_blank" rel="noreferrer">Get a key in Buffer → Settings → API <ArrowUpRight size={12}/></a></p>}
      {kind === 'remote' && existing?.hasToken && <label className="consent"><input type="checkbox" checked={clearToken} onChange={(event) => setClearToken(event.target.checked)}/>Remove saved token</label>}
      {error && <Banner>{error}</Banner>}
      <div className="modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" tone="primary" icon={Check} busy={busy}>Save connection</Button></div>
    </form>
  </Modal>;
}

function initialArgs(tool) {
  const properties = tool?.inputSchema?.properties || {};
  return JSON.stringify(Object.fromEntries((Array.isArray(tool?.inputSchema?.required) ? tool.inputSchema.required : []).filter((key) => typeof key === 'string').slice(0, 30).map((key) => [key, properties[key]?.default ?? (properties[key]?.type === 'boolean' ? false : properties[key]?.type === 'array' ? [] : properties[key]?.type === 'number' || properties[key]?.type === 'integer' ? 0 : properties[key]?.type === 'object' ? {} : '')])), null, 2);
}
function ToolExplorer({ profile, refresh, onClose }) {
  const [data, setData] = useState(null), [selected, setSelected] = useState(''), [args, setArgs] = useState('{}');
  const [approved, setApproved] = useState(false), [result, setResult] = useState(null), [busy, setBusy] = useState('discover'), [error, setError] = useState('');
  function select(tool) { setSelected(tool?.name || ''); setArgs(initialArgs(tool)); setApproved(false); setResult(null); setError(''); }
  async function discover(signal) {
    setError(''); setBusy('discover');
    try {
      const value = await api(`/mcp/${profile.id}/inspect`, { method: 'POST', signal });
      setData(value); select(value.tools.find((tool) => tool.runnable)); refresh();
    } catch (err) { if (!signal?.aborted) setError(err.message); }
    finally { if (!signal?.aborted) setBusy(''); }
  }
  useEffect(() => { const abort = new AbortController(); discover(abort.signal); return () => abort.abort(); }, [profile.id]);
  const tool = data?.tools.find((item) => item.name === selected);
  async function run() {
    setBusy('run'); setError(''); setResult(null);
    try {
      let parsed;
      try { parsed = JSON.parse(args); } catch { throw new Error('Enter valid JSON for the arguments.'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Arguments must be a JSON object.');
      setResult(await api(`/mcp/${profile.id}/run`, { method: 'POST', body: { name: selected, arguments: parsed, approved } }));
    } catch (err) { setError(err.message); }
    finally { setBusy(''); setApproved(false); }
  }
  return <Modal wide title={`${profile.name} tools`} subtitle={profile.kind === 'buffer' ? 'Inspect your Buffer account and channels. To create a draft, open a finished clip.' : 'Inspect what the server offers. Nothing runs until you review and approve the arguments.'} onClose={onClose}>
    <div className="modal-form">
      {busy === 'discover' && <p className="muted" role="status">Connecting and discovering tools…</p>}
      {data && <p className="muted">{data.serverName || 'Remote server'} · {data.tools.length} {data.tools.length === 1 ? 'tool' : 'tools'}</p>}
      {data?.tools.length > 0 && <Field label="Tool"><Select value={selected} onChange={(event) => select(data.tools.find((item) => item.name === event.target.value))}><option value="">Choose a tool</option>{data.tools.map((item) => <option key={item.name} value={item.name}>{item.name}{item.runnable ? '' : ' · not runnable here'}</option>)}</Select></Field>}
      {tool && <><p className="mcp-description">{tool.description || 'No description supplied by the server.'}</p><details className="mcp-schema"><summary>Input schema</summary><pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre></details></>}
      {tool?.runnable && <><Field label="JSON arguments"><textarea className="mcp-arguments" rows={4} value={args} maxLength={20_000} spellCheck="false" disabled={busy === 'run'} onChange={(event) => { setArgs(event.target.value); setApproved(false); }}/></Field><label className="consent"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)}/>I reviewed the arguments and approve this one tool call.</label></>}
      {result && <div className="mcp-result"><strong>{result.isError ? 'Tool reported an error' : 'Tool response'}</strong><pre>{result.output}</pre></div>}
      {error && <Banner>{error}</Banner>}
      <div className="modal-actions"><Button icon={RefreshCw} onClick={() => discover()} disabled={Boolean(busy)}>Discover again</Button>{tool?.runnable && <Button tone="primary" icon={Play} busy={busy === 'run'} onClick={run} disabled={!approved || busy === 'discover'}>Run approved tool</Button>}</div>
    </div>
  </Modal>;
}

export function McpSettings({ workspace, refresh, notify, preset }) {
  const [dialog, setDialog] = useState(preset === 'buffer' ? 'buffer' : null), [inspect, setInspect] = useState(null), [remove, setRemove] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const profiles = workspace?.mcps || [];
  async function deleted() {
    setBusy(true); setError('');
    try { await api(`/mcp/${remove.id}`, { method: 'DELETE' }); setRemove(null); await refresh(); notify('MCP connection removed.'); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <div className="view-enter">
    <PageHeading label="SETTINGS / TOOLS" title="MCP servers" subtitle="Connect Buffer or a remote MCP service. Discover tools, review their inputs, and run only the calls you approve."><Button tone="primary" icon={Plus} onClick={() => setDialog('remote')}>Add MCP server</Button></PageHeading>
    <section className="panel feature-panel mcp-feature"><Glyph icon={BufferIcon}/><div><p className="eyebrow">OFFICIAL INTEGRATION</p><h2>Buffer</h2><p>Use your Buffer account to browse channels and send reviewed clip drafts. Nothing is scheduled automatically.</p></div><Button icon={Link2} onClick={() => setDialog('buffer')}>Connect Buffer</Button></section>
    <div className="section-heading settings-section-title"><h2>Saved connections</h2><span className="muted">{profiles.length} saved</span></div>
    <div className="panel profile-panel">
      {profiles.length ? profiles.map((profile) => <div className="profile-row mcp-row" key={profile.id}><Glyph icon={profile.kind === 'buffer' ? BufferIcon : Server} subtle/><div className="profile-info"><h3>{profile.name}</h3><p>{profile.url}</p><p>{profile.checkedAt ? 'Tools discovered' : 'Not checked yet'} · {profile.hasToken ? 'Token saved' : 'No token'}</p></div><div className="profile-actions"><Button icon={Code2} onClick={() => setInspect(profile)}>Discover tools</Button><Button onClick={() => setDialog(profile)}>Edit</Button><button className="icon-button" aria-label={`Remove ${profile.name}`} onClick={() => { setError(''); setRemove(profile); }}><Trash2 size={16}/></button></div></div>) : <EmptyState icon={Server} title="No MCP servers connected" action={<Button icon={Plus} onClick={() => setDialog('remote')}>Add a server</Button>}>Use the Buffer preset or enter a Streamable HTTP URL and optional bearer token.</EmptyState>}
    </div>
    <p className="privacy-note"><ShieldCheck size={16}/> MCP tools can read or change data in the connected account. Only connect servers you trust. Credentials and tool results aren’t sent to your AI models.</p>
    {dialog && <McpDialog existing={typeof dialog === 'object' ? dialog : null} preset={typeof dialog === 'string' ? dialog : null} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh(); notify('MCP connection saved. Use Discover tools to test it.'); }}/>}
    {inspect && <ToolExplorer profile={inspect} refresh={refresh} onClose={() => setInspect(null)}/>}
    {remove && <Confirm title={`Remove ${remove.name}?`} message="This removes the saved connection and token from your account. It does not remove any drafts or revoke the key at the external service." label="Remove server" onClose={() => setRemove(null)} onConfirm={deleted} busy={busy} error={error}/>}
  </div>;
}
