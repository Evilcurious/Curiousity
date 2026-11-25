import { useState } from 'react';
import { ExternalLink, HardDrive, Save, ShieldCheck, Unplug } from 'lucide-react';
import { Field } from './forms.jsx';
import { ActionLink, api, Banner, Button, Confirm, PanelHeading, TikTokIcon } from './ui.jsx';
import './integrations.css';

const label = { google: 'Google', tiktok: 'TikTok' };

function OAuthConfig({ site, settings, origin, refresh, notify }) {
  const field = site === 'google' ? 'clientId' : 'clientKey';
  const [id, setId] = useState(settings?.[field] || ''), [secret, setSecret] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const callback = `${origin}/api/${site}/callback`;
  const managed = settings?.managedByEnv;
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api(`/${site}/config`, { method: 'PUT', body: { [field]: id.trim(), clientSecret: secret, redirectUri: callback } });
      setSecret(''); await refresh(); notify(`${label[site]} OAuth app saved. Members can now authorize their own accounts.`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <div className="oauth-card">
    <h3>{label[site]}</h3>
    <p>{site === 'google' ? 'Register a Web application OAuth client. Enable the Drive API and/or YouTube Data API, and configure the consent screen.' : 'Use a TikTok app with Login Kit and Content Posting API Upload access. Request user.info.basic and video.upload.'}</p>
    <p>Register this exact redirect URL:</p><code className="oauth-callback">{managed ? settings.redirectUri : callback}</code>
    {managed ? <p>Controlled by server environment variables. This app is available to members without sharing the secret or the administrator’s account.</p> : <form className="modal-form integration-form" onSubmit={save}>
      <Field label={`${label[site]} ${site === 'google' ? 'client ID' : 'client key'}`}><input maxLength={site === 'google' ? 240 : 180} value={id} required onChange={(event) => setId(event.target.value)}/></Field>
      <Field label={`${label[site]} client secret`}><input type="password" autoComplete="new-password" maxLength={500} value={secret} required={id.trim() !== settings?.[field] || !settings?.configured} onChange={(event) => setSecret(event.target.value)} placeholder={settings?.configured ? 'Saved · leave blank to keep' : ''}/></Field>
      {error && <Banner>{error}</Banner>}
      <Button icon={Save} type="submit" tone="primary" busy={busy}>Save {label[site]} app</Button>
      {site === 'tiktok' && !origin.startsWith('https:') && <p>TikTok requires an HTTPS workspace origin.</p>}
    </form>}
  </div>;
}

export function SocialAdmin({ workspace, refresh, notify }) {
  return <section className="panel service-panel integration-panel">
    <PanelHeading icon={ShieldCheck} title="Google and TikTok OAuth apps" description="Configure the app credentials once. Members authorize and manage their own accounts in Integrations."/>
    {workspace && <div className="integration-grid">{Object.keys(label).map((site) => <OAuthConfig key={site} site={site} settings={workspace[site]} origin={workspace.oauthOrigin || window.location.origin} refresh={refresh} notify={notify}/>)}</div>}
  </section>;
}

export function SocialConnections({ workspace, user, refresh, notify }) {
  const google = workspace?.google, tiktok = workspace?.tiktok;
  const [targets, setTargets] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [removing, setRemoving] = useState(null);
  const selected = targets ?? (google?.connected ? Object.keys(google.grants).filter((key) => google.grants[key]) : ['drive']);
  function toggle(target, checked) { setTargets(checked ? [...selected, target] : selected.filter((id) => id !== target)); }
  async function connect(site) {
    setBusy(site); setError('');
    try {
      const { url } = await api(`/${site}/connect`, { method: 'POST', body: site === 'google' ? { targets: selected } : {} });
      window.location.assign(url);
    } catch (err) { setError(err.message); setBusy(''); }
  }
  async function remove() {
    setBusy('disconnect'); setError('');
    try {
      await api(`/${removing.site}/disconnect`, { method: 'POST', body: removing.id ? { accountId: removing.id } : {} });
      await refresh(); notify(`${label[removing.site]} disconnected.`); setRemoving(null);
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  const unavailable = (site) => <p>{workspace ? <>The administrator must configure the {label[site]} app first. {user.role === 'admin' && <a className="setting-link" href="#/settings/admin">Open Admin</a>}</> : 'Checking configuration…'}</p>;
  const disconnect = (site, name, id) => <Button icon={Unplug} disabled={Boolean(busy)} aria-label={`Disconnect ${name}`} onClick={() => { setError(''); setRemoving({ site, name, id }); }}>Disconnect</Button>;
  return <section className="panel service-panel integration-panel">
    <PanelHeading icon={ShieldCheck} title="Your delivery accounts" description="Authorize your own accounts for reviewed clip delivery. This won’t change your Curiousity sign-in."/>
    {error && !removing && <Banner>{error}</Banner>}
    <div className="integration-grid">
      <div className="oauth-card"><h3><HardDrive size={18}/> Google</h3>
        {google?.configured ? <>
          {google.connected && <div className="connection-row"><div><strong>{google.account.name}</strong><p>Connected only to your workspace account</p></div>{disconnect('google', google.account.name)}</div>}
          {google.hasSavedAccount && !google.connected && <div className="connection-row"><p>Reconnect to use this account again.</p>{disconnect('google', 'saved Google account')}</div>}
          <p>Choose the permissions to request. Clip uploads are reviewed before sending.</p>
          <label className="consent"><input type="checkbox" checked={selected.includes('drive')} onChange={(event) => toggle('drive', event.target.checked)}/><span>Save MP4s to Google Drive</span></label>
          <label className="consent"><input type="checkbox" checked={selected.includes('youtube')} onChange={(event) => toggle('youtube', event.target.checked)}/><span>Upload private YouTube videos</span></label>
          <Button icon={ExternalLink} tone="primary" busy={busy === 'google'} disabled={!selected.length || Boolean(busy)} onClick={() => connect('google')}>{google.connected ? 'Reconnect Google' : 'Connect Google'}</Button>
        </> : unavailable('google')}
      </div>
      <div className="oauth-card"><h3><TikTokIcon size={18}/> TikTok</h3>
        {tiktok?.configured ? <>
          <p>Send reviewed videos to your TikTok inbox to finish posting in TikTok.</p>
          <p>{tiktok.accounts.filter((row) => row.available).length} / {tiktok.accountLimit ?? 'unlimited'} accounts enabled</p>
          {tiktok.accounts.map((row) => <div className="connection-row" key={row.id}><div><strong>{row.name}</strong><p>{row.available ? 'Available for inbox drafts' : 'Over the plan limit or needs reconnection'}</p></div>{disconnect('tiktok', row.name, row.id)}</div>)}
          <Button icon={ExternalLink} tone="primary" busy={busy === 'tiktok'} disabled={Boolean(busy)} onClick={() => connect('tiktok')}>{tiktok.connected ? 'Authorize TikTok account' : 'Connect TikTok'}</Button>
        </> : unavailable('tiktok')}
      </div>
    </div>
    <p className="privacy-note"><ShieldCheck size={15}/> Your tokens are stored separately from other members. <ActionLink href="#/library">Open your clips</ActionLink></p>
    {removing && <Confirm title={`Disconnect ${removing.name}?`} message="This removes the credential from Curiousity. You can revoke access at the provider too. Already delivered files stay at their destination." label="Disconnect account" busy={busy === 'disconnect'} error={error} onClose={() => { if (!busy) setRemoving(null); }} onConfirm={remove}/>}
  </section>;
}
