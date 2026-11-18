import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Clapperboard, Download, FileSpreadsheet, Globe, Info, LockKeyhole, Radar, Search, Square } from 'lucide-react';
import { browseFinder, coverageLabels, discoveryLimits, discoveryNames, leadSources, reachSources, reachWindows } from '../shared/discovery.mjs';
import { Field, Select } from './forms.jsx';
import { ActionLink, api, Banner, Button, Glyph } from './ui.jsx';
import './discovery.css';

const formats = new Intl.NumberFormat();
const fileType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const seeds = { reach: ['#podcastclips', 'Cricket highlights', 'Video editing tips'], jobs: ['Video editor', 'Frontend developer', '#hiring'], leads: ['Real estate agencies', 'Dental clinics', 'Fitness studios'] };

function downloadWorkbook({ name, base64 }) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: fileType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Coverage({ result, reach }) {
  return <div className="discovery-coverage" aria-label="Source coverage">
    {result.coverage.map(({ source, method, rank, state, count, note }) => <div key={source} className="discovery-coverage-card">
      <div><strong>{discoveryNames[source]}</strong><span className={`discovery-status ${state}`}><i/>{state === 'found' ? `${count} ${count === 1 ? 'match' : 'matches'}` : coverageLabels[state]}</span></div>
      <p>{method}{rank && reach ? ` · ${rank}` : ''}</p>
      {note && <p>{note}</p>}
      {!reach && <a href={browseFinder(source, result.query, result.location)} target="_blank" rel="noreferrer" className="discovery-browse">Broader search on site <ArrowUpRight size={12}/></a>}
    </div>)}
  </div>;
}

function DiscoveryResults({ result, reach, onUseSource }) {
  const count = result.records.length;
  const measured = result.coverage.some(({ method, state }) => method === 'YouTube Data API' && state === 'found');
  const sourceCopy = reach
    ? measured ? 'YouTube shows total views among recent matches, not view growth. Other results are ordered by public-index relevance.' : 'Ordered by relevance within each platform. Indexed dates can be missing or stale; these results are not a popularity chart.'
    : 'Open the source to verify each listing. LinkedIn postings may be closed or require sign-in. Maps results are links only.';
  const allUnavailable = result.coverage.every(({ state }) => ['limited', 'unavailable'].includes(state));
  return <section className="panel discovery-results" aria-label={`${reach ? 'Reach' : 'Finder'} results`}>
    <header className="discovery-results-head">
      <div><p className="eyebrow">{reach ? 'VIDEO DISCOVERY' : 'PUBLIC LISTINGS'}</p><h2 aria-live="polite">{allUnavailable ? 'Search unavailable' : `${count} direct ${count === 1 ? 'link' : 'links'}`}</h2><p className="discovery-result-query" dir="auto">{result.query}{result.location && ` · ${result.location}`}{reach && ` · Last ${result.days} days`}</p></div>
      {result.workbook && <Button icon={Download} tone="primary" onClick={() => downloadWorkbook(result.workbook)}>Download Excel</Button>}
    </header>
    <Coverage result={result} reach={reach}/>
    {!count ? <div className="discovery-empty"><Info size={17}/><p>{allUnavailable ? <>No provider completed this search. Try again later, or see <a href="#/setup">search setup</a> for the server requirements.</> : 'No direct links matched. Try different keywords, a wider location or date range, or another source.'}{!reach && ' Broader site searches above are not exported as results.'}</p></div> : <>
      <p className="discovery-result-note"><Info size={15}/>{sourceCopy}</p>
      <ol className="discovery-list">
        {result.records.map((item, index) => <li key={`${item.source}:${item.url}`} className="discovery-row">
          <span className="discovery-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <div className="discovery-row-body">
            <div className="discovery-row-meta"><span>{discoveryNames[item.source]}</span>{item.live && <span className="discovery-live">Live</span>}{item.published && <time dateTime={item.published}>{item.published}</time>}{Number.isSafeInteger(item.views) && <strong>{formats.format(item.views)} views</strong>}</div>
            <h3 dir="auto">{item.title}</h3>
            {((reach && item.author) || item.excerpt) && <p dir="auto">{[reach && item.author, item.excerpt].filter(Boolean).join(' · ')}</p>}
            {item.source === 'maps' && <p>Open Google Maps to review this place.</p>}
            {reach && !item.published && <p>Publish date not confirmed.</p>}
          </div>
          <div className="discovery-row-actions">
            <ActionLink icon={ArrowUpRight} href={item.url} target="_blank" rel="noreferrer">{reach ? 'Open video' : 'Open listing'}</ActionLink>
            {reach && item.clippable && <Button icon={Clapperboard} onClick={() => onUseSource(item.url, item.live)}>Use in Clip Studio</Button>}
          </div>
        </li>)}
      </ol>
      {reach && <p className="discovery-result-note"><LockKeyhole size={15}/>Only YouTube links can go to Clip Studio. Use content you have permission to clip.</p>}
    </>}
  </section>;
}

export default function DiscoveryPane({ kind, enabled, prefill, onUseSource }) {
  const reach = kind === 'reach', name = reach ? 'Reach' : 'Finder';
  const [query, setQuery] = useState(''), [location, setLocation] = useState(''), [source, setSource] = useState('all'), [days, setDays] = useState(30);
  const [mode, setMode] = useState('jobs'), [result, setResult] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const queryField = useRef(null), request = useRef(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  useEffect(() => {
    if (!prefill) return;
    request.current?.abort();
    setQuery(prefill.query.slice(0, discoveryLimits.query)); setMode('jobs'); setLocation(''); setSource('all'); setError(''); setResult(null);
    queryField.current?.focus();
  }, [prefill]);
  async function run(event) {
    event.preventDefault();
    if (!enabled || request.current || !query.trim()) return;
    const ctrl = new AbortController();
    request.current = ctrl;
    setBusy(true); setError(''); setResult(null);
    try {
      const payload = await api(`/chat/${kind}`, { method: 'POST', signal: ctrl.signal, body: { query, location, source, days, mode } });
      if (!ctrl.signal.aborted) setResult(payload);
    } catch (err) { if (!ctrl.signal.aborted) setError(err.message); }
    finally { if (request.current === ctrl) { request.current = null; setBusy(false); } }
  }
  const choices = reach ? reachSources : leadSources;
  return <div className="discovery-workspace">
    <section className="panel discovery-search" aria-label={name}>
      <div className="discovery-hero">
        <div className="discovery-intro"><Glyph icon={reach ? Radar : FileSpreadsheet}/><div><p className="eyebrow">{reach ? 'FIND A CLIP SOURCE' : 'BUILD A SHORTLIST'}</p><h2>{name}</h2></div></div>
        <p>{reach ? 'Search a topic or hashtag for recent public videos. Open the originals or take a YouTube link to Clip Studio.' : 'Find public LinkedIn jobs and companies or indexed Google Maps listings. Save direct links in an Excel workbook you can review and annotate.'}</p>
        <div className="discovery-platforms">{(reach ? reachSources : ['jobs', ...leadSources]).map((id) => <span key={id}><i/>{discoveryNames[id]}</span>)}</div>
      </div>
      <form className="discovery-form" onSubmit={run}>
        {!enabled && <Banner tone="warning" icon={Info}>Public search is disabled by this workspace’s administrator.</Banner>}
        <fieldset disabled={!enabled || busy}>
          {!reach && <div className="discovery-mode" role="group" aria-label="Finder search type">
            <button type="button" aria-pressed={mode === 'jobs'} onClick={() => { setMode('jobs'); setSource('all'); }}>Jobs</button>
            <button type="button" aria-pressed={mode === 'leads'} onClick={() => { setMode('leads'); setSource('all'); }}>Business leads</button>
          </div>}
          <div className={`discovery-fields ${!reach && mode === 'jobs' ? 'discovery-fields-pair' : ''}`}>
            <Field label={reach ? 'Topic or hashtag' : mode === 'jobs' ? 'Job title or hashtag' : 'Business type or hashtag'}><input ref={queryField} value={query} onChange={(event) => setQuery(event.target.value)} maxLength={discoveryLimits.query} placeholder={reach ? 'e.g. #podcastclips' : mode === 'jobs' ? 'e.g. Video editor' : 'e.g. Dental clinics'} required/></Field>
            {!reach && <Field label="Location (optional)"><input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={discoveryLimits.location} placeholder={mode === 'jobs' ? 'e.g. Lahore or remote' : 'e.g. Lahore'}/></Field>}
            {(reach || mode === 'leads') && <Field label={reach ? 'Platform' : 'Business source'}><Select value={source} onChange={(event) => setSource(event.target.value)}><option value="all">{reach ? 'All platforms' : 'Both sources'}</option>{choices.map((id) => <option key={id} value={id}>{discoveryNames[id]}</option>)}</Select></Field>}
            {reach && <Field label="Date range"><Select value={days} onChange={(event) => setDays(Number(event.target.value))}>{reachWindows.map((period) => <option key={period} value={period}>Last {period} days</option>)}</Select></Field>}
          </div>
          <div className="discovery-seeds"><span>Try:</span>{seeds[reach ? 'reach' : mode].map((term) => <button type="button" key={term} onClick={() => { setQuery(term); queryField.current?.focus(); }}>{term}</button>)}</div>
        </fieldset>
        {error && <Banner>{error}</Banner>}
        <div className="discovery-submit">
          <p className="discovery-privacy"><LockKeyhole size={14}/>Only this query and its filters go to search providers. Your Chat messages and projects aren’t shared.</p>
          <div>{busy && <Button icon={Square} onClick={() => request.current?.abort()}>Stop</Button>}<Button type="submit" tone="primary" icon={Search} busy={busy} disabled={!enabled || !query.trim()}>{busy ? 'Searching…' : reach ? 'Find videos' : mode === 'jobs' ? 'Find jobs' : 'Find businesses'}</Button></div>
        </div>
      </form>
    </section>
    {busy && <div className="panel discovery-empty" role="status"><Globe size={18}/><p>Checking public sources… {reach ? '' : 'The workbook will be ready with the results.'}</p></div>}
    {result && <DiscoveryResults result={result} reach={reach} onUseSource={onUseSource}/>}
  </div>;
}
