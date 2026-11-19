import { useState } from 'react';
import { Activity, History, MessageSquare, Radio, Sparkles, Square } from 'lucide-react';
import { ActionLink, api, Banner, Button, Confirm, Modal, PanelHeading, timecode } from './ui.jsx';
import { Field, Select } from './forms.jsx';

const modes = [
  { id: 'analytics', label: 'Analytics', icon: Activity, detail: 'Analyze captured footage on demand.' },
  { id: 'auto', label: 'Auto', icon: Sparkles, detail: 'Use chat spikes and AI to find clips.' },
  { id: 'full', label: 'Full', icon: History, detail: 'Analyze the same broadcast’s replay from the start.' },
];
const chatStatus = { connecting: 'Connecting', listening: 'Listening', unavailable: 'Unavailable', finished: 'Finished' };
const phases = { recording: 'Recording', finishing: 'Finishing capture', switching: 'Switching to replay', replay: 'Full replay', idle: 'Open · Capture finished', ending: 'Ending' };

export function LiveMonitor({ job, workspace, onUpdate, notify }) {
  const [busy, setBusy] = useState(''), [dialog, setDialog] = useState(null), [error, setError] = useState(''), [providerId, setProviderId] = useState('');
  const { monitor } = job;
  const profiles = [...(workspace?.providers || []), ...(workspace?.sharedProviders || [])].filter((profile) => profile.model);
  const resolvedId = job.options.aiProfile === 'workspace' ? workspace?.activeProviderId : job.options.aiProfile;
  const canSwitch = monitor.phase === 'recording' && monitor.mode !== 'full';
  const fullAvailable = monitor.mode !== 'full' && ['recording', 'finishing', 'idle'].includes(monitor.phase);
  const chat = monitor.chat;
  const ready = monitor.phase === 'recording' && monitor.mode === 'analytics' && monitor.canAnalyze;
  const capturePhase = ['recording', 'finishing'].includes(monitor.phase);
  const working = ['recording', 'finishing', 'switching', 'replay'].includes(monitor.phase);
  const liveLimit = job.captureLimitSeconds || job.options.liveMinutes * 60;
  async function change(action, mode) {
    setBusy(action); setError('');
    try {
      const next = await api(`/projects/${job.id}/${action}`, action === 'monitor' ? { method: 'PUT', body: { mode, ...(mode === 'auto' && { providerId }) } } : { method: 'POST' });
      onUpdate(next); setDialog(null);
      if (action === 'end') notify('Ending the monitor. Any rendered clips are kept.');
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  function selectMode(mode) {
    setError('');
    if (mode === 'analytics') { void change('monitor', mode); return; }
    setProviderId(profiles.find((profile) => profile.id === resolvedId)?.id || profiles[0]?.id || '');
    setDialog(mode);
  }
  const close = () => { if (!busy) { setDialog(null); setError(''); } };
  return <section className="panel live-monitor" aria-label="Live monitor">
    <PanelHeading icon={Radio} title="Live Monitor" description="Clips are saved here without ending the project."><span className="badge badge-green"><i/>{monitor.phase === 'idle' && monitor.mode === 'full' ? 'Open · Replay checked' : phases[monitor.phase] || 'Open'}</span></PanelHeading>
    <div className="monitor-modes" role="group" aria-label="Live monitor mode">{modes.map(({ id, label, icon: Icon, detail }) => <button key={id} type="button" aria-pressed={id === monitor.mode} disabled={Boolean(busy) || (id === 'full' ? !fullAvailable : !canSwitch || id === monitor.mode)} onClick={() => selectMode(id)}><Icon size={17}/><strong>{label}</strong><small>{detail}</small></button>)}</div>
    <div className="monitor-body" aria-live="polite">
      <div className="monitor-source"><strong>{job.detail}</strong>{monitor.analysis && <p>{monitor.analysis}</p>}{capturePhase && monitor.clipLimit && job.clips.length >= monitor.clipLimit && <p>Live clip limit reached. Recording can continue until the capture limit.</p>}</div>
      {capturePhase && <div className="monitor-clock"><Radio size={15}/><span>{timecode(job.capturedSeconds)} / {timecode(liveLimit)}</span></div>}
    </div>
    {working && <progress className="monitor-progress" aria-label={capturePhase ? 'Live capture progress' : 'Replay progress'} max={capturePhase ? liveLimit : 100} value={capturePhase ? job.capturedSeconds || 0 : job.progress}/>}
    {chat && <div className="monitor-chat"><MessageSquare size={17}/><div><strong>Live chat · {chatStatus[chat.state] || 'Unavailable'}</strong><p>{chat.state === 'unavailable' ? 'YouTube did not provide a usable public chat feed, or the feed was interrupted. This is not quiet chat.' : chat.state === 'connecting' ? 'Waiting for the public chat feed.' : `${chat.messagesPerMinute || 0} messages in the last minute · ${chat.spikes || 0} ${chat.spikes === 1 ? 'spike' : 'spikes'} detected`}</p></div></div>}
    {error && !dialog && <Banner>{error}</Banner>}
    <div className="monitor-footer">
      <p>{monitor.mode === 'full' ? 'Full uses the entire playable replay, subject to the workspace’s source limits.' : capturePhase ? 'Live timestamps are relative to this capture. Chat reaction timing is approximate.' : 'End the project when you’re done reviewing. Your rendered files stay available.'}</p>
      <div className="monitor-actions">
        {canSwitch && monitor.mode === 'analytics' && <Button icon={Sparkles} tone="primary" disabled={!ready || Boolean(busy)} busy={busy === 'finish-capture' || monitor.busy} onClick={() => change('finish-capture')}>Analyze now</Button>}
        {canSwitch && monitor.mode === 'auto' && <Button icon={Sparkles} disabled={monitor.busy || Boolean(busy)} onClick={() => selectMode('auto')}>Change AI model</Button>}
        <Button icon={Square} disabled={monitor.phase === 'ending' || Boolean(busy)} onClick={() => { setError(''); setDialog('end'); }}>End project</Button>
      </div>
    </div>
    {dialog === 'full' && <Confirm title="Switch to Full?" message={`Curiousity will stop recording from the live edge and wait up to ${workspace?.replayWaitMinutes || 360} minutes for this same YouTube broadcast’s replay. Full analyzes from the start, including before you joined. Existing clips stay here.`} label="Wait for full replay" danger={false} onClose={close} onConfirm={() => change('monitor', 'full')} busy={Boolean(busy)} error={error}/>}
    {dialog === 'end' && <Confirm title="End this live project?" message="This stops recording, analysis, or replay checks. Rendered clips stay in the project; unprocessed footage is discarded." label="End project" onClose={close} onConfirm={() => change('end')} busy={Boolean(busy)} error={error}/>}
    {dialog === 'auto' && <Modal title="Auto clips from chat spikes" subtitle="When public chat activity spikes, Curiousity uses the selected model to rank the nearby footage. Clips stay private and nothing is posted automatically." onClose={close}>
      <div className="modal-form">
        {profiles.length ? <Field label="Auto AI profile" hint="A shared model uses one AI-project slot for this project. Personal profiles use your own key."><Select value={providerId} onChange={(event) => setProviderId(event.target.value)}>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name} · {profile.managed ? 'Shared' : 'Personal'}</option>)}</Select></Field> : <Banner tone="warning">Auto needs an AI model. Add your own provider or ask the administrator to share one.</Banner>}
        {error && <Banner>{error}</Banner>}
        <div className="modal-actions"><Button onClick={close} disabled={Boolean(busy)}>Cancel</Button>{profiles.length ? <Button tone="primary" icon={Sparkles} busy={Boolean(busy)} disabled={!providerId} onClick={() => change('monitor', 'auto')}>Use Auto</Button> : <ActionLink href="#/settings/providers">AI providers</ActionLink>}</div>
      </div>
    </Modal>}
  </section>;
}
