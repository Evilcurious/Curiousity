import { useEffect, useRef, useState } from 'react';
import { ArrowRight, AudioLines, Captions, Check, Clapperboard, Download, FileVideo, Film, Image, LockKeyhole, Plus, RotateCcw, SlidersHorizontal, Square, Trash2, Upload } from 'lucide-react';
import { captionPresets, captionStyleLabel, matchingPreset, sameCaptionStyle } from '../shared/captions.mjs';
import { languageLabel, languages } from '../shared/exports.mjs';
import { ACTIVE, ActionLink, api, Banner, Button, Confirm, JobBadge, PageHeading, SHORT_DATE, timecode } from './ui.jsx';
import CaptionAppearance, { CaptionSample, CaptionStyleTiles } from './caption-appearance.jsx';
import { uploadCaptions } from './caption-upload.mjs';
import { Field, Select } from './forms.jsx';
import MediaModes from './media-modes.jsx';
import { isMissingApi } from './api-errors.mjs';
import './media-workspaces.css';
import './media-modes.css';

const sampleFrame = { width: 1280, height: 720 };
const defaultLook = captionPresets.minimal.style;
const accept = { video: 'video/*,.mkv,.mov,.avi,.m4v', image: '.jpeg,.jpg,.png,.webp', audio: 'audio/*,.mp3,.m4a,.wav,.aac,.flac,.ogg' };
const captionLanguages = Object.entries(languages).sort(([, a], [, b]) => a.localeCompare(b));
const styleName = (style) => captionPresets[matchingPreset(style)]?.label || captionStyleLabel(style);
const downloadUrl = (url) => `${url}${url.includes('?') ? '&' : '?'}download=1`;
function fileSize(bytes) {
  const unit = bytes >= 1024 ** 3 ? 'GB' : 'MB';
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(bytes / 1024 ** (unit === 'GB' ? 3 : 2))} ${unit}`;
}

export default function CaptionsPage({ workspace, notify }) {
  const [jobs, setJobs] = useState([]), [loadError, setLoadError] = useState(null), [selection, setSelection] = useState(null);
  const [source, setSource] = useState('video'), [engine, setEngine] = useState(null), [language, setLanguage] = useState('source'), [translation, setTranslation] = useState(null);
  const [audio, setAudio] = useState(null), [image, setImage] = useState(null);
  const [file, setFile] = useState(null), [url, setUrl] = useState(''), [fileFrame, setFileFrame] = useState(null), [previewError, setPreviewError] = useState(false);
  const [draftStyle, setDraftStyle] = useState(null), [showStyle, setShowStyle] = useState(false), [play, setPlay] = useState(0), [dialog, setDialog] = useState(false);
  const [progress, setProgress] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [drop, setDrop] = useState(false), [deleting, setDeleting] = useState(null);
  const fileInput = useRef(null), imageInput = useRef(null), audioInput = useRef(null), request = useRef(null), version = useRef(0), list = useRef([]);
  const job = selection === null ? jobs[0] : jobs.find((item) => item.id === selection);
  const style = draftStyle || job?.style || defaultLook;
  const frame = job?.frame || fileFrame || sampleFrame;
  const still = source === 'still', previewFile = still ? image : file, hasInputs = still ? Boolean(audio && image) : Boolean(file);
  const running = job && ACTIVE.has(job.status);
  const uploading = progress !== null;
  const locked = uploading || Boolean(busy);
  const missingApi = isMissingApi(loadError);
  const canBurn = workspace?.tools?.subtitles;
  const provider = workspace?.providers?.find((item) => item.id === workspace?.captions?.providerId);
  const engineMode = engine ?? (provider ? 'ai' : 'local');
  const ai = engineMode === 'ai';
  const profiles = [...(workspace?.providers || []), ...(workspace?.sharedProviders || [])].filter((item) => item.model);
  const translator = translation === null ? profiles.find((item) => item.id === workspace?.activeProviderId)?.id || '' : profiles.some((item) => item.id === translation) ? translation : '';
  const transcriber = ai ? provider ? `${provider.name} · ${workspace.captions.model}` : 'AI engine not configured' : 'Local Whisper';
  const supportsModes = workspace?.mediaModes === true;
  const canGenerate = supportsModes && workspace.tools?.ffmpeg !== false && (ai ? Boolean(provider) : workspace?.tools?.whisper !== false);
  const stillLimits = workspace?.stillLimits || { imageMb: 12 };
  const hasRender = Boolean(job?.videoUrl);
  const watching = hasRender && !showStyle;
  const localVideo = !watching && Boolean(previewFile && url && !previewError);
  const renderNeeded = Boolean(job?.captionsUrl) && (!hasRender || !sameCaptionStyle(style, job.renderedStyle));

  function replaceJobs(next) { list.current = next; setJobs(next); }
  function updateJob(value) {
    version.current++;
    const next = list.current.some((item) => item.id === value.id) ? list.current.map((item) => item.id === value.id ? value : item) : [value, ...list.current];
    replaceJobs(next);
  }
  useEffect(() => {
    const abort = new AbortController();
    let timer;
    async function poll() {
      const started = version.current;
      let unavailable = false;
      try {
        const next = await api('/captions', { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]) });
        if (!abort.signal.aborted && started === version.current) { replaceJobs(next); setLoadError(null); }
      } catch (err) {
        unavailable = isMissingApi(err);
        if (!abort.signal.aborted) setLoadError(err);
      }
      if (!abort.signal.aborted) timer = setTimeout(poll, unavailable ? 8000 : list.current.some((item) => ACTIVE.has(item.status)) ? 950 : 3000);
    }
    poll();
    return () => { abort.abort(); clearTimeout(timer); request.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!previewFile) { setUrl(''); return; }
    const src = URL.createObjectURL(previewFile);
    setUrl(src);
    return () => URL.revokeObjectURL(src);
  }, [previewFile]);
  function open(item) {
    setSelection(item?.id || ''); setFile(null); setImage(null); setAudio(null); setFileFrame(null); setDraftStyle(null); setShowStyle(false); setError('');
  }
  function choose(next, kind = 'video') {
    if (locked || !next) return;
    if (!next.size) { setError('Choose a file that is not empty.'); return; }
    const max = kind === 'image' ? stillLimits.imageMb : kind === 'audio' ? stillLimits.audioMb : null;
    if (max && next.size > max * 1024 ** 2) { setError(`Choose ${kind === 'image' ? 'a picture' : 'audio'} under ${max} MB.`); return; }
    setSelection(''); setShowStyle(true); setError('');
    if (kind === 'audio') setAudio(next);
    else { setFileFrame(null); setPreviewError(false); if (kind === 'image') setImage(next); else setFile(next); }
  }
  function dropFiles(files) {
    if (!still) { choose(files[0]); return; }
    for (const dropped of files) {
      if (dropped.type.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(dropped.name)) choose(dropped, 'image');
      else if (dropped.type.startsWith('audio/') || /\.(mp3|m4a|wav|aac|flac|ogg)$/i.test(dropped.name)) choose(dropped, 'audio');
    }
  }
  function selectStyle(next) { setDraftStyle(next); setShowStyle(true); setPlay((value) => value + 1); setError(''); }
  async function generate() {
    if (!hasInputs || !canGenerate || request.current || missingApi) return;
    const ctrl = new AbortController();
    request.current = ctrl;
    setProgress(0); setError('');
    try {
      const next = await uploadCaptions({ file, ...(still && { image, audio }), style, engine: engineMode, language, translator: ai && language !== 'source' ? translator : '' }, ctrl.signal, setProgress);
      updateJob(next); open(next); notify(next.detail || 'Upload saved.');
    } catch (err) { if (!ctrl.signal.aborted) setError(err.message); }
    finally { request.current = null; setProgress(null); }
  }
  async function doJob(action) {
    if (!job || busy) return;
    setBusy(action); setError('');
    try {
      const next = await api(`/captions/${job.id}/${action}`, { method: 'POST', body: action === 'render' ? { style } : undefined });
      updateJob(next);
      if (action === 'render') { setDraftStyle(null); setShowStyle(false); }
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  async function remove() {
    setBusy('delete'); setError('');
    try {
      await api(`/captions/${deleting.id}`, { method: 'DELETE' });
      version.current++;
      replaceJobs(list.current.filter((item) => item.id !== deleting.id));
      if (job?.id === deleting.id) open(null);
      setDeleting(null); notify('Caption project deleted.');
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }

  return <div className="view-enter caption-workspace">
    <PageHeading label="WORKSPACE / SUBTITLE STUDIO" title="Captions" subtitle="Caption a video, or turn a picture and audio into a still video. Export styled MP4 and plain SRT.">
      {(job || previewFile || audio) ? <Button icon={Plus} disabled={locked} onClick={() => open(null)}>New captions</Button> : <ActionLink icon={AudioLines} href="#/settings/providers">Transcription settings</ActionLink>}
    </PageHeading>
    {missingApi && <Banner>{loadError.message}</Banner>}
    <div className="caption-workbench">
      <section className="panel caption-source" aria-label="Video and caption preview">
        <header className="caption-workbench-head"><div><p className="eyebrow">01 / VIDEO</p><h2>Preview & export</h2></div><span className={`badge ${watching ? 'badge-green' : ''}`}><i/>{watching ? 'Rendered video' : 'Style preview'}</span></header>
        {!job && <div className="caption-source-choices" role="group" aria-label="Caption source">
          <Button icon={FileVideo} type="button" aria-pressed={!still} disabled={locked} onClick={() => { if (still) { open(null); setSource('video'); } }}>Video</Button>
          <Button icon={Image} type="button" aria-pressed={still} disabled={locked} onClick={() => { if (!still) { open(null); setSource('still'); } }}>Picture + audio</Button>
        </div>}
        <div className={`caption-monitor ${drop ? 'is-dropping' : ''}`} onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); if (!locked) setDrop(true); } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDrop(false); }} onDrop={(event) => { event.preventDefault(); setDrop(false); dropFiles(event.dataTransfer.files); }}>
          {!watching && <><div className="monitor-corners" aria-hidden="true"><i/><i/><i/><i/></div><span className="monitor-index"><span/> {localVideo ? still ? 'STILL PICTURE' : 'LOCAL FILE' : 'STYLE SAMPLE'}</span></>}
          <div className={`monitor-frame${watching || localVideo ? ' monitor-media' : ''}`} style={{ '--monitor-ratio': frame.width / frame.height }}>
            {watching ? <video key={job.videoUrl} src={job.videoUrl} controls playsInline preload="metadata" aria-label="Rendered captioned video"/>
              : <>{localVideo && still ? <img key={url} src={url} alt="Picture for the captioned video" onError={() => setPreviewError(true)} onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget; if (naturalWidth && naturalHeight) setFileFrame({ width: naturalWidth, height: naturalHeight });
              }}/> : localVideo ? <video key={url} src={url} controls playsInline preload="metadata" aria-label="Device video preview" onError={() => setPreviewError(true)} onLoadedMetadata={(event) => {
                const { videoWidth, videoHeight } = event.currentTarget;
                if (videoWidth && videoHeight) setFileFrame({ width: videoWidth, height: videoHeight });
              }}/> : <div className="monitor-placeholder" aria-hidden="true"><Captions size={38} strokeWidth={1.3}/><span>CAPTIONS LAB</span></div>}
              <CaptionSample value={style} frame={frame} language={job?.language || language} play={play} sample={!job?.language ? 'Make every word count.' : undefined}/></>}
          </div>
          {!watching && <button type="button" className="monitor-replay" title="Replay style preview" aria-label="Replay style preview" onClick={() => setPlay((value) => value + 1)}><RotateCcw size={15}/></button>}
        </div>
        {hasRender && <div className="monitor-tabs" role="group" aria-label="Preview mode"><button type="button" aria-pressed={watching} onClick={() => setShowStyle(false)}>Rendered video</button><button type="button" aria-pressed={!watching} onClick={() => { setShowStyle(true); setPlay((value) => value + 1); }}>Style sample</button></div>}
        <input ref={fileInput} type="file" accept={accept.video} aria-label="Video file" hidden onChange={(event) => { choose(event.target.files[0]); event.target.value = ''; }}/>
        <input ref={imageInput} type="file" accept={accept.image} aria-label="Picture file" hidden onChange={(event) => { choose(event.target.files[0], 'image'); event.target.value = ''; }}/>
        <input ref={audioInput} type="file" accept={accept.audio} aria-label="Audio file" hidden onChange={(event) => { choose(event.target.files[0], 'audio'); event.target.value = ''; }}/>
        {!job && still ? <div className="caption-file-stack">
          <div className="caption-file-row"><span className="caption-file-icon"><Image size={20}/></span><div><strong>{image?.name || 'Picture'}</strong><p>{image ? fileSize(image.size) : `JPG, PNG or WebP · up to ${stillLimits.imageMb} MB`}</p></div><Button icon={Upload} onClick={() => imageInput.current?.click()} disabled={locked}>{image ? 'Replace picture' : 'Choose picture'}</Button></div>
          <div className="caption-file-row"><span className="caption-file-icon"><AudioLines size={20}/></span><div><strong>{audio?.name || 'Audio'}</strong><p>{audio ? fileSize(audio.size) : 'MP3, WAV, M4A, AAC, FLAC or Ogg'}</p></div><Button icon={Upload} onClick={() => audioInput.current?.click()} disabled={locked}>{audio ? 'Replace audio' : 'Choose audio'}</Button></div>
        </div> : <div className="caption-file-row">
          <span className="caption-file-icon">{job?.inputKind === 'still' ? <Image size={20}/> : <FileVideo size={20}/>}</span>
          <div><strong>{file?.name || job?.title || 'Start with a video'}</strong><p>{file ? `${fileSize(file.size)} · ${previewError ? 'Preview unavailable in this browser' : 'Ready to upload'}` : job ? [job.duration ? timecode(job.duration) : '', job.captionCount ? `${job.captionCount} cues` : '', job.language ? languageLabel(job.language) : ''].filter(Boolean).join(' · ') || (job.inputKind === 'still' ? 'Picture and audio' : 'Device video') : 'Drop a video above or browse your device.'}</p></div>
          {!job && <Button icon={Upload} onClick={() => fileInput.current?.click()} disabled={locked}>{file ? 'Replace' : 'Choose video'}</Button>}
          {job && <JobBadge state={job.status}/>}
        </div>}
        {!job && <div className="caption-source-options">
          {still && <p className="caption-still-note">The picture stays still for the full audio. Only the captions change.</p>}
          <MediaModes label="Caption processing mode" value={engineMode} onChange={(next) => { setEngine(next); setError(''); }} disabled={locked} localDetail="Whisper on this server" aiDetail="Timestamped speech model"/>
          <div className="caption-source-selects">
            <Field label="Caption language"><Select value={language} disabled={locked} onChange={(event) => setLanguage(event.target.value)}><option value="source">Original speech</option>{captionLanguages.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</Select></Field>
            {ai && language !== 'source' && <Field label="Translate with"><Select value={translator} disabled={locked} onChange={(event) => setTranslation(event.target.value)}><option value="">No translation model</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}</Select></Field>}
          </div>
          {language !== 'source' && <p className="caption-still-note">If the speech is in another language, translation may need an AI model. Local supports English translation and Urdu romanization when Whisper or Urdu captions are available.</p>}
        </div>}
        {uploading && <div className="caption-progress" role="status"><div><span>{progress === 100 ? 'Waiting for the upload receipt…' : 'Uploading media…'}</span><span>{progress}%</span></div><progress max="100" value={progress} aria-label="Upload progress"/></div>}
        {running && <div className="caption-progress" role="status"><div><span>{job.detail}</span><span>{job.progress}%</span></div><progress max="100" value={job.progress} aria-label="Caption processing progress"/></div>}
        {job?.status === 'failed' && <Banner>{job.error || job.detail}</Banner>}
        {job?.status === 'cancelled' && <Banner tone="warning" icon={Square}>{job.detail}</Banner>}
        {job?.status === 'ready' && !hasRender && <Banner tone="warning">{job.detail}</Banner>}
        {job?.warnings?.map((warning) => <Banner key={warning} tone="warning">{warning}</Banner>)}
        {error && !deleting && <Banner>{error}</Banner>}
        {(!canGenerate && !job) && <Banner tone="warning">{!supportsModes ? workspace ? 'Restart Curiousity on the updated backend before uploading in Local or AI mode.' : 'Checking the caption engine…' : workspace.tools?.ffmpeg === false ? <>Install FFmpeg first. <a href="#/setup">Open Setup</a></> : ai ? <>Select a timestamped Caption engine in <a href="#/settings/providers">AI Providers</a>, or choose Local.</> : <>Install Local Whisper in <a href="#/setup">Setup</a>, or choose AI.</>}</Banner>}
        <div className="caption-exports">
          {uploading ? <Button icon={Square} onClick={() => request.current?.abort()}>Stop upload</Button>
            : !job ? <Button icon={Captions} tone="primary" onClick={generate} disabled={locked || !hasInputs || !canGenerate || missingApi}>Generate captions</Button>
              : running ? <Button icon={Square} busy={busy === 'cancel'} onClick={() => doJob('cancel')}>Stop processing</Button>
                : renderNeeded && <Button icon={Film} tone="primary" busy={busy === 'render'} disabled={canBurn === false} onClick={() => doJob('render')}>Render style</Button>}
          {hasRender && <ActionLink icon={Download} tone={running || renderNeeded ? 'neutral' : 'primary'} href={downloadUrl(job.videoUrl)}>{renderNeeded ? 'Last MP4' : 'MP4'}</ActionLink>}
          {job?.captionsUrl && <ActionLink icon={Download} href={downloadUrl(job.captionsUrl)}>SRT</ActionLink>}
          {!job && !uploading && <span className="caption-export-note">{still && stillLimits.minutes ? `Audio up to ${stillLimits.minutes} min · storage and proxy limits apply` : 'Storage and proxy limits apply'}</span>}
          {hasRender && renderNeeded && !running && <span className="caption-export-note">Render to apply the new style.</span>}
        </div>
      </section>

      <section className="panel caption-looks" aria-label="Caption styles">
        <header className="caption-workbench-head"><div><p className="eyebrow">02 / DESIGN</p><h2>Caption styles</h2></div><span className="badge">{Object.keys(captionPresets).length} presets</span></header>
        <p className="caption-looks-copy">Choose a look or tune the font, color and motion. Styling is burned into the MP4; the SRT stays plain.</p>
        <CaptionStyleTiles value={style} onChange={selectStyle} disabled={locked}/>
        <div className="caption-looks-footer"><span><Check size={14}/><strong>{styleName(style)}</strong></span><Button icon={SlidersHorizontal} disabled={locked} onClick={() => setDialog(true)}>Customize</Button></div>
      </section>
    </div>
    <div className="caption-info-band"><p><AudioLines size={17}/><span><strong>Transcription</strong> {job?.engine || (job ? job.engineMode === 'ai' ? 'AI transcription' : job.engineMode === 'local' ? 'Local Whisper' : 'Saved project' : transcriber)}</span><a href="#/settings/providers" aria-label="Change transcription settings"><ArrowRight size={15}/></a></p><p><LockKeyhole size={16}/><span><strong>Private project</strong> {job && !job.engineMode ? 'Files and exports are private to your account.' : (job ? job.engineMode === 'ai' : ai) ? `Audio is sent to the selected transcription service.${!job && language !== 'source' && translator ? ' Captions may be sent to the translation model.' : ''}` : 'Speech is transcribed on this server.'}</span></p></div>

    <section className="caption-history" aria-labelledby="caption-history-title">
      <div className="section-heading"><h2 id="caption-history-title">Caption projects</h2><span className="muted">{jobs.length} saved</span></div>
      {loadError && !missingApi && <Banner>{loadError.message}</Banner>}
      <div className="panel caption-history-list">{jobs.length ? jobs.map((item) => <div key={item.id} className="caption-history-row" data-current={job?.id === item.id || undefined}>
        <span className="caption-file-icon"><Clapperboard size={18}/></span><div className="caption-history-title"><strong>{item.title}</strong><span>{SHORT_DATE.format(new Date(item.createdAt))}{item.duration ? ` · ${timecode(item.duration)}` : ''}</span></div>
        <JobBadge state={item.status}/><Button onClick={() => open(item)} disabled={locked} aria-label={`Open ${item.title}`}>Open</Button><button type="button" className="icon-button" disabled={locked || ACTIVE.has(item.status)} title="Delete caption project" aria-label={`Delete ${item.title}`} onClick={() => { setDeleting(item); setError(''); }}><Trash2 size={16}/></button>
      </div>) : <p className="caption-history-empty"><Film size={19}/> Your captioned MP4 and SRT exports will appear here.</p>}</div>
    </section>
    {dialog && <CaptionAppearance value={style} frame={frame} language={job?.language || language} canBurn={canBurn} onClose={() => setDialog(false)} onApply={(value) => { selectStyle(value); setDialog(false); }}/>}
    {deleting && <Confirm title="Delete caption project?" message="The uploaded files, captions, and rendered MP4 will be removed from this server." onClose={() => { if (!busy) { setDeleting(null); setError(''); } }} onConfirm={remove} busy={busy === 'delete'} label="Delete project" error={error}/>}
  </div>;
}
