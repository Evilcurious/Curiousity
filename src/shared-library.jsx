import { useEffect, useRef, useState } from 'react';
import { BookmarkPlus, Captions, Clapperboard, Download, Film, LibraryBig, Play, Search, Shield, Users } from 'lucide-react';
import { ActionLink, api, Banner, Button, Confirm, EmptyState, Modal, timecode } from './ui.jsx';
import { clipRatio } from './delivery.jsx';

export function LibraryTabs({ shared }) {
  return <nav className="settings-tabs library-tabs" aria-label="Library sections">
    <a href="#/library" aria-current={!shared ? 'page' : undefined}><Clapperboard size={16}/> My projects</a>
    <a href="#/library/shared" aria-current={shared ? 'page' : undefined}><LibraryBig size={16}/> Shared clips</a>
  </nav>;
}

export function SharedLibrary({ user, openProject, notify }) {
  const [query, setQuery] = useState(''), [rows, setRows] = useState([]), [next, setNext] = useState(null);
  const [pending, setPending] = useState(true), [busy, setBusy] = useState(''), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [preview, setPreview] = useState(null), [unlist, setUnlist] = useState(null), [removeError, setRemoveError] = useState('');
  const queryRef = useRef(query);
  queryRef.current = query;
  const request = (q, offset = 0, signal) => api(`/library?q=${encodeURIComponent(q)}&offset=${offset}`, { signal });
  useEffect(() => {
    const controller = new AbortController();
    setPending(true); setError('');
    const timer = setTimeout(() => {
      request(query, 0, controller.signal).then((page) => { setRows(page.clips); setNext(page.next); })
        .catch((err) => { if (!controller.signal.aborted) { setRows([]); setNext(null); setError(err.message); } })
        .finally(() => { if (!controller.signal.aborted) setPending(false); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, reload]);
  async function more() {
    setBusy('more');
    try {
      const page = await request(query, next);
      if (queryRef.current === query) {
        setRows((previous) => {
          const keys = new Set(previous.map((clip) => `${clip.projectId}/${clip.id}`));
          return [...previous, ...page.clips.filter((clip) => !keys.has(`${clip.projectId}/${clip.id}`))];
        });
        setNext(page.next);
      }
    } catch (err) { notify(err.message, 'error'); }
    finally { setBusy(''); }
  }
  const key = (clip) => `${clip.projectId}/${clip.id}`;
  async function save(clip) {
    setBusy(key(clip));
    try {
      const project = await api(`/library/${clip.projectId}/clips/${clip.id}/save`, { method: 'POST' });
      notify('Clip saved to your projects.'); openProject(project);
    } catch (err) { notify(err.message, 'error'); if (err.status === 404) { setPreview(null); setReload((n) => n + 1); } }
    finally { setBusy(''); }
  }
  async function hide() {
    setRemoveError(''); setBusy('unlist');
    try { await api(`/admin/library/${unlist.projectId}`, { method: 'DELETE' }); setUnlist(null); setReload((n) => n + 1); notify('Project exports removed from the shared library.'); }
    catch (err) { setRemoveError(err.message); }
    finally { setBusy(''); }
  }
  function saveAction(clip) {
    return clip.byYou ? <ActionLink href={`#/project/${clip.projectId}`} icon={Clapperboard}>Open project</ActionLink> : <Button icon={BookmarkPlus} busy={busy === key(clip)} disabled={Boolean(busy)} onClick={() => save(clip)}>Save to my projects</Button>;
  }
  return <section aria-label="Shared clips">
    <div className="library-toolbar shared-toolbar"><label className="search-field"><Search size={17}/><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={120} placeholder="Search shared clips…" aria-label="Search shared clips"/></label><p><Users size={15}/> Available to all signed-in members</p></div>
    {error && <Banner>{error} <button type="button" className="inline-action" onClick={() => setReload((n) => n + 1)}>Try again</button></Banner>}
    {pending ? <div className="panel"><EmptyState icon={LibraryBig} title="Loading shared clips…">Checking the library.</EmptyState></div> : !error && (rows.length ? <div className="clips-grid shared-grid">{rows.map((clip) => <article className="panel clip-card shared-card" key={key(clip)}>
      <button type="button" className="clip-poster" onClick={() => setPreview(clip)} aria-label={`Preview ${clip.title}`}>
        {clip.posterUrl ? <img src={clip.posterUrl} alt="" loading="lazy"/> : <div className="clip-placeholder"/>}
        <span className="clip-index">{clip.byYou ? 'SHARED BY YOU' : 'SHARED CLIP'}</span><span className="clip-play"><Play size={23} fill="currentColor"/></span><span className="thumb-time">{timecode(clip.duration)}</span>
      </button>
      <div className="clip-card-body"><h3>{clip.title}</h3><p>{clip.projectTitle} · {clip.frame?.ratio || 'MP4'}</p>
        <div className="clip-actions"><ActionLink icon={Download} href={`${clip.videoUrl}?download=1`} download>MP4</ActionLink>{clip.captionsUrl && <ActionLink icon={Captions} href={`${clip.captionsUrl}?download=1`} download>SRT</ActionLink>}{saveAction(clip)}</div>
        {user.role === 'admin' && <button type="button" className="inline-action admin-unlist" onClick={() => { setRemoveError(''); setUnlist(clip); }}><Shield size={13}/> Unlist exports</button>}
      </div>
    </article>)}</div> : <div className="panel"><EmptyState icon={query ? Search : Film} title={query ? 'No matching clips' : 'Nothing shared yet'} action={query ? <Button onClick={() => setQuery('')}>Clear search</Button> : <ActionLink href="#/library" icon={Clapperboard}>Go to my projects</ActionLink>}>{query ? 'Try a different title or hashtag.' : 'When someone shares a finished project’s exports, you can preview, download, or save them here.'}</EmptyState></div>)}
    {!pending && next !== null && <div className="library-more"><Button onClick={more} busy={busy === 'more'} disabled={Boolean(busy)}>Show more clips</Button></div>}
    {preview && <Modal title={preview.title} subtitle={`${preview.projectTitle} · ${timecode(preview.duration)} · Shared library`} onClose={() => setPreview(null)}><div className="video-preview" style={clipRatio(preview.frame)}><video src={preview.videoUrl} poster={preview.posterUrl || undefined} controls autoPlay playsInline preload="metadata"/></div><div className="modal-actions">{saveAction(preview)}<ActionLink icon={Download} tone="primary" href={`${preview.videoUrl}?download=1`} download>Download MP4</ActionLink></div></Modal>}
    {unlist && <Confirm title="Remove exports from the shared library?" message={`This unlists the clips from “${unlist.projectTitle}” without deleting the owner’s project or copies other members have already saved.`} label="Unlist exports" onClose={() => setUnlist(null)} onConfirm={hide} busy={busy === 'unlist'} error={removeError}/>}
  </section>;
}

export function LibraryShareReview({ job, onClose, onUpdate, notify }) {
  const [approved, setApproved] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const sharing = !job.sharedAt;
  async function apply() {
    setBusy(true); setError('');
    try {
      onUpdate(await api(`/projects/${job.id}/sharing`, { method: 'PUT', body: { shared: sharing, consent: approved } }));
      notify(sharing ? 'Finished exports are now shared in the Clip Library.' : 'Your exports were removed from the shared library.'); onClose();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <Modal title={sharing ? 'Share finished clips?' : 'Stop sharing these clips?'} subtitle={sharing ? 'Every signed-in member can preview, download, and save reusable copies of these exports. They will not see your source link, project settings, or connections.' : 'This hides the exports from the shared library. Your project stays private. Copies other members already saved or downloaded are not removed.'} onClose={onClose}>
    {sharing && <label className="consent library-consent"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)}/><span>I have permission to let workspace members download and reuse all {job.clips.length === 1 ? 'of this project’s finished export' : `${job.clips.length} finished clips`} and their captions.</span></label>}
    {error && <Banner>{error}</Banner>}
    <div className="modal-actions"><Button onClick={onClose}>Cancel</Button><Button tone={sharing ? 'primary' : 'danger'} busy={busy} disabled={sharing && !approved} onClick={apply}>{sharing ? 'Share exports' : 'Stop sharing'}</Button></div>
  </Modal>;
}
