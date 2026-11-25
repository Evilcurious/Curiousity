import { useEffect, useRef, useState } from 'react';
import { Check, LockKeyhole, Save, Send, Workflow } from 'lucide-react';
import { Field } from './forms.jsx';
import { ActionLink, api, Banner, Button, EmptyState, Modal, PanelHeading } from './ui.jsx';
import './integrations.css';

const exactInput = (input) => JSON.stringify(input, null, 2).replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

export function WorkflowChat({ workflow, admin }) {
  const [message, setMessage] = useState(''), [review, setReview] = useState(null), [result, setResult] = useState(null);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [expired, setExpired] = useState(false);
  const operation = useRef(null);
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    if (!review) return;
    setExpired(false);
    const timer = setTimeout(() => setExpired(true), Math.max(0, review.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [review]);
  async function request(path, options, state, update, fail) {
    if (operation.current) return;
    const ctrl = new AbortController(); operation.current = ctrl; setBusy(state); setError('');
    try { const data = await api(path, { ...options, signal: ctrl.signal }); if (!ctrl.signal.aborted) update(data); }
    catch (err) { if (!ctrl.signal.aborted) { setError(err.message); fail?.(); } }
    finally { operation.current = null; if (!ctrl.signal.aborted) setBusy(''); }
  }
  function send(event) {
    event.preventDefault();
    if (!message.trim() || review) return;
    void request('/chat/workflows', { method: 'POST', body: { message } }, 'review', ({ review: next }) => { setResult(null); setReview(next); });
  }
  function resolve(approved) {
    if (!review || (approved && expired)) return;
    void request(`/chat/workflows/${review.id}`, approved ? { method: 'POST', body: { approved: true } } : { method: 'DELETE' }, approved ? 'run' : 'cancel', (data) => {
      setReview(null);
      if (approved) { setMessage(''); setResult({ ...data, name: review.name }); }
    }, () => setReview(null));
  }
  if (!workflow?.enabled) return <section className="panel chat-unconfigured"><EmptyState icon={Workflow} title="No n8n workflow enabled" action={admin && <ActionLink href="#/settings/admin" tone="primary">Configure n8n</ActionLink>}>An administrator can publish a workflow in n8n and connect its production webhook here. You’ll review each request before it runs.</EmptyState></section>;
  return <section className="panel service-panel workflow-panel">
    <PanelHeading icon={Workflow} title={workflow.name} description="Send a message to the administrator’s n8n workflow. No AI provider is required."/>
    <form className="modal-form integration-form" onSubmit={send}>
      <Field label="Workflow message"><textarea rows={4} required maxLength={6000} value={message} onChange={(event) => setMessage(event.target.value)} disabled={Boolean(busy || review)} placeholder="What should this workflow process?"/></Field>
      {error && <Banner>{error}</Banner>}
      <div className="integration-actions"><Button type="submit" icon={Send} tone="primary" busy={busy === 'review'} disabled={!message.trim() || Boolean(review)}>Review workflow request</Button></div>
    </form>
    {result && <div className="workflow-result" role="status"><strong>{result.name} responded</strong><pre dir="auto">{result.reply}</pre>{result.truncated && <small>Response shortened for display.</small>}</div>}
    <p className="privacy-note"><LockKeyhole size={15}/> Approved messages, your workspace member ID, and a request ID are sent to n8n. The workflow may use other connected services.</p>
    {review && <Modal title="Review workflow request" subtitle={review.name} onClose={() => { if (!busy) resolve(false); }}>
      <div className="workflow-result"><p>These exact inputs go to the workflow, which may make changes in connected apps.</p><pre dir="ltr" aria-label="Workflow inputs">{exactInput(review.input)}</pre>
        {busy === 'run' && <p role="status">Waiting for n8n. An approved workflow may finish even if you leave this page.</p>}
        {expired && !busy && <Banner tone="warning">This review expired. Cancel it and request a new one.</Banner>}
        <div className="modal-actions"><Button disabled={Boolean(busy)} onClick={() => resolve(false)}>Cancel</Button><Button icon={Check} tone="primary" busy={busy === 'run'} disabled={expired || Boolean(busy)} onClick={() => resolve(true)}>Approve and run</Button></div>
      </div>
    </Modal>}
  </section>;
}

export function N8nAdmin({ refresh, notify }) {
  const [fields, setFields] = useState(null), [token, setToken] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const ctrl = new AbortController();
    api('/admin/n8n', { signal: ctrl.signal }).then(setFields).catch((err) => { if (!ctrl.signal.aborted) setError(err.message); });
    return () => ctrl.abort();
  }, []);
  function change(key, value) { setFields((prior) => ({ ...prior, [key]: value })); }
  async function save(body, notice) {
    setBusy(true); setError('');
    try { setFields(await api('/admin/n8n', { method: 'PUT', body })); setToken(''); await refresh(); notify(notice); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="panel service-panel integration-panel">
    <PanelHeading icon={Workflow} title="n8n workflow" description="Make one approved workflow available to members in Chat."/>
    {error && <Banner>{error}</Banner>}
    <div className="integration-grid">
      {fields && <form className="modal-form integration-form" onSubmit={(event) => { event.preventDefault(); void save({ ...fields, token }, 'n8n workflow saved.'); }}>
        <Field label="Workflow name"><input required maxLength={90} value={fields.name} onChange={(event) => change('name', event.target.value)}/></Field>
        <Field label="Production webhook URL"><input type="url" required maxLength={800} value={fields.url} onChange={(event) => change('url', event.target.value)} placeholder="https://n8n.example.com/webhook/…"/></Field>
        <Field label="Header Auth secret"><input type="password" autoComplete="new-password" value={token} maxLength={512} onChange={(event) => setToken(event.target.value)} placeholder={fields.hasToken ? 'Saved · leave blank to keep' : 'At least 16 characters'}/></Field>
        <label className="consent"><input type="checkbox" checked={fields.enabled} onChange={(event) => change('enabled', event.target.checked)}/><span>Enable for members in Chat</span></label>
        <div className="integration-actions"><Button type="submit" icon={Save} tone="primary" busy={busy}>Save workflow</Button>{fields.hasToken && <Button disabled={busy} onClick={() => save({ remove: true }, 'n8n workflow removed.')}>Remove workflow</Button>}</div>
      </form>}
      <div className="integration-guide"><strong>Set up the n8n Webhook node</strong><ol><li>Set the method to POST and authentication to Header Auth.</li><li>Use <code>X-Curiousity-Token</code> as the header name. Set the same secret here and in n8n.</li><li>Publish the workflow and paste the HTTPS Production URL, not the Test URL.</li><li>Validate the member ID and message in n8n. Return JSON with a <code>reply</code> string to show a result in Chat.</li></ol><p>Only expose a workflow that all workspace members may run after review. Don’t use a webhook that grants unrestricted access to a shared credential.</p></div>
    </div>
  </section>;
}
