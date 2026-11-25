import { randomUUID } from 'node:crypto';
import { boundedText, externalUrl, guardedFetch } from './outbound.mjs';
import { HttpError, text } from './validation.mjs';

const reviewMs = 5 * 60_000;
const tokenName = 'X-Curiousity-Token';
export const workflowMessageLimit = 6000;

export function createN8n(store) {
  const pending = new Map();
  const config = () => store.state.n8n;
  const status = () => ({ enabled: Boolean(config()?.enabled && config()?.url && config()?.token), name: config()?.name || 'n8n workflow' });
  const adminStatus = () => ({ ...status(), url: config()?.url || '', hasToken: Boolean(config()?.token) });
  function configure(body) {
    if (body?.remove === true) {
      delete store.state.n8n;
      pending.clear(); store.save();
      return adminStatus();
    }
    if (typeof body?.enabled !== 'boolean') throw new HttpError(400, 'Choose whether to enable the n8n workflow.');
    const url = externalUrl(text(body.url, 800));
    if (!/(?:^|\/)webhook\/[^/]/.test(url.pathname) || /(?:^|\/)webhook-test\//.test(url.pathname)) throw new HttpError(400, 'Use the published n8n Production URL from a Webhook node, not its Test URL.');
    const name = text(body.name, 90).replace(/[\p{C}]/gu, ' ').trim();
    if (!name) throw new HttpError(400, 'Name the workflow so members can identify it before approval.');
    const supplied = typeof body.token === 'string' ? body.token.trim() : '';
    if (supplied && !/^[\x21-\x7e]{16,512}$/.test(supplied)) throw new HttpError(400, `Use a ${tokenName} secret of 16–512 characters without spaces.`);
    const token = supplied ? store.seal(supplied) : config()?.url === url.href ? config()?.token : '';
    if (!token) throw new HttpError(400, `Enter the Header Auth secret for ${tokenName}.`);
    store.state.n8n = { name, url: url.href, token, enabled: body.enabled };
    pending.clear(); store.save();
    return adminStatus();
  }
  function prune() {
    for (const [id, entry] of pending) if (entry.expiresAt <= Date.now() || entry.config !== config()) pending.delete(id);
  }
  const timer = setInterval(prune, 60_000).unref();
  function review(account, session, message) {
    if (!status().enabled) throw new HttpError(409, 'Ask the administrator to enable an n8n workflow in Settings → Admin.');
    if (typeof message !== 'string' || !message.trim() || message.length > workflowMessageLimit) throw new HttpError(400, `Enter a workflow message up to ${workflowMessageLimit.toLocaleString()} characters.`);
    prune();
    if (pending.size >= 256 && !pending.has(account.id)) throw new HttpError(429, 'Too many pending workflow reviews. Try again in a moment.');
    const id = randomUUID(), expiresAt = Date.now() + reviewMs, state = config();
    const input = { message: message.trim(), memberId: account.id, requestId: id };
    pending.set(account.id, { id, expiresAt, session, config: state, input });
    return { id, expiresAt, name: state.name, input };
  }
  function take(account, session, id) {
    prune();
    const entry = pending.get(account.id);
    if (!entry || entry.id !== id || entry.session !== session) throw new HttpError(404, 'This workflow review expired or is no longer pending. No workflow was started.');
    pending.delete(account.id);
    return entry;
  }
  function cancel(account, session, id) { take(account, session, id); }
  async function run(account, session, id, ensure, signal) {
    const entry = take(account, session, id);
    ensure();
    signal.throwIfAborted();
    const secret = store.unseal(entry.config.token);
    const uncertain = 'n8n did not confirm a result. Check the workflow’s executions before running it again.';
    let response, output;
    try {
      response = await guardedFetch(entry.config.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain', [tokenName]: secret },
        body: JSON.stringify(entry.input), signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]) });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if ([401, 403, 404].includes(response.status)) throw new HttpError(502, `n8n returned HTTP ${response.status}. Ask the administrator to verify Header Auth and that the workflow is published.`);
        throw new HttpError(502, uncertain);
      }
      output = await boundedText(response, 128 * 1024);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof HttpError && !response?.ok) throw error;
      throw new HttpError(502, uncertain);
    }
    const mime = response.headers.get('content-type') || '';
    if (/^application\/json\b/i.test(mime)) {
      // Only the workflow's intentional reply is displayed, not execution
      // metadata, arbitrary node output, or credential fields.
      try { const value = JSON.parse(output); output = typeof value?.reply === 'string' ? value.reply : ''; } catch { output = ''; }
    } else if (!/^text\/plain\b/i.test(mime)) output = '';
    for (const value of [secret, entry.config.url]) if (value) output = output.replaceAll(value, '[redacted]');
    output = output.trim();
    return { reply: output.slice(0, 6000).replace(/[\uD800-\uDBFF]$/, '') || 'n8n accepted the request. No response content was returned.', truncated: output.length > 6000 };
  }
  return { status, adminStatus, configure, review, run, cancel, stop: () => clearInterval(timer) };
}
