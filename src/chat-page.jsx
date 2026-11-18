import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Captions, Cpu, FileText, LockKeyhole, MessageSquare, Plus, Send, Sparkles, Square, UserRound } from 'lucide-react';
import { chatContext, chatLimits } from '../shared/chat.mjs';
import { providerCatalog } from '../shared/providers.mjs';
import { ActionLink, api, Banner, Button, Confirm, EmptyState, Glyph, PageHeading } from './ui.jsx';
import { Select } from './forms.jsx';
import './media-workspaces.css';

const starters = [
  { icon: Sparkles, title: 'Brainstorm hooks', description: 'Get opening lines for your next video.', prompt: 'Help me brainstorm five short opening hooks for a video about ' },
  { icon: FileText, title: 'Summarize a transcript', description: 'Turn a passage into a clear outline.', prompt: 'Summarize the main points in this transcript. Keep the summary factual:\n\n' },
  { icon: Captions, title: 'Polish captions', description: 'Tighten wording for easy reading.', prompt: 'Make these captions easier to read without changing their meaning:\n\n' },
];

function Message({ role, content, profile, truncated }) {
  const mine = role === 'user';
  return <article className={`chat-message ${mine ? 'chat-mine' : 'chat-theirs'}`}>
    <span className="chat-avatar" aria-hidden="true">{mine ? <UserRound size={15}/> : <Sparkles size={16}/>}</span>
    <div className="chat-message-body"><h3>{mine ? 'You' : profile.name}</h3><p dir="auto">{content}</p>{truncated && <span className="chat-truncated">Reply shortened for this workspace.</span>}</div>
  </article>;
}

function Conversation({ profile, profiles, onSelect }) {
  const [history, setHistory] = useState([]), [draft, setDraft] = useState(''), [pending, setPending] = useState(null), [error, setError] = useState(''), [reset, setReset] = useState(false);
  const request = useRef(null), composer = useRef(null), transcript = useRef(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [history, pending, error]);
  function prefill(prompt) { setDraft(prompt); setError(''); requestAnimationFrame(() => composer.current?.focus()); }
  async function send(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || request.current) return;
    const ctrl = new AbortController();
    request.current = ctrl;
    setDraft(''); setPending(content); setError('');
    try {
      const { reply, truncated } = await api('/chat', { method: 'POST', signal: ctrl.signal,
        body: { providerId: profile.id, revision: profile.revision || profile.id, messages: chatContext(history, content) } });
      if (!ctrl.signal.aborted) setHistory((previous) => [...previous, { role: 'user', content }, { role: 'assistant', content: reply, truncated }]);
    } catch (err) {
      if (!mounted.current) return;
      setDraft(content);
      if (!ctrl.signal.aborted) setError(err.message);
    } finally {
      request.current = null;
      if (mounted.current) { setPending(null); requestAnimationFrame(() => composer.current?.focus({ preventScroll: true })); }
    }
  }
  const busy = Boolean(pending);
  return <section className="panel chat-panel" aria-label="Model chat">
    <header className="chat-toolbar">
      <Glyph icon={Cpu}/><div className="chat-model-label"><p className="eyebrow">PERSONAL PROFILE</p><strong title={profile.model}>{profile.model}</strong></div>
      <Select aria-label="Chat model profile" title="Switching profiles starts a new conversation" disabled={busy} value={profile.id} onChange={(event) => onSelect(event.target.value)}>{profiles.map((item) => <option value={item.id} key={item.id}>{item.name} · {providerCatalog[item.type]?.name || item.type}{item.id !== profile.id ? ` · ${item.model}` : ''}</option>)}</Select>
      <Button icon={Plus} disabled={busy || (!history.length && !draft)} onClick={() => setReset(true)}>New chat</Button>
    </header>

    <div className="chat-scroll" ref={transcript}>
      {!history.length && !pending ? <div className="chat-welcome">
        <div className="chat-welcome-mark"><MessageSquare size={26} strokeWidth={1.5}/><Sparkles size={16} strokeWidth={1.6}/></div>
        <p className="eyebrow">{profile.name}</p>
        <h2>What are we working on?</h2>
        <p>Start with a question or try a prompt below.</p>
        <div className="chat-starters">{starters.map(({ icon: Icon, title, description, prompt }) => <button type="button" key={title} onClick={() => prefill(prompt)}><Icon size={17}/><strong>{title}</strong><span>{description}</span><ArrowUpRight size={14}/></button>)}</div>
      </div> : <div className="chat-thread" role="log" aria-label="Conversation">
        {history.map((message, index) => <Message key={index} {...message} profile={profile}/>)}
        {pending && <><Message role="user" content={pending} profile={profile}/><div className="chat-loading" role="status"><span><i/><i/><i/></span> Waiting for the model…</div></>}
      </div>}
    </div>

    <form className="chat-entry" onSubmit={send}>
      {error && <Banner>{error}</Banner>}
      <div className="chat-composer">
        <textarea ref={composer} aria-label="Message" placeholder="Message your model…" rows={2} value={draft} disabled={busy} maxLength={chatLimits.user} onChange={(event) => { setDraft(event.target.value); setError(''); }} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form.requestSubmit(); }
        }}/>
        <div className="chat-send-row"><span>{draft.length >= chatLimits.user - 500 ? `${draft.length.toLocaleString()} / ${chatLimits.user.toLocaleString()}` : 'Shift + Enter for a new line'}</span>{busy ? <Button icon={Square} onClick={() => request.current?.abort()}>Stop</Button> : <Button type="submit" tone="primary" icon={Send} disabled={!draft.trim()}>Send</Button>}</div>
      </div>
      <p className="chat-disclaimer"><LockKeyhole size={13}/> Recent messages go to this provider. Chat has no access to MCP tools or your projects.</p>
    </form>
    {reset && <Confirm title="Start a new chat?" message="This removes the current conversation and draft from this tab." label="Start new chat" onClose={() => setReset(false)} onConfirm={() => { setHistory([]); setDraft(''); setError(''); setReset(false); }} danger={false}/>}
  </section>;
}

export default function ChatPage({ workspace }) {
  const [selection, setSelection] = useState('');
  const profiles = (workspace?.providers || []).filter((profile) => profile.model);
  const profile = profiles.find((item) => item.id === selection) || profiles.find((item) => item.id === workspace?.activeProviderId) || profiles[0];
  useEffect(() => { if (profile && profile.id !== selection) setSelection(profile.id); }, [profile?.id, selection]);
  return <div className="view-enter chat-workspace">
    <PageHeading label="WORKSPACE / PERSONAL AI" title="Chat" subtitle="Start a conversation with one of your own saved models. No Premium access needed."><ActionLink icon={Cpu} href="#/settings/providers">Manage providers</ActionLink></PageHeading>
    {profile ? <Conversation key={`${profile.id}:${profile.revision || ''}`} profile={profile} profiles={profiles} onSelect={setSelection}/> : <section className="panel chat-unconfigured">
      <EmptyState icon={MessageSquare} title={workspace ? 'Connect a model to start' : 'Loading your AI profiles…'} action={workspace && <ActionLink icon={Plus} tone="primary" href="#/settings/providers">Set up a chat model</ActionLink>}>{workspace ? 'Add an AI provider in Settings and choose a chat model ID. Your API key stays on the server.' : 'Your saved chat models will appear here.'}</EmptyState>
    </section>}
    {profile && <p className="privacy-note chat-privacy"><LockKeyhole size={15}/> Conversations stay in this tab until you reload, sign out or switch profiles. Your provider’s data and billing policies still apply.</p>}
  </div>;
}
