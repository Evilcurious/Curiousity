import { useState } from 'react';
import { ChevronDown, ExternalLink, HardDrive, Upload, Video } from 'lucide-react';
import { api, Banner, Button, Modal } from './ui.jsx';

export const googleDestinations = {
  drive: { label: 'Google Drive', icon: HardDrive, detail: 'Save clips to My Drive' },
  youtube: { label: 'YouTube', icon: Video, detail: 'Upload as private videos' },
};
const googleStates = {
  queued: 'Upload queued', uploading: 'Uploading', sent: 'Uploaded', failed: 'Upload failed', unconfirmed: 'Delivery not confirmed',
};
export const clipRatio = (frame) => ({ '--clip-ratio': frame.width / frame.height });
export function clipUploading(clip) {
  return clip.bufferDraft?.state === 'sending' || ['queued', 'uploading', 'processing'].includes(clip.tiktok?.state) || Object.values(clip.googleUploads || {}).some(({ state }) => ['queued', 'uploading'].includes(state));
}
export function availableDestinations(job, clip, google) {
  if (job.status !== 'ready' || !google?.connected) return [];
  return Object.keys(googleDestinations).filter((target) => google.grants[target] && (!job.options.demo || target === 'drive') && (!clip.googleUploads?.[target] || clip.googleUploads[target].state === 'failed'));
}
export function GoogleDeliveryStatus({ uploads }) {
  return Object.entries(uploads || {}).map(([target, upload]) => {
    const destination = googleDestinations[target];
    if (!destination) return null;
    const { icon: Icon, label } = destination;
    return <div className={`clip-upload ${upload.state === 'failed' ? 'upload-error' : ''}`} key={target}>
      <Icon size={15}/><div><span>{label} · {googleStates[upload.state]}</span>{upload.reason && <p>{upload.reason}</p>}</div>
      {upload.link && <a className="inline-action upload-link" href={upload.link} target="_blank" rel="noreferrer">Open <ExternalLink size={11}/></a>}
    </div>;
  });
}

export function GoogleUploadReview({ job, clip, google, frame, onClose, onQueued }) {
  const targets = availableDestinations(job, clip, google);
  const [chosen, setChosen] = useState(targets[0]);
  const target = targets.includes(chosen) ? chosen : targets[0];
  const [title, setTitle] = useState(clip.title);
  const [description, setDescription] = useState((clip.hashtags || []).join(' '));
  const [audience, setAudience] = useState('');
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const label = googleDestinations[target]?.label;
  const needsAudience = target === 'youtube';
  async function send(event) {
    event.preventDefault();
    if (!consent || !target || !title.trim() || (needsAudience && !audience)) return;
    setBusy(true); setError('');
    try {
      const jobUpdate = await api(`/projects/${job.id}/google`, { method: 'POST', body: {
        target, clipIds: [clip.id], accountId: google.account.id, consent,
        madeForKids: needsAudience ? audience === 'yes' : undefined, edits: { [clip.id]: { title, description } },
      } });
      onQueued(jobUpdate, label);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <Modal title="Review clip upload" subtitle={`Google account: ${google.account.name}. ${needsAudience ? 'The video will be uploaded as private, with notifications off.' : 'The MP4 will be saved in My Drive without changing its sharing settings.'}`} onClose={onClose} wide>
    {!target ? <Banner>This clip no longer has an available destination. Close this dialog to see its upload status.</Banner> : <form className="modal-form" onSubmit={send}>
      <div className="google-review-layout">
        <div className="video-preview" style={clipRatio(frame)}><video src={clip.videoUrl} poster={clip.posterUrl || undefined} controls playsInline preload="metadata"/></div>
        <div className="review-fields">
          <div className="form-field"><label htmlFor="upload-destination">Destination</label><span className="select-wrap"><select id="upload-destination" value={target} onChange={(event) => { setChosen(event.target.value); setConsent(false); setError(''); }}>{targets.map((id) => <option key={id} value={id}>{googleDestinations[id].label}{id === 'youtube' ? ' · Private' : ''}</option>)}</select><ChevronDown size={14}/></span></div>
          <div className="form-field"><label htmlFor="upload-title">{needsAudience ? 'Video title' : 'File name'}</label><input id="upload-title" value={title} maxLength={100} required onChange={(event) => { setTitle(event.target.value); setConsent(false); }}/></div>
          <div className="form-field"><label htmlFor="upload-description">Description (optional)</label><textarea id="upload-description" rows={3} value={description} maxLength={1000} onChange={(event) => { setDescription(event.target.value); setConsent(false); }}/></div>
          {needsAudience && <div className="form-field"><label htmlFor="upload-audience">Is this video made for kids?</label><span className="select-wrap"><select id="upload-audience" required value={audience} onChange={(event) => { setAudience(event.target.value); setConsent(false); }}><option value="">Select an audience</option><option value="no">No, it’s not made for kids</option><option value="yes">Yes, it’s made for kids</option></select><ChevronDown size={14}/></span></div>}
        </div>
      </div>
      <label className="consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)}/><span>I reviewed this clip and have permission to upload it to {label}.</span></label>
      {error && <Banner>{error}</Banner>}
      <div className="modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" tone="primary" icon={Upload} busy={busy} disabled={!consent || !title.trim() || (needsAudience && !audience)}>{needsAudience ? 'Upload privately' : 'Save to Drive'}</Button></div>
    </form>}
  </Modal>;
}
