import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Captions, Check, Cpu, FileSpreadsheet, FileText, LockKeyhole, MessageSquare, Plug, Plus, Radar, Send, Sparkles, Square, UserRound } from 'lucide-react';
import { chatContext, chatLimits } from '../shared/chat.mjs';
import { providerCatalog } from '../shared/providers.mjs';
import { finderCommand } from '../shared/discovery.mjs';
import DiscoveryPane from './discovery.jsx';
import { ActionLink, api, Banner, Button, Confirm, EmptyState, Glyph, Modal, PageHeading } from './ui.jsx';
import { Select } from './forms.jsx';
import { appAccountLabel, ConnectedApps } from './composio.jsx';
import './media-workspaces.css';

const reviewJson = (args) => JSON.stringify(args, null, 2).replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

const starters = [
  { icon: Sparkles, title: 'Brainstorm hooks', description: 'Get opening lines for your next video.', prompt: 'Help me brainstorm five short opening hooks for a video about ' },
  { icon: FileText, title: 'Summarize a transcript', description: 'Turn a passage into a clear outline.', prompt: 'Summarize the main points in this transcript. Keep the summary factual:\n\n' },
  { icon: Captions, title: 'Polish captions', description: 'Tighten wording for easy reading.', prompt: 'Make these captions easier to read without changing their meaning:\n\n' },
];

function Message({ role, content, profile, truncated, appResult }) {
  const mine = role === 'user';
  return <article className={`chat-message ${mine ? 'chat-mine' : 'chat-theirs'}`}>
    <span className="chat-avatar" aria-hidden="true">{mine ? <UserRound size={15}/> : <Sparkles size={16}/>}</span>
    <div className="chat-message-body"><h3>{mine ? 'You' : profile.name}</h3><p dir="auto">{content}</p>{truncated && <span className="chat-truncated">Reply shortened for this workspace.</span>}{appResult && <details className="composio-result"><summary>View app result</summary><pre dir="auto">{appResult}</pre></details>}</div>
  </article>;
}

function Conversation({ profile, profiles, onSelect, onFinder, app }) {
  const [history, setHistory] = useState([]), [draft, setDraft] = useState(''), [pending, setPending] = useState(null), [error, setError] = useState(''), [reset, setReset] = useState(false);
  const [review, setReview] = useState(null), [confirming, setConfirming] = useState(false), [expired, setExpired] = useState(false);
  const request = useRef(null), composer = useRef(null), transcript = useRef(null), reviewRef = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
      if (reviewRef.current && !reviewRef.current.running) void api(`/chat/apps/actions/${reviewRef.current.id}`, { method: 'DELETE' }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!review) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, review.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [review]);
  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [history, pending, error, review]);
  function prefill(prompt) { setDraft(prompt); setError(''); requestAnimationFrame(() => composer.current?.focus()); }
  async function send(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || request.current || review) return;
    const find = finderCommand(content);
    if (onFinder && find !== null) { onFinder(find); setDraft(''); setError(''); return; }
    const ctrl = new AbortController();
    request.current = ctrl;
    setDraft(''); setPending(content); setError('');
    try {
      const result = await api(app ? '/chat/apps' : '/chat', { method: 'POST', signal: ctrl.signal,
        body: { providerId: profile.id, revision: profile.revision || profile.id, messages: chatContext(history, content), ...(app && { connectionId: app.id }) } });
      if (!ctrl.signal.aborted && result.review) {
        const step = { ...result.review, message: content };
        reviewRef.current = step; setExpired(false); setReview(step);
      } else if (!ctrl.signal.aborted) append(content, result);
    } catch (err) {
      if (!mounted.current) return;
      setDraft(content);
      if (!ctrl.signal.aborted) setError(err.message);
    } finally {
      request.current = null;
      if (mounted.current) { setPending(null); requestAnimationFrame(() => composer.current?.focus({ preventScroll: true })); }
    }
  }
  function append(content, result) {
    setHistory((previous) => [...previous, { role: 'user', content }, { role: 'assistant', content: result.reply, truncated: result.truncated, appResult: result.appResult }]);
  }
  async function reviewAction(approved) {
    const step = reviewRef.current;
    if (!step || confirming || request.current || (approved && expired)) return;
    const ctrl = new AbortController(), path = `/chat/apps/actions/${step.id}`;
    request.current = ctrl;
    step.running = approved;
    setConfirming(true); setError('');
    try {
      const result = await api(path, approved ? { method: 'POST', body: { approved: true }, signal: ctrl.signal } : { method: 'DELETE', signal: ctrl.signal });
      if (!ctrl.signal.aborted) append(step.message, result || { reply: 'App action cancelled. Nothing was run.' });
    } catch (err) {
      if (!ctrl.signal.aborted) {
        if (approved) {
          append(step.message, { reply: err.status ? err.message : 'No confirmation was received. Check the connected app before requesting this action again.' });
          void api(path, { method: 'DELETE' }).catch(() => {});
        } else if (err.status === 404) append(step.message, { reply: 'This review is no longer pending. No new action was run.' });
        else setError('The action was not approved. Its unused review will expire shortly.');
      }
    } finally {
      request.current = null; reviewRef.current = null;
      if (mounted.current) {
        setConfirming(false); setReview(null);
        requestAnimationFrame(() => composer.current?.focus({ preventScroll: true }));
      }
    }
  }
  const busy = Boolean(pending || review);
  return <section className="panel chat-panel" aria-label={app ? "App chat" : "Model chat"}>
    <header className="chat-toolbar">
      <Glyph icon={Cpu}/><div className="chat-model-label"><p className="eyebrow">{profile.managed ? 'SHARED MODEL' : 'PERSONAL PROFILE'}</p><strong title={profile.model}>{profile.model}</strong></div>
      <Select aria-label="Chat model profile" title="Switching profiles starts a new conversation" disabled={busy} value={profile.id} onChange={(event) => onSelect(event.target.value)}>{profiles.map((item) => <option value={item.id} key={item.id}>{item.name} · {providerCatalog[item.type]?.name || item.type}{item.managed ? ' · Shared' : ''}{item.id !== profile.id ? ` · ${item.model}` : ''}</option>)}</Select>
      <Button icon={Plus} disabled={busy || (!history.length && !draft)} onClick={() => setReset(true)}>New chat</Button>
    </header>

    <div className="chat-scroll" ref={transcript}>
      {!history.length && !pending && !review ? <div className="chat-welcome">
        <div className="chat-welcome-mark"><MessageSquare size={26} strokeWidth={1.5}/><Sparkles size={16} strokeWidth={1.6}/></div>
        <p className="eyebrow">{profile.name}</p>
        <h2>{app ? `What should ${app.name} do?` : 'What are we working on?'}</h2>
        <p>{app ? 'Describe what you want to find or do. You’ll see the exact action before it runs.' : 'Start with a question or try a prompt below.'}</p>
        {!app && <div className="chat-starters">{starters.map(({ icon: Icon, title, description, prompt }) => <button type="button" key={title} onClick={() => prefill(prompt)}><Icon size={17}/><strong>{title}</strong><span>{description}</span><ArrowUpRight size={14}/></button>)}</div>}
      </div> : <div className="chat-thread" role="log" aria-label="Conversation">
        {history.map((message, index) => <Message key={index} {...message} profile={profile}/>)}
        {review && <Message role="user" content={review.message} profile={profile}/>}
        {pending && !review && <><Message role="user" content={pending} profile={profile}/><div className="chat-loading" role="status"><span><i/><i/><i/></span> Waiting for the model…</div></>}
      </div>}
    </div>

    <form className="chat-entry" onSubmit={send}>
      {error && <Banner>{error}</Banner>}
      <div className="chat-composer">
        <textarea ref={composer} aria-label="Message" placeholder={app ? `Ask ${app.name} to…` : 'Message your model…'} rows={2} value={draft} disabled={busy} maxLength={chatLimits.user} onChange={(event) => { setDraft(event.target.value); setError(''); }} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form.requestSubmit(); }
        }}/>
        <div className="chat-send-row"><span>{draft.length >= chatLimits.user - 500 ? `${draft.length.toLocaleString()} / ${chatLimits.user.toLocaleString()}` : 'Shift + Enter for a new line'}</span>{pending ? <Button icon={Square} onClick={() => request.current?.abort()}>Stop</Button> : <Button type="submit" tone="primary" icon={Send} disabled={busy || !draft.trim()}>Send</Button>}</div>
      </div>
      <p className="chat-disclaimer"><LockKeyhole size={13}/> {app ? 'The request is used for Composio tool discovery. Approved results go to this model for a reply.' : 'Recent messages go to this provider.'} {profile.managed ? 'Replies use your shared AI message allowance.' : 'Your personal key does not use shared AI messages.'}</p>
    </form>
    {review && <Modal wide title="Review app action" subtitle={`${review.app} · ${review.account}`} onClose={() => { if (!confirming) void reviewAction(false); }}>
      <div className="composio-review">
        <p><strong>{review.title}</strong>{review.title !== review.tool && <> · <code>{review.tool}</code></>}</p>
        <p>These exact inputs will go to the app. Only approve the action if the destination and details are right.</p>
        <pre aria-label="Action inputs" dir="ltr">{reviewJson(review.arguments)}</pre>
        {expired && !confirming && <Banner tone="warning">This review expired. Cancel and request a new action.</Banner>}
        {confirming && <p role="status">One moment. An already approved action can finish even if you leave this page.</p>}
        <div className="modal-actions"><Button disabled={confirming} onClick={() => reviewAction(false)}>Cancel action</Button><Button icon={Check} tone="primary" busy={confirming} disabled={expired} onClick={() => reviewAction(true)}>Approve and run</Button></div>
      </div>
    </Modal>}
    {reset && <Confirm title="Start a new chat?" message="This removes the current conversation and draft from this tab." label="Start new chat" onClose={() => setReset(false)} onConfirm={() => { setHistory([]); setDraft(''); setError(''); setReset(false); }} danger={false}/>}
  </section>;
}

const chatTools = [
  { id: 'conversation', icon: MessageSquare, name: 'Conversation' },
  { id: 'apps', icon: Plug, name: 'Apps' },
  { id: 'reach', icon: Radar, name: 'Reach' },
  { id: 'finder', icon: FileSpreadsheet, name: 'Finder' },
];

function AppConversation({ user, ready, notice, profile, profiles, onSelect }) {
  const [rows, setRows] = useState([]), [selection, setSelection] = useState('');
  const connections = rows.filter((row) => row.status === 'ACTIVE');
  const app = connections.find((row) => row.id === selection);
  return <div>
    <ConnectedApps user={user} ready={ready} from="chat" notice={notice} onConnections={setRows}/>
    {ready !== false && connections.length > 0 && <>
      <div className="panel composio-chat-pick"><label htmlFor="chat-connected-account">App account for this chat</label><Select id="chat-connected-account" value={app?.id || ''} onChange={(event) => setSelection(event.target.value)}>
        <option value="" disabled>Choose a connected account</option>{connections.map((row) => <option value={row.id} key={row.id}>{row.name} · {appAccountLabel(row)}</option>)}
      </Select></div>
      {app && (profile ? <Conversation key={`${app.id}:${profile.id}:${profile.revision || ''}`} profile={profile} profiles={profiles} onSelect={onSelect} app={app}/> : <section className="panel chat-unconfigured">
        <EmptyState icon={Cpu} title="Choose a model for app chat" action={<ActionLink icon={Plus} tone="primary" href="#/settings/providers">Set up a chat model</ActionLink>}>You can manage apps without a model. Add a chat profile to ask it to use an app.</EmptyState>
      </section>)}
    </>}
  </div>;
}

export default function ChatPage({ workspace, user, active, showApps, composioNotice, onUseSource }) {
  const [selection, setSelection] = useState(''), [tool, setTool] = useState(showApps ? 'apps' : 'conversation'), [prefill, setPrefill] = useState(null);
  const profiles = [...(workspace?.providers || []), ...(workspace?.sharedProviders || [])].filter((profile) => profile.model);
  const profile = profiles.find((item) => item.id === selection) || profiles.find((item) => item.id === workspace?.activeProviderId) || profiles[0];
  const searchEnabled = workspace?.discoveryEnabled !== false;
  useEffect(() => { if (profile && profile.id !== selection) setSelection(profile.id); }, [profile?.id, selection]);
  useEffect(() => { if (showApps) setTool('apps'); }, [showApps, composioNotice]);
  function openFinder(query) { setPrefill({ query }); setTool('finder'); }
  return <div className="view-enter chat-workspace">
    <PageHeading label="WORKSPACE / AI" title="Chat" subtitle="Talk with a model, use your connected apps, or search public sources."><ActionLink icon={Cpu} href="#/settings/providers">Manage providers</ActionLink></PageHeading>
    <div className="chat-tool-strip" role="group" aria-label="Chat tools">
      {chatTools.map(({ id, icon: Icon, name }) => <button key={id} type="button" aria-pressed={tool === id} aria-controls={`chat-tool-${id}`} onClick={() => setTool(id)}><Icon size={16}/>{name}</button>)}
    </div>
    <div id="chat-tool-conversation" hidden={tool !== 'conversation'}>
      {profile ? <Conversation key={`${profile.id}:${profile.revision || ''}`} profile={profile} profiles={profiles} onSelect={setSelection} onFinder={openFinder}/> : <section className="panel chat-unconfigured">
        <EmptyState icon={MessageSquare} title={workspace ? 'Connect a model to start' : 'Loading your AI profiles…'} action={workspace && <ActionLink icon={Plus} tone="primary" href="#/settings/providers">Set up a chat model</ActionLink>}>{workspace ? 'Add an AI provider in Settings to chat. Reach and Finder work without a model.' : 'Your saved chat models will appear here.'}</EmptyState>
      </section>}
      {profile && <p className="privacy-note chat-privacy"><LockKeyhole size={15}/> Conversations stay in this tab until you reload, sign out or switch profiles. Your provider’s data and billing policies still apply.</p>}
    </div>
    <div id="chat-tool-apps" hidden={tool !== 'apps'}>{active && tool === 'apps' && <AppConversation user={user} ready={workspace?.composio?.ready} notice={composioNotice} profile={profile} profiles={profiles} onSelect={setSelection}/>}</div>
    <div id="chat-tool-reach" hidden={tool !== 'reach'}><DiscoveryPane kind="reach" enabled={searchEnabled} profile={profile?.managed ? null : profile} onUseSource={onUseSource}/></div>
    <div id="chat-tool-finder" hidden={tool !== 'finder'}><DiscoveryPane kind="finder" enabled={searchEnabled} profile={profile?.managed ? null : profile} prefill={prefill}/></div>
  </div>;
}
