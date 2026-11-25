import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Clapperboard, Globe, Info, LockKeyhole, Plus, Radar, Search, ShieldCheck, Square } from 'lucide-react';
import { availabilityLabels, coverageLabels, defaultDiscoveryDays, discoveryLimits, discoveryNames, discoveryVerificationVersion, discoveryWindows, exclusionSummary, lookbackLabel, reachSources, reviewLabels } from '../shared/discovery.mjs';
import { Field, Select } from './forms.jsx';
import { ActionLink, api, Banner, Button, Glyph, Switch } from './ui.jsx';
import './discovery.css';

const formats = new Intl.NumberFormat();
const seeds = ['#podcastclips', 'Cricket highlights', 'Video editing tips'];

function Coverage({ result }) {
  return <div className="discovery-coverage" aria-label="Source coverage">
    {result.coverage.map(({ source, method, rank, state, count, note, excluded }) => <div key={source} className="discovery-coverage-card">
      <div><strong>{discoveryNames[source]}</strong><span className={`discovery-status ${state}`}><i/>{state === 'found' ? `${count} ${count === 1 ? 'match' : 'matches'}` : coverageLabels[state]}</span></div>
      <p>{method}{rank ? ` · ${rank}` : ''}</p>
      {note && <p>{note}</p>}
      {exclusionSummary(excluded) && <p>Skipped: {exclusionSummary(excluded)}</p>}
    </div>)}
  </div>;
}

function DiscoveryResults({ result, onUseSource, onReset }) {
  const count = result.records.length;
  const review = result.aiReview;
  const measured = result.coverage.some(({ method, state }) => method === 'YouTube Data API' && state === 'found');
  const availabilityNote = measured
    ? 'YouTube counts are total views, not view growth. Index results are ranked by relevance. Playback access may vary by viewer.'
    : 'Results are ranked by relevance within each platform, not popularity. Playback access may vary by viewer.';
  const allUnavailable = result.coverage.every(({ state }) => ['limited', 'unavailable'].includes(state));
  const emptyMessage = review.state === 'failed'
    ? 'The selected AI model couldn’t finish reviewing the matches, so none were returned. Check the model or retry with AI review off. The date and availability checks will still apply.'
    : allUnavailable ? <>No provider completed this search. Try again later, or see <a href="#/setup">search setup</a> for server requirements.</>
      : review.state === 'complete' ? 'AI review didn’t clear any of the source-checked matches. Try more specific keywords or another source.'
        : 'No videos passed the date and availability checks. Try a wider range, different keywords, or another source.';
  return <section className="panel discovery-results" aria-label="Reach results">
    <header className="discovery-results-head">
      <div><p className="eyebrow">VIDEO DISCOVERY</p><h2 aria-live="polite">{allUnavailable ? 'Search unavailable' : `${count} ${count === 1 ? 'result' : 'results'} passed`}</h2><p className="discovery-result-query" dir="auto">{result.query} · {lookbackLabel(result.days)}</p></div>
      <div className="discovery-results-actions"><Button icon={Plus} onClick={onReset}>New search</Button></div>
    </header>
    <p className="discovery-result-note discovery-verification-note"><ShieldCheck size={15}/><span><strong>{reviewLabels[review.state]}</strong>{review.state === 'complete' && ` · ${review.checked} source-checked ${review.checked === 1 ? 'result' : 'results'} reviewed`}<br/>Search started <time dateTime={result.searchedAt}>{new Date(result.searchedAt).toLocaleString()}</time></span></p>
    <Coverage result={result}/>
    {!count ? <div className="discovery-empty"><Info size={17}/><p>{emptyMessage}</p></div> : <>
      <p className="discovery-result-note"><Info size={15}/>{availabilityNote}</p>
      <ol className="discovery-list">
        {result.records.map((item, index) => <li key={`${item.source}:${item.url}`} className="discovery-row">
          <span className="discovery-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <div className="discovery-row-body">
            <div className="discovery-row-meta"><span>{discoveryNames[item.source]}</span><time dateTime={item.published} title="Reported source date (UTC)">{item.published}</time>{item.live && <span className="discovery-live">Live</span>}{Number.isSafeInteger(item.views) && <strong>{formats.format(item.views)} views</strong>}</div>
            <h3 dir="auto">{item.title}</h3>
            <span className="discovery-available"><ShieldCheck size={13}/>{availabilityLabels[item.availability]}</span>
            {(item.author || item.excerpt) && <p dir="auto">{[item.author, item.excerpt].filter(Boolean).join(' · ')}</p>}
          </div>
          <div className="discovery-row-actions">
            <ActionLink icon={ArrowUpRight} href={item.url} target="_blank" rel="noreferrer">Open video</ActionLink>
            {item.clippable && <Button icon={Clapperboard} onClick={() => onUseSource(item.url, item.live)}>Use in Clip Studio</Button>}
          </div>
        </li>)}
      </ol>
      <p className="discovery-result-note"><LockKeyhole size={15}/>Only YouTube links can go to Clip Studio. Use content you have permission to clip.</p>
    </>}
  </section>;
}

export default function DiscoveryPane({ enabled, onUseSource, profile }) {
  const [query, setQuery] = useState(''), [source, setSource] = useState('all');
  const [range, setRange] = useState(String(defaultDiscoveryDays)), [custom, setCustom] = useState('');
  const [modelReview, setModelReview] = useState(true);
  const [result, setResult] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const queryField = useRef(null), request = useRef(null);
  const days = Number(range === 'custom' ? custom : range);
  const validDays = Number.isInteger(days) && days >= 1 && days <= discoveryLimits.days;
  const reviewer = modelReview ? profile : null;
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);

  function reset(value = '') {
    const active = request.current;
    request.current = null; active?.abort();
    setQuery(value); setSource('all'); setRange(String(defaultDiscoveryDays)); setCustom('');
    setBusy(false); setError(''); setResult(null);
    requestAnimationFrame(() => queryField.current?.focus());
  }
  async function run(event) {
    event.preventDefault();
    if (!enabled || request.current || !query.trim() || !validDays) return;
    const ctrl = new AbortController();
    request.current = ctrl;
    setBusy(true); setError(''); setResult(null);
    try {
      const payload = await api('/chat/reach', { method: 'POST', signal: ctrl.signal, body: { query, source, days,
        ...(reviewer ? { reviewProfileId: reviewer.id, reviewRevision: reviewer.revision || reviewer.id } : {}) } });
      if (payload.verificationVersion !== discoveryVerificationVersion) throw new Error('The running server hasn’t loaded verified search yet. Rebuild and restart Curiousity before using these results.');
      if (request.current === ctrl && !ctrl.signal.aborted) setResult(payload);
    } catch (err) { if (request.current === ctrl && !ctrl.signal.aborted) setError(err.message); }
    finally { if (request.current === ctrl) { request.current = null; setBusy(false); } }
  }
  const canReset = busy || query || source !== 'all' || range !== String(defaultDiscoveryDays) || error;
  return <div className="discovery-workspace">
    <section className="panel discovery-search" aria-label="Reach">
      <div className="discovery-hero">
        <div className="discovery-intro"><Glyph icon={Radar}/><div><p className="eyebrow">FIND A CLIP SOURCE</p><h2>Reach</h2></div></div>
        <p>Find recent public videos. Only results with a date and usable source evidence are kept.</p>
        <div className="discovery-platforms">{reachSources.map((id) => <span key={id}><i/>{discoveryNames[id]}</span>)}</div>
      </div>
      <form className="discovery-form" onSubmit={run}>
        {!enabled && <Banner tone="warning" icon={Info}>Public search is disabled by this workspace’s administrator.</Banner>}
        <fieldset disabled={!enabled || busy}>
          <div className="discovery-fields discovery-fields-pair">
            <Field label="Topic or hashtag"><input ref={queryField} value={query} onChange={(event) => setQuery(event.target.value)} maxLength={discoveryLimits.query} placeholder="e.g. #podcastclips" required/></Field>
            <Field label="Platform"><Select value={source} onChange={(event) => setSource(event.target.value)}><option value="all">All platforms</option>{reachSources.map((id) => <option key={id} value={id}>{discoveryNames[id]}</option>)}</Select></Field>
          </div>
          <div className="discovery-seeds"><span>Try:</span>{seeds.map((term) => <button type="button" key={term} onClick={() => { setQuery(term); queryField.current?.focus(); }}>{term}</button>)}</div>
          <div className="discovery-checks">
            <div className="discovery-range">
              <div><Field label="Date range"><Select value={range} onChange={(event) => setRange(event.target.value)}>{discoveryWindows.map((period) => <option key={period} value={period}>{lookbackLabel(period)}</option>)}<option value="custom">Custom days</option></Select></Field>
              {range === 'custom' && <Field label="Days back"><input type="number" min="1" max={discoveryLimits.days} step="1" required value={custom} onChange={(event) => setCustom(event.target.value)} placeholder={`1–${discoveryLimits.days}`}/></Field>}</div>
              <p>Uses the date reported by the source. Undated results are skipped.</p>
            </div>
            <div className="discovery-ai"><div><ShieldCheck size={16}/><strong>AI review</strong>{profile && <Switch label="AI review" enabled={modelReview} onChange={setModelReview}/>}</div>
              <p>{profile ? modelReview ? <>Uses <b>{profile.name}</b> to review the search criteria and short public excerpts after the source checks.</> : 'Off. Date and availability checks remain on.' : <>Source checks are on. <a href="#/settings/providers">Add a Chat model</a> to also review matches with AI.</>}</p></div>
          </div>
        </fieldset>
        {error && <Banner>{error}</Banner>}
        <div className="discovery-submit">
          <p className="discovery-privacy"><LockKeyhole size={14}/>No Chat history or projects are sent to search or AI providers.</p>
          <div>{!result && canReset && <Button icon={Plus} onClick={() => reset()}>New search</Button>}{busy && <Button icon={Square} onClick={() => request.current?.abort()}>Stop</Button>}<Button type="submit" tone="primary" icon={Search} busy={busy} disabled={!enabled || !query.trim() || !validDays}>{busy ? 'Checking results…' : 'Find videos'}</Button></div>
        </div>
      </form>
    </section>
    {busy && <div className="panel discovery-empty" role="status"><Globe size={18}/><p>Checking source dates and availability{reviewer ? ', then reviewing with your Chat model' : ''}…</p></div>}
    {result && <DiscoveryResults result={result} onUseSource={onUseSource} onReset={() => reset()}/>}
  </div>;
}
