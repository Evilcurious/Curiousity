import { useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, AudioLines, Captions, ChevronDown, ChevronRight, Clipboard, Cpu, Film, Frame, Hash, Languages, Link2, LoaderCircle, Play, Radio, ShieldCheck, SlidersHorizontal, Sparkles, Type } from 'lucide-react';
import { Banner, Button, JobBadge, Modal, PanelHeading, SHORT_DATE, Switch, TextLink, TikTokIcon, timecode } from './ui.jsx';

import { exportFrame, frameFor, languages, platforms, ratioChoices, romanUrdu } from '../shared/exports.mjs';
import { captionScriptFont, captionStyleLabel, defaultCaptionStyle } from '../shared/captions.mjs';
import CaptionAppearance from './caption-appearance.jsx';

const demoTitle = 'The anatomy of a great hook';
const presets = [1, 3, 4, 5, 10];
const initialFields = { url: '', count: 3, custom: '6', mode: 'auto', liveMinutes: 2, captions: true, tiktok: false, platform: 'universal', ratioMode: 'preset', customRatio: '3:2', captionLanguage: 'source', hashtagLanguage: 'source', captionStyle: defaultCaptionStyle, aiProfile: 'workspace' };

export function ProjectRow({ project }) {
  const first = project.clips[0];
  return <a className="project-row" href={`#/project/${project.id}`}>
    <div className={`project-thumb ${project.options.demo ? 'demo-thumb' : ''}`}>
      {project.options.demo ? <img src="/images/demo-studio.jpg" alt=""/> : first?.posterUrl ? <img src={first.posterUrl} alt="" loading="lazy"/> : <Film size={21}/>}
      {first && <span className="thumb-time">{timecode(first.duration)}</span>}
    </div>
    <div className="project-row-text"><div className="project-row-title"><h3>{project.title}</h3>{project.options.demo && <span className="tag tag-demo">Demo</span>}</div><p>{SHORT_DATE.format(new Date(project.createdAt))}<span>·</span>{project.clips.length ? `${project.clips.length} ${project.clips.length === 1 ? 'clip' : 'clips'}` : project.sourceKind === 'live' ? 'Livestream' : 'Clipping project'}</p></div>
    <JobBadge state={project.status}/><ChevronRight className="row-arrow" size={17}/>
  </a>;
}
export function DemoRow({ onDemo, busy }) {
  return <div className="project-row sample-row">
    <div className="project-thumb demo-thumb"><img src="/images/demo-studio.jpg" alt=""/><span className="thumb-play"><Play size={12} fill="currentColor"/></span></div>
    <div className="project-row-text"><div className="project-row-title"><h3>{demoTitle}</h3><span className="tag tag-demo">Demo</span></div><p>See scored moments and captioned clips with a sample project.</p></div>
    <Button onClick={onDemo} busy={busy} className="demo-run">Run demo<ArrowUpRight size={14}/></Button>
  </div>;
}

function Setting({ icon: Icon, title, detail, children }) {
  return <div className="setting"><Icon size={17} strokeWidth={1.65}/><div className="setting-copy"><span>{title}</span><p>{detail}</p></div><div className="setting-control">{children}</div></div>;
}

function OutputSelect({ compact, children, ...props }) {
  return <span className={`select-wrap ${compact ? 'compact' : ''}`}><select {...props}>{children}</select><ChevronDown size={compact ? 13 : 15}/></span>;
}
function LanguageSelect({ kind, value, onChange }) {
  const hashtags = kind === 'Hashtag';
  return <OutputSelect compact aria-label={`${kind} language`} value={value} onChange={(event) => onChange(event.target.value)}>
    {hashtags && <option value="off">Off</option>}
    <option value="source">{hashtags ? 'Match source' : 'Original speech'}</option>
    {Object.entries(languages).sort(([, a], [, b]) => a.localeCompare(b)).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
  </OutputSelect>;
}

export default function Studio({ workspace, projects, projectsError, createProject, notify, fields, setFields }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [connect, setConnect] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const urlInput = useRef(null), customInput = useRef(null), ratioInput = useRef(null);
  const profiles = (workspace?.providers || []).filter((profile) => profile.model);
  const active = profiles.find((profile) => profile.id === workspace?.activeProviderId);
  const selected = profiles.find((profile) => profile.id === fields.aiProfile);
  const aiProfile = fields.aiProfile === 'workspace' || selected ? fields.aiProfile : 'local';
  const captionStyle = captionScriptFont(fields.captionLanguage) ? { ...fields.captionStyle, font: 'auto' } : fields.captionStyle;
  const profileNameCount = new Map();
  for (const { name } of profiles) profileNameCount.set(name, (profileNameCount.get(name) || 0) + 1);
  const profileLabel = (profile) => profileNameCount.get(profile.name) > 1 ? `${profile.name} · ${profile.model} · ${profile.id.slice(-6)}` : profile.name;
  const tiktokConnected = Boolean(workspace?.tiktok.connected);
  const count = fields.count;
  const maxClips = workspace?.maxClips || 20;
  const platform = platforms[fields.platform];
  const ratio = fields.ratioMode === 'custom' ? fields.customRatio : fields.ratioMode === 'preset' ? platform.ratio : fields.ratioMode;
  const frame = fields.ratioMode === 'custom' ? frameFor(ratio) : exportFrame({ platform: fields.platform, aspectRatio: ratio });
  const change = (key, value) => { setError(''); setFields((previous) => ({ ...previous, [key]: value })); };
  async function submit(demo = false) {
    setError('');
    if (!demo && !fields.url.trim()) { setError('Paste a YouTube video or livestream link to get started.'); urlInput.current?.focus(); return; }
    const resolved = count === 'auto' ? 'auto' : Number(count === 'custom' ? fields.custom : count);
    if (resolved !== 'auto' && (!Number.isInteger(resolved) || resolved < 1 || resolved > maxClips)) { setError(`Enter a whole number from 1 to ${maxClips}.`); customInput.current?.focus(); return; }
    if (!frame) { setError('Enter a custom ratio like 3:2, between 1:4 and 4:1 (whole numbers from 1 to 100).'); ratioInput.current?.focus(); return; }
    setBusy(demo ? 'demo' : 'submit');
    try {
      const { custom, ratioMode, customRatio, ...options } = fields;
      await createProject({ ...options, url: fields.url.trim(), demo, count: resolved, aiProfile, aspectRatio: frame.ratio, tiktok: !demo && tiktokConnected && fields.tiktok });
    } catch (err) { setError(err.message); notify(err.message, 'error'); }
    finally { setBusy(''); }
  }
  async function pasteUrl() {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) { change('url', text.trim()); setError(''); }
      else notify('Your clipboard is empty. Copy a YouTube link first.');
    } catch { notify('Use Ctrl+V or ⌘V to paste into the link field.'); }
    urlInput.current?.focus();
  }
  return <div className="studio view-enter">
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-art" aria-hidden="true"/>
      <div className="hero-content">
        <div className="hero-label"><span/><span>AI CLIPPING STUDIO</span></div>
        <h1 id="hero-title">Find the moment.<br/><em>Make it a clip.</em></h1>
        <p>Turn YouTube videos and livestreams into short, captioned clips with AI-assisted highlight detection.</p>
      </div>
      <div className="hero-signal" aria-hidden="true"><AudioLines size={14} strokeWidth={1.6}/><span>SIGNAL VIEW</span><span className="hero-signal-dot"/></div>
      <span className="hero-cross" aria-hidden="true">+</span>
    </section>

    <div className="studio-grid">
      <section className="panel studio-panel project-panel" aria-label="New project">
        <PanelHeading icon={Link2} title="New project" description="Start with a YouTube video or livestream."><Button icon={Play} className="try-demo" onClick={() => submit(true)} busy={busy === 'demo'} disabled={busy === 'submit'}>Try demo</Button></PanelHeading>
        <form onSubmit={(event) => { event.preventDefault(); submit(); }} noValidate>
          <label className="field-label" htmlFor="source-url">YouTube link</label>
          <div className={`url-group ${error ? 'has-error' : ''}`}>
            <svg className="youtube-mark" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2.6" y="5.5" width="18.8" height="13" rx="3.5"/><path d="m10 9 5 3-5 3z"/></svg>
            <input ref={urlInput} type="url" id="source-url" placeholder="https://www.youtube.com/watch?v=…" value={fields.url} maxLength={1000} autoComplete="url" spellCheck="false" onChange={(event) => { change('url', event.target.value); setError(''); }}/>
            <button className="paste-button" type="button" onClick={pasteUrl}><Clipboard size={14}/><span>Paste</span></button>
          </div>
          <div className="clip-count-head"><span className="field-label" id="count-label">Number of clips</span></div>
          <div className="count-group" role="group" aria-labelledby="count-label">
            <button className={`count-button count-auto ${count === 'auto' ? 'is-active' : ''}`} aria-pressed={count === 'auto'} type="button" onClick={() => change('count', 'auto')}><Sparkles size={14}/>Auto</button>
            {presets.map((n) => <button key={n} className={`count-button ${count === n ? 'is-active' : ''}`} aria-pressed={count === n} type="button" onClick={() => { change('count', n); setError(''); }}>{n}</button>)}
            <button className={`count-button count-custom ${count === 'custom' ? 'is-active' : ''}`} aria-pressed={count === 'custom'} type="button" onClick={() => { change('count', 'custom'); setError(''); window.requestAnimationFrame(() => customInput.current?.focus()); }}><SlidersHorizontal size={14}/>Custom</button>
          </div>
          {count === 'auto' && <p className="count-note">Clipforge keeps strong, non-overlapping moments it finds, up to {maxClips}. If none stand out, it keeps the best one.</p>}
          {count === 'custom' && <div className="inline-custom"><label className="field-label" htmlFor="custom-count">Custom count</label><input ref={customInput} id="custom-count" type="number" min="1" max={maxClips} value={fields.custom} onChange={(event) => { change('custom', event.target.value); setError(''); }}/><span>Up to {maxClips} clips</span></div>}
          <div className="export-settings" role="group" aria-labelledby="export-label">
            <div className="export-heading"><span className="field-label" id="export-label"><Frame size={15}/> Export format</span>{frame && <output className="format-hint" aria-live="polite">{frame.width} × {frame.height} MP4</output>}</div>
            <div className="form-pair">
              <div className="form-field"><label htmlFor="export-platform">Platform preset</label><OutputSelect id="export-platform" value={fields.platform} onChange={(event) => change('platform', event.target.value)}>{Object.entries(platforms).map(([id, { name }]) => <option key={id} value={id}>{name}</option>)}</OutputSelect></div>
              <div className="form-field"><label htmlFor="aspect-ratio">Aspect ratio</label><OutputSelect id="aspect-ratio" value={fields.ratioMode} onChange={(event) => change('ratioMode', event.target.value)}><option value="preset">Recommended · {platform.ratio}</option>{ratioChoices.map(({ value, name }) => <option key={value} value={value}>{name} · {value}</option>)}<option value="custom">Custom ratio</option></OutputSelect></div>
            </div>
            {fields.ratioMode === 'custom' && <div className="inline-custom custom-ratio"><label className="field-label" htmlFor="custom-ratio">Custom ratio</label><input ref={ratioInput} id="custom-ratio" value={fields.customRatio} maxLength={13} placeholder="3:2" onChange={(event) => change('customRatio', event.target.value)} aria-describedby="ratio-help"/><span id="ratio-help">Width : height</span></div>}
            <p className="export-note">{fields.platform !== 'universal' && frame?.ratio !== platform.ratio ? 'Check that your destination accepts this ratio. ' : ''}Presets set the frame only. They don’t connect or publish to accounts.</p>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="generate-button" disabled={Boolean(busy)}>{busy === 'submit' ? <LoaderCircle size={18} className="spin"/> : <Sparkles size={18} strokeWidth={2}/>}{busy === 'submit' ? 'Starting project…' : 'Generate clips'}<ArrowRight className="generate-arrow" size={18}/></button>
          <p className="rights-note"><ShieldCheck size={14}/> Use content you own or have permission to clip.</p>
        </form>
      </section>
      <section className="panel studio-panel settings-panel" aria-label="Output settings">
        <PanelHeading icon={SlidersHorizontal} title="Output settings" description="Choose what to capture and how to caption it."/>
        <div className="settings-list">
          <Setting icon={Radio} title="Source mode" detail={fields.mode === 'live' ? 'Record from the live edge' : fields.mode === 'recorded' ? 'Use a finished recording' : 'Detect videos & livestreams'}>
            <div className="select-wrap compact"><select value={fields.mode} aria-label="Source mode" onChange={(event) => change('mode', event.target.value)}><option value="auto">Auto-detect</option><option value="recorded">Video / replay</option><option value="live">Live monitor</option></select><ChevronDown size={13}/></div>
          </Setting>
          {fields.mode !== 'recorded' && <Setting icon={AudioLines} title="Live capture limit" detail="Only applies to active streams"><div className="select-wrap compact"><select aria-label="Capture limit" value={fields.liveMinutes} onChange={(event) => change('liveMinutes', Number(event.target.value))}>{(workspace?.liveLimits || [2, 5, 10, 15, 30]).map((n) => <option key={n} value={n}>{n} min</option>)}</select><ChevronDown size={13}/></div></Setting>}
          <Setting icon={Captions} title="Auto captions" detail="Burn subtitles into clips"><Switch label="Auto captions" enabled={fields.captions} onChange={(value) => change('captions', value)}/></Setting>
          {fields.captions && <Setting icon={Languages} title="Caption language" detail={fields.captionLanguage === romanUrdu ? 'Urdu written in Latin letters' : 'Original or translated'}><LanguageSelect kind="Caption" value={fields.captionLanguage} onChange={(value) => change('captionLanguage', value)}/></Setting>}
          {fields.captions && <Setting icon={Type} title="Caption style" detail={captionStyleLabel(captionStyle)}><Button aria-label="Customize caption style" className="setting-button" onClick={() => setStyleOpen(true)}>Customize</Button></Setting>}
          <Setting icon={Hash} title="Hashtag language" detail="Suggestions, separate from captions"><LanguageSelect kind="Hashtag" value={fields.hashtagLanguage} onChange={(value) => change('hashtagLanguage', value)}/></Setting>
          <Setting icon={TikTokIcon} title="Send to TikTok" detail={tiktokConnected ? 'Preselect clips for draft review' : 'Account not connected'}><Switch label="Send to TikTok" enabled={tiktokConnected && fields.tiktok} onChange={(value) => tiktokConnected ? change('tiktok', value) : setConnect(true)}/></Setting>
          <Setting icon={Cpu} title="AI engine" detail={<a className="setting-link" href="#/providers">Manage provider profiles</a>}><OutputSelect compact className="project-ai-select" aria-label="Project AI profile" title={selected ? profileLabel(selected) : aiProfile === 'workspace' && active ? `Workspace default: ${profileLabel(active)}` : 'Local analysis'} value={aiProfile} onChange={(event) => change('aiProfile', event.target.value)}><option value="workspace">Default: {active ? profileLabel(active) : 'Local'}</option><option value="local">Local analysis</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profileLabel(profile)}</option>)}</OutputSelect></Setting>
        </div>
      </section>
    </div>

    <section className="recent-section" aria-labelledby="recent-title">
      <header className="section-heading"><h2 id="recent-title">Recent projects</h2><TextLink href="#/library">View library</TextLink></header>
      {projectsError && <Banner>{projectsError}</Banner>}
      <div className="project-list">
        {projects.length ? projects.slice(0, 3).map((project) => <ProjectRow key={project.id} project={project}/>) : <DemoRow busy={busy === 'demo'} onDemo={() => submit(true)}/>}
      </div>
    </section>
    {styleOpen && <CaptionAppearance value={fields.captionStyle} frame={frame || exportFrame({ platform: fields.platform })} language={fields.captionLanguage} canBurn={workspace?.tools?.subtitles} onClose={() => setStyleOpen(false)} onApply={(style) => { change('captionStyle', style); setStyleOpen(false); }}/>}
    {connect && <Modal onClose={() => setConnect(false)} title="Connect TikTok" subtitle="Link a TikTok account to send reviewed clips to your inbox. You’ll finish publishing in TikTok."><div className="modal-actions"><Button onClick={() => setConnect(false)}>Not now</Button><a className="button button-primary" href="#/integrations" onClick={() => setConnect(false)}><span>Open integrations</span><ArrowRight size={16}/></a></div></Modal>}
  </div>;
}

export { initialFields };
