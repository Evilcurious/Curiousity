import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, Captions, Check, ChevronDown, CircleAlert, Clapperboard, Clock3, Copy, Download, ExternalLink, Film, Hash, Info, LoaderCircle, Play, Plug, Plus, Radio, RefreshCw, Search, Sparkles, Square, Trash2, Upload } from 'lucide-react';
import { ACTIVE, ActionLink, api, Banner, Button, Confirm, EmptyState, Glyph, JobBadge, Modal, PageHeading, POSTING, SHORT_DATE, STATES, TikTokIcon, timecode } from './ui.jsx';
import { DemoRow, ProjectRow } from './studio.jsx';
import { availableDestinations, clipRatio, clipUploading, GoogleDeliveryStatus, GoogleUploadReview } from './delivery.jsx';
import { exportFrame, languageLabel, platforms } from '../shared/exports.mjs';
import { captionScriptFont, captionStyleLabel } from '../shared/captions.mjs';

export function Library({ projects, error, createProject, notify }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const matching = projects.filter((p) => (filter === 'all' || (filter === 'active' ? ACTIVE.has(p.status) : filter === 'issues' ? ['failed', 'cancelled'].includes(p.status) : p.status === filter)) && `${p.title} ${p.creator || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  async function demo() {
    setBusy(true);
    try { await createProject({ demo: true, count: 3, captions: true }); }
    catch (err) { notify(err.message, 'error'); }
    finally { setBusy(false); }
  }
  return <div className="view-enter">
    <PageHeading label="WORKSPACE" title="Clip library" subtitle="Review your projects, download clips, and track what’s ready to share."><ActionLink href="#/studio" icon={Plus} tone="primary">New project</ActionLink></PageHeading>
    {error && <Banner>{error}</Banner>}
    {projects.length ? <>
      <div className="library-toolbar"><label className="search-field"><Search size={17}/><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects…" aria-label="Search projects"/></label><div className="select-wrap"><select aria-label="Filter projects by status" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All statuses</option><option value="ready">Ready</option><option value="active">In progress</option><option value="issues">Failed or stopped</option></select><ChevronDown size={14}/></div></div>
      <div className="project-list">{matching.length ? matching.map((project) => <ProjectRow project={project} key={project.id}/>) : <div className="panel"><EmptyState icon={Search} title="No matching projects" action={<Button onClick={() => { setQuery(''); setFilter('all'); }}>Clear filters</Button>}>Try another search or status.</EmptyState></div>}</div>
    </> : <><div className="panel"><EmptyState icon={Clapperboard} title="No projects yet" action={<ActionLink href="#/studio" icon={Plus}>Create a project</ActionLink>}>Clips you generate in the studio will appear here.</EmptyState></div><div className="library-sample"><DemoRow onDemo={demo} busy={busy}/></div></>}
  </div>;
}

const stepIndex = { queued: 0, fetching: 0, downloading: 0, capturing: 0, analyzing: 1, rendering: 2, ready: 3 };
function Processing({ job, onCancel, onFinish, busy }) {
  const stage = stepIndex[job.status];
  return <section className="panel processing-panel">
    <div className="processing-main"><Glyph icon={job.status === 'capturing' ? Radio : Activity}/><div><h2>{STATES[job.status]}</h2><p role="status">{job.detail}</p></div><span className="progress-number">{job.progress}%</span></div>
    <progress max="100" value={job.progress} aria-label="Project progress"/>
    <div className="stepper">{['Source', 'Analyze', 'Render', 'Ready'].map((label, index) => <div className={stage >= index ? 'step-active' : ''} key={label}><span>{stage > index ? <Check size={13}/> : String(index + 1).padStart(2, '0')}</span>{label}</div>)}</div>
    <div className="processing-footer">
      <p>{job.status === 'capturing' ? <><Radio size={15}/>{timecode(job.capturedSeconds || 0)} / {timecode(job.captureLimitSeconds || job.options.liveMinutes * 60)} captured</> : <><Info size={15}/>You can leave this page while the engine works.</>}</p>
      <div>{job.status === 'capturing' && <Button tone="primary" icon={Sparkles} onClick={onFinish} disabled={(job.capturedSeconds || 0) < 6} busy={busy}>Analyze now</Button>}<Button icon={Square} onClick={onCancel}>Stop project</Button></div>
    </div>
  </section>;
}

function ClipCard({ clip, index, onPlay, canShare, select, selected, onCheck, onGoogle, notify }) {
  async function copyHashtags() {
    try { await navigator.clipboard.writeText(clip.hashtags.join(' ')); notify('Hashtags copied.'); }
    catch { notify('Select and copy the hashtags manually.'); }
  }
  return <article className="panel clip-card">
    <button type="button" className="clip-poster" onClick={onPlay} aria-label={`Preview clip ${index + 1}: ${clip.title}`}>
      {clip.posterUrl ? <img src={clip.posterUrl} alt="" loading="lazy"/> : <div className="clip-placeholder"/>}
      <span className="clip-index">CLIP {String(index + 1).padStart(2, '0')}</span>
      <span className="clip-play"><Play size={23} fill="currentColor"/></span><span className="thumb-time">{timecode(clip.duration)}</span>
    </button>
    <div className="clip-card-body"><div className="clip-meta"><span><Clock3 size={13}/>{timecode(clip.start)}–{timecode(clip.end)}</span><span className="score" title="Estimated highlight strength; not a virality prediction"><Sparkles size={13}/>{clip.score}/100</span></div><h3>{clip.title}</h3><p>{clip.reason}</p>
      {(clip.withCaptions || Boolean(clip.hashtags?.length)) && <div className="clip-extras">
        {clip.withCaptions && <span className="clip-caption-label"><Captions size={14}/>{languageLabel(clip.captionLanguage, 'Source language')} {clip.burnedCaptions ? 'captions' : 'SRT'}</span>}
        {!!clip.hashtags?.length && <div className="clip-hashtags"><div className="clip-tags-head"><span><Hash size={13}/>{languageLabel(clip.hashtagLanguage)} hashtags</span><button type="button" className="inline-action" onClick={copyHashtags} title="Copy hashtags" aria-label={`Copy hashtags for clip ${index + 1}`}><Copy size={13}/></button></div><div className="clip-tags" dir="auto">{clip.hashtags.join(' ')}</div></div>}
      </div>}
      <div className="clip-actions"><ActionLink icon={Download} href={`${clip.videoUrl}?download=1`} download>MP4</ActionLink>{clip.captionsUrl && <ActionLink icon={Captions} href={`${clip.captionsUrl}?download=1`} download>SRT</ActionLink>}<Button icon={Play} onClick={onPlay}>Preview</Button>{onGoogle && <Button icon={Upload} onClick={onGoogle}>Send to…</Button>}</div>
      {clip.tiktok && <div className={`clip-upload ${clip.tiktok.state === 'failed' ? 'upload-error' : ''}`}><TikTokIcon size={15}/><div><span>{POSTING[clip.tiktok.state]}</span>{clip.tiktok.reason && <p>{clip.tiktok.reason}</p>}</div>{clip.tiktok.canCheck && clip.tiktok.state === 'unconfirmed' && <button className="inline-action" type="button" onClick={onCheck}>Check</button>}</div>}
      <GoogleDeliveryStatus uploads={clip.googleUploads}/>
      {canShare && (!clip.tiktok || clip.tiktok.state === 'failed') && <label className="clip-select"><input type="checkbox" checked={selected} onChange={(event) => select(event.target.checked)}/><span>Select for TikTok</span></label>}
    </div>
  </article>;
}

function ReviewUpload({ job, selected, tiktok, frame, onClose, onSent }) {
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const chosen = job.clips.filter((clip) => selected.has(clip.id) && (!clip.tiktok || clip.tiktok.state === 'failed'));
  const [current, setCurrent] = useState(chosen[0]?.id);
  const clip = chosen.find((item) => item.id === current) || chosen[0];
  async function send() {
    setBusy(true); setError('');
    try {
      const updated = await api(`/projects/${job.id}/tiktok`, { method: 'POST', body: { clipIds: chosen.map((item) => item.id), consent, accountId: tiktok.account.id } });
      onSent(updated);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <Modal title="Review and send to TikTok" subtitle={`Destination: ${tiktok.account?.name || 'TikTok'}. These clips go to your inbox as drafts, not public posts. Add your description and hashtags in TikTok.`} onClose={onClose} wide>
    {clip && <div className="upload-review" style={clipRatio(frame)}><video key={clip.id} src={clip.videoUrl} poster={clip.posterUrl || undefined} controls playsInline preload="metadata"/><div className="upload-review-clips">{chosen.map((item, index) => <button key={item.id} className={item.id === clip.id ? 'is-active' : ''} type="button" onClick={() => { setCurrent(item.id); setConsent(false); }}><Play size={15}/><span>{index + 1}. {item.title}</span></button>)}</div></div>}
    <label className="consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)}/><span>I reviewed these clips and agree to TikTok’s <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">Music Usage Confirmation</a>.</span></label>
    {error && <Banner>{error}</Banner>}
    <div className="modal-actions"><Button onClick={onClose}>Cancel</Button><Button tone="primary" busy={busy} disabled={!consent || !chosen.length} icon={TikTokIcon} onClick={send}>Send {chosen.length} {chosen.length === 1 ? 'draft' : 'drafts'}</Button></div>
  </Modal>;
}

export function Project({ job, loadError, loading, workspace, updateProject, removeProject, createProject, notify }) {
  const [preview, setPreview] = useState(null), [confirm, setConfirm] = useState(''), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [selected, setSelected] = useState(new Set()), [review, setReview] = useState(false), [googleReview, setGoogleReview] = useState(null);
  const offered = useRef(null);
  useEffect(() => { setSelected(new Set()); setPreview(null); setReview(false); setGoogleReview(null); setConfirm(''); setError(''); }, [job?.id]);
  useEffect(() => {
    if (job?.status !== 'ready' || !job.options.tiktok || !workspace?.tiktok.connected || offered.current === job.id) return;
    setSelected(new Set(job.clips.filter((clip) => !clip.tiktok).map((clip) => clip.id)));
    offered.current = job.id;
  }, [job, workspace?.tiktok.connected]);
  if (!job) return <><ActionLink icon={ArrowLeft} href="#/library">Clip library</ActionLink><div className="panel empty-project"><EmptyState icon={loading ? LoaderCircle : Film} title={loading ? 'Loading project…' : 'Project unavailable'}>{loadError || (loading ? 'Connecting to the Clipforge engine.' : 'This project may have been removed.')}</EmptyState></div></>;
  const active = ACTIVE.has(job.status);
  const ready = job.status === 'ready';
  const canShare = ready && !job.options.demo && workspace?.tiktok.connected;
  const shareCount = job.clips.filter((clip) => selected.has(clip.id) && (!clip.tiktok || clip.tiktok.state === 'failed')).length;
  const uploading = job.clips.some(clipUploading);
  const frame = job.frame || exportFrame(job.options);
  const platform = platforms[job.options.platform] || platforms.universal;
  const styledLanguage = job.clips.find((clip) => clip.burnedCaptions)?.captionLanguage;
  const styleLabel = captionStyleLabel(captionScriptFont(styledLanguage) ? { ...job.options.captionStyle, font: 'auto' } : job.options.captionStyle);
  const google = workspace?.google;
  const clipToPlay = job.clips.find((clip) => clip.id === preview);
  const clipToSend = job.clips.find((clip) => clip.id === googleReview);
  const accountKey = google?.account ? `${google.account.id}:${google.grants.drive}:${google.grants.youtube}` : '';

  async function runAction(action, clip) {
    setError(''); setBusy(action);
    try {
      if (action === 'delete') await removeProject(job.id);
      else if (action === 'retry') {
        const { aiProfile } = job.options;
        const unavailable = workspace && aiProfile && !['local', 'workspace'].includes(aiProfile) && !workspace.providers.some((profile) => profile.id === aiProfile && profile.model);
        await createProject(unavailable ? { ...job.options, aiProfile: 'local' } : job.options);
        if (unavailable) notify('That AI profile is no longer available. Retrying with local analysis.');
      }
      else {
        const route = action === 'status' ? `/clips/${clip.id}/tiktok/check` : `/${action}`;
        updateProject(await api(`/projects/${job.id}${route}`, { method: 'POST' }));
        if (action === 'status') notify('Checking delivery with TikTok.');
      }
      setConfirm('');
    } catch (err) { setError(err.message); if (!confirm) notify(err.message, 'error'); }
    finally { setBusy(''); }
  }
  return <div className="view-enter project-view">
    <a className="back-link" href="#/library"><ArrowLeft size={16}/>Clip library</a>
    <PageHeading label={job.options.demo ? 'DEMO PROJECT' : 'CLIPPING PROJECT'} title={job.title} subtitle={`${job.sourceKind === 'live' ? 'Live capture' : job.sourceKind === 'replay' ? 'Livestream replay' : job.options.demo ? 'Bundled sample' : 'YouTube'}${job.creator ? ` · ${job.creator}` : ''} · ${SHORT_DATE.format(new Date(job.createdAt))}${job.duration ? ` · ${timecode(job.duration)} source` : ''}${job.liveInput ? ` · ${job.liveInput}` : ''}`}>
      {job.options.url && <ActionLink href={job.options.url} icon={ExternalLink} target="_blank" rel="noreferrer">Source</ActionLink>}
      {!active && !uploading && <button className="icon-button" onClick={() => { setError(''); setConfirm('delete'); }} title="Delete project" aria-label="Delete project"><Trash2 size={17}/></button>}
    </PageHeading>
    {active && <Processing job={job} onCancel={() => { setError(''); setConfirm('cancel'); }} onFinish={() => runAction('finish-capture')} busy={busy === 'finish-capture'}/>}
    {!active && !ready && <section className="panel failure-panel"><Glyph icon={CircleAlert}/><div><h2>{job.status === 'cancelled' ? 'Project stopped' : 'Couldn’t finish this project'}</h2><p>{job.detail}</p><div className="failure-actions"><Button icon={RefreshCw} tone="primary" busy={busy === 'retry'} onClick={() => runAction('retry')}>Try again</Button><ActionLink href="#/studio">Back to studio</ActionLink></div></div></section>}
    {job.warnings?.map((warning, index) => <Banner key={index} tone="warning" icon={Info}>{warning}</Banner>)}
    {!!job.clips.length && <>
      <div className="section-heading results-head"><div><h2>{job.clips.length} {job.clips.length === 1 ? 'clip' : 'clips'} {ready ? 'ready' : 'rendered'}</h2><p>{platform.name} · {frame.ratio} · {frame.width} × {frame.height} MP4{job.engine ? ` · ${job.engine}` : ''}{job.signals?.length ? ` · ${job.signals.join(', ')}` : ''}</p>
        {job.autoSelection && <p className="auto-count-summary"><Sparkles size={13}/>{job.autoSelection.fallback ? 'Auto count: kept the best available moment; none stood out from the rest.' : `Auto count: selected ${job.autoSelection.count} distinct ${job.autoSelection.count === 1 ? 'highlight' : 'highlights'}.`}</p>}
        {job.options.captionStyle && job.clips.some((clip) => clip.burnedCaptions) && <p className="export-style-summary"><Captions size={13}/>{styleLabel} · Burned into MP4</p>}
      </div><JobBadge state={job.status}/></div>
      {canShare && <div className="panel share-bar"><Glyph icon={TikTokIcon}/><div><h3>TikTok drafts</h3><p>{job.options.tiktok ? 'Select the clips you want to send, then review and approve the batch.' : 'Choose clips to send to your TikTok inbox.'}</p></div><Button tone={shareCount ? 'primary' : 'neutral'} icon={ArrowRight} disabled={!shareCount} onClick={() => setReview(true)}>{shareCount ? `Review ${shareCount} selected` : 'Review selected'}</Button></div>}
      {job.options.tiktok && !canShare && ready && <Banner tone="warning" icon={TikTokIcon}>Connect TikTok in <a href="#/integrations">Integrations</a> to review and send these drafts.</Banner>}
      <div className="clips-grid">{job.clips.map((clip, index) => <ClipCard key={clip.id} clip={clip} index={index} onPlay={() => setPreview(clip.id)} canShare={canShare} selected={selected.has(clip.id)} select={(checked) => setSelected((entries) => { const next = new Set(entries); if (checked) next.add(clip.id); else next.delete(clip.id); return next; })} onCheck={() => runAction('status', clip)} onGoogle={availableDestinations(job, clip, google).length ? () => setGoogleReview(clip.id) : null} notify={notify}/>)}</div>
      {ready && !job.options.demo && workspace && (!google?.connected || !workspace.tiktok.connected) && <p className="result-connections"><Plug size={15}/><span>Manage connected destinations in <a href="#/integrations">Integrations</a>.</span></p>}
    </>}
    {clipToPlay && <Modal title={clipToPlay.title} subtitle={`${timecode(clipToPlay.start)} to ${timecode(clipToPlay.end)} in the source`} onClose={() => setPreview(null)}><div className="video-preview" style={clipRatio(frame)}><video src={clipToPlay.videoUrl} poster={clipToPlay.posterUrl || undefined} controls autoPlay playsInline preload="metadata"/></div><div className="modal-actions"><ActionLink icon={Download} tone="primary" href={`${clipToPlay.videoUrl}?download=1`} download>Download MP4</ActionLink></div></Modal>}
    {review && canShare && <ReviewUpload key={workspace.tiktok.account.id} job={job} selected={selected} tiktok={workspace.tiktok} frame={frame} onClose={() => setReview(false)} onSent={(updated) => { updateProject(updated); setReview(false); setSelected(new Set()); notify('Drafts queued for upload. Track delivery here.'); }}/>}
    {clipToSend && google?.connected && <GoogleUploadReview key={`${accountKey}:${clipToSend.id}`} job={job} clip={clipToSend} google={google} frame={frame} onClose={() => setGoogleReview(null)} onQueued={(updated, label) => { updateProject(updated); setGoogleReview(null); notify(`Upload queued for ${label}. Track delivery here.`); }}/>}
    {confirm && <Confirm title={confirm === 'delete' ? 'Delete project?' : 'Stop this project?'} message={confirm === 'delete' ? 'This permanently removes the project and its local clips. It does not remove files or drafts already uploaded to another service.' : 'The engine will stop processing. You can start the project again later.'} label={confirm === 'delete' ? 'Delete project' : 'Stop project'} onClose={() => setConfirm('')} onConfirm={() => runAction(confirm)} busy={busy === confirm} error={error}/>}
  </div>;
}
