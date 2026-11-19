import { useEffect, useState } from 'react';
import { ArrowUpRight, Layers, Check, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, Banner, Button, Modal } from './ui.jsx';
import { clipRatio } from './delivery.jsx';
import { Field, Select } from './forms.jsx';

const serviceLabels = { instagram: 'Instagram Reel', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', threads: 'Threads', bluesky: 'Bluesky', twitter: 'X' };
const dashboard = 'https://publish.buffer.com/';

export function BufferIcon({ size = 18, ...props }) { return <Layers size={size} strokeWidth={1.8} {...props}/>; }

export function BufferStatus({ draft }) {
  if (!draft) return null;
  const state = { sending: 'Sending to Buffer…', draft: 'Saved as Buffer draft', failed: 'Buffer request failed', unconfirmed: 'Buffer draft not confirmed' }[draft.state];
  return <div className={`clip-upload ${draft.state === 'failed' ? 'upload-error' : ''}`}><BufferIcon size={15}/><div><span>{state}</span>{draft.reason && <p>{draft.reason}</p>}{draft.linkExpiry && draft.state !== 'failed' && <p>Temporary video link expires {new Date(draft.linkExpiry).toLocaleDateString()}.</p>}{['draft', 'unconfirmed'].includes(draft.state) && <a className="inline-action upload-link" href={dashboard} target="_blank" rel="noreferrer">Open Buffer <ArrowUpRight size={12}/></a>}</div></div>;
}

export function BufferReview({ job, clip, frame, profiles, canHost, onClose, onSent }) {
  const [profileId, setProfileId] = useState(profiles[0]?.id || ''), [orgId, setOrgId] = useState(''), [channelId, setChannelId] = useState('');
  const [orgs, setOrgs] = useState([]), [channels, setChannels] = useState([]), [tries, setTries] = useState(0);
  const [description, setDescription] = useState(() => [clip.title, (clip.hashtags || []).join(' ')].filter(Boolean).join('\n\n').slice(0, 2200));
  const [title, setTitle] = useState(clip.title.slice(0, 100)), [kids, setKids] = useState(''), [mediaMode, setMediaMode] = useState(canHost ? 'link' : 'external'), [mediaUrl, setMediaUrl] = useState('');
  const [consent, setConsent] = useState(false), [loadingOrgs, setLoadingOrgs] = useState(false), [loadingChannels, setLoadingChannels] = useState(false), [sending, setSending] = useState(false);
  const [orgError, setOrgError] = useState(''), [channelError, setChannelError] = useState(''), [error, setError] = useState('');
  const channel = channels.find((item) => item.id === channelId), profile = profiles.find((item) => item.id === profileId);
  useEffect(() => { if (!profile) setProfileId(profiles[0]?.id || ''); }, [profile?.id, profiles]);
  useEffect(() => {
    if (!profile) return;
    const controller = new AbortController();
    setOrgs([]); setOrgId(''); setChannels([]); setChannelId(''); setConsent(false); setOrgError(''); setLoadingOrgs(true);
    api(`/mcp/${profile.id}/organizations`, { method: 'POST', signal: controller.signal }).then((rows) => {
      setOrgs(rows); if (rows.length === 1) setOrgId(rows[0].id);
    }).catch((err) => { if (!controller.signal.aborted) setOrgError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoadingOrgs(false); });
    return () => controller.abort();
  }, [profile?.id, tries]);
  useEffect(() => {
    if (!orgId || !profile) return;
    const controller = new AbortController();
    setChannels([]); setChannelId(''); setConsent(false); setChannelError(''); setLoadingChannels(true);
    api(`/mcp/${profile.id}/channels`, { method: 'POST', body: { organizationId: orgId }, signal: controller.signal }).then(setChannels)
      .catch((err) => { if (!controller.signal.aborted) setChannelError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoadingChannels(false); });
    return () => controller.abort();
  }, [profile?.id, orgId, tries]);
  const changed = (set) => (event) => { set(event.target.value); setConsent(false); setError(''); };
  async function submit(event) {
    event.preventDefault();
    if (!channel || !profile || !consent) return;
    setSending(true); setError('');
    try {
      const result = await api(`/projects/${job.id}/clips/${clip.id}/buffer`, { method: 'POST', body: {
        profileId, organizationId: orgId, channelId, service: channel.service, mediaMode, mediaUrl, description, title, consent,
        ...(kids ? { madeForKids: kids === 'yes' } : {}),
      } });
      onSent(result, result.clips.find((item) => item.id === clip.id)?.bufferDraft);
    } catch (err) { setError(err.message); setConsent(false); }
    finally { setSending(false); }
  }
  if (!profiles.length) return <Modal title="Buffer connection unavailable" subtitle="This legacy destination was removed. Download your clip to upload it in Buffer." onClose={onClose}><div className="modal-actions"><Button onClick={onClose}>Close</Button></div></Modal>
  return <Modal wide title="Review Buffer draft" subtitle="Review the clip, account and post text before sending. This creates a draft, not a scheduled or published post." onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
      <div className="google-review-layout buffer-review">
        <div className="buffer-preview"><div className="video-preview" style={clipRatio(frame)}><video src={clip.videoUrl} poster={clip.posterUrl || undefined} controls playsInline preload="metadata"/></div><p>{clip.title}</p></div>
        <div className="review-fields">
          <Field label="Buffer connection"><Select value={profileId} disabled={sending} onChange={(event) => { setOrgId(''); setChannelId(''); changed(setProfileId)(event); }}><option value="" disabled>Choose a connection</option>{profiles.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</Select></Field>
          <Field label="Organization"><Select value={orgId} required disabled={sending || loadingOrgs || !orgs.length} onChange={(event) => { setChannelId(''); changed(setOrgId)(event); }}><option value="">{loadingOrgs ? 'Loading…' : 'Choose an organization'}</option>{orgs.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</Select></Field>
          <Field label="Destination channel"><Select value={channelId} required disabled={sending || loadingChannels || !channels.length} onChange={(event) => { setKids(''); changed(setChannelId)(event); }}><option value="">{loadingChannels ? 'Loading…' : 'Choose a channel'}</option>{channels.map((row) => <option key={row.id} value={row.id}>{row.name} · {serviceLabels[row.service]}</option>)}</Select></Field>
          {!loadingOrgs && !orgError && !orgs.length && <p className="muted">No organizations found for this key.</p>}
          {orgId && !loadingChannels && !channelError && !channels.length && <p className="muted">No supported video channels in this organization.</p>}
          {(orgError || channelError) && <><Banner>{orgError || channelError}</Banner><Button icon={RefreshCw} onClick={() => setTries((n) => n + 1)}>Reload destinations</Button></>}
          {channel?.service === 'youtube' && <><Field label="YouTube title"><input value={title} maxLength={100} required disabled={sending} onChange={changed(setTitle)}/></Field><Field label="Made for kids?" hint="The draft uses private visibility if you later publish it from Buffer."><Select value={kids} required disabled={sending} onChange={changed(setKids)}><option value="">Choose one</option><option value="no">No</option><option value="yes">Yes</option></Select></Field></>}
          <Field label="Post text"><textarea rows={3} value={description} maxLength={2200} disabled={sending} onChange={changed(setDescription)}/></Field>
        </div>
      </div>
      {canHost && <Field label="Video attachment"><Select value={mediaMode} onChange={changed(setMediaMode)} disabled={sending}><option value="link">Attach this clip with a 3-day link</option><option value="external">Use a hosted MP4 URL</option></Select></Field>}
      {mediaMode === 'external' && <Field label="Hosted MP4 URL" hint="Buffer downloads the video at this URL, not the preview. Use a direct HTTPS link it can open without signing in."><input type="url" value={mediaUrl} required maxLength={1700} disabled={sending} onChange={changed(setMediaUrl)} placeholder="https://example.com/exports/clip.mp4"/></Field>}
      {mediaMode === 'link' && <p className="privacy-note"><ShieldCheck size={15}/> Anyone with the temporary link can fetch this MP4 for three days. The clip is not added to the shared library.</p>}
      <label className="consent"><input type="checkbox" checked={consent} disabled={sending} onChange={(event) => setConsent(event.target.checked)}/><span>I reviewed the video, post text and destination{channel ? ` (${channel.name})` : ''}. I have permission to send this video to Buffer as a draft.</span></label>
      {error && <Banner>{error}</Banner>}
      <div className="modal-actions"><Button onClick={onClose}>Close</Button><Button tone="primary" icon={Check} type="submit" busy={sending} disabled={!consent || !channel || (channel.service === 'youtube' && !kids)}>Create Buffer draft</Button></div>
    </form>
  </Modal>;
}
