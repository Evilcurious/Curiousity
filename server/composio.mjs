import { randomUUID } from 'node:crypto';
import { boundedText, guardedFetch } from './outbound.mjs';
import { HttpError } from './validation.mjs';

const base = 'https://backend.composio.dev/api/v3.1';
const callbackPath = '/api/composio/callback';
const linkOrigins = new Set(['https://connect.composio.dev', 'https://app.composio.dev']);
const linkLifetime = 20 * 60_000;
const maxConnections = 24;
const slugPattern = /^[a-z][a-z0-9_]{0,79}$/;
const resourceId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(id);
const string = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
export const isObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export const redact = (value, secrets) => secrets.reduce((safe, key) => key ? safe.replaceAll(key, '[redacted]') : safe, value);
const safeLabel = (value, limit, key) => string(redact(typeof value === 'string' ? value : '', [key]).replace(/[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu, ' '), limit);
const invalidResponse = () => new HttpError(502, 'Composio returned an unexpected response. Try again or ask the administrator to check the project.');

export function connectUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { /* Reject malformed redirects. */ }
  if (!url || !linkOrigins.has(url.origin) || url.username || url.password || url.hash || url.search || !/^\/link\/[A-Za-z0-9_-]{6,512}\/?$/.test(url.pathname)) throw invalidResponse();
  return url.href;
}

async function request(key, path, { body, query, method = body === undefined ? 'GET' : 'POST', signal, timeout = 15_000, missing = false } = {}) {
  const url = `${base}${path}${query ? `?${new URLSearchParams(query)}` : ''}`;
  const deadline = AbortSignal.timeout(timeout);
  let res;
  try {
    res = await guardedFetch(url, {
      method, signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      headers: { 'x-api-key': key, Accept: 'application/json', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }, { allowQuery: true });
    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      if (missing && res.status === 404) return null;
      if ([401, 403].includes(res.status)) throw new HttpError(502, 'Composio did not accept the project credentials or permissions. Ask the administrator to check the Platform project.');
      if (res.status === 429) throw new HttpError(429, 'Composio is rate limiting this project. Please wait and try again.');
      throw new HttpError(502, `Composio returned HTTP ${res.status}. Check the connection and the project’s settings in Composio.`);
    }
    const result = JSON.parse(await boundedText(res, 2 * 1024 * 1024));
    if (!isObject(result)) throw invalidResponse();
    return result;
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof HttpError) throw error;
    if (res && !deadline.aborted) throw invalidResponse();
    throw new HttpError(502, deadline.aborted ? 'Composio took too long to respond.' : 'Could not reach Composio from this server.');
  }
}

// Use only native API toolkits with hosted OAuth. The identity verifier runs for
// OAuth callbacks; we do not accept API-key-only, instant or arbitrary MCP apps.
function catalogEntry(row, key) {
  const slug = row?.slug;
  if (typeof slug !== 'string' || !slugPattern.test(slug) || row.type !== 'native' || row.toolkit_type !== 'api' || row.deprecated?.is_deprecated === true || row.no_auth === true ||
      !Array.isArray(row.composio_managed_auth_schemes) || !row.composio_managed_auth_schemes.some((scheme) => typeof scheme === 'string' && /^oauth[12]$/i.test(scheme))) return null;
  return { slug, name: safeLabel(row.name, 80, key) || slug, description: safeLabel(row.meta?.description, 220, key) };
}

const sessionPath = (id) => `/tool_router/session/${id}`;
async function openSession(ctx, toolkit, { signal, connection, tool } = {}) {
  const { session_id: id } = await request(ctx.key, '/tool_router/session', { signal, body: {
    user_id: ctx.userId, toolkits: { enable: [toolkit] }, instant: false,
    manage_connections: { enable: false }, proxy_execute: { enable: false }, workbench: { enable: false },
    execute: { enable_multi_execute: false }, multi_account: { enable: !connection },
    ...(connection && { connected_accounts: { [toolkit]: [connection.id] } }),
    ...(tool && { tools: { [toolkit]: { enable: [tool] } }, search: { enable: false } }),
  } });
  if (!resourceId(id)) throw invalidResponse();
  return id;
}
const closeSession = (ctx, id) => request(ctx.key, sessionPath(id), { method: 'DELETE', timeout: 2500, missing: true }).catch(() => {});
async function withSession(ctx, connection, settings, fn) {
  const id = await openSession(ctx, connection.slug, { ...settings, connection });
  try { return await fn(sessionPath(id)); }
  finally { void closeSession(ctx, id); }
}

export function createComposio(store, { publicOrigin = '', envKey = process.env.COMPOSIO_API_KEY?.trim() || '' } = {}) {
  const links = new Map();
  const disconnecting = new Set();
  let configuring = false;
  const savedConfig = () => store.state.composio;
  const callbackUrl = publicOrigin ? `${publicOrigin}${callbackPath}` : null;
  function status() {
    const configured = Boolean(envKey || savedConfig()?.sealedKey), enabled = savedConfig()?.enabled === true;
    return { configured, enabled, ready: Boolean(configured && enabled && callbackUrl) };
  }
  const adminStatus = () => ({ ...status(), callbackUrl, keySource: envKey ? 'environment' : 'workspace' });
  const unavailable = () => new HttpError(409, 'Composio apps are not enabled for this workspace. Ask an administrator to check Settings → Admin.');
  const stateChanged = () => new HttpError(409, 'The Composio configuration changed. Refresh and try again.');
  function context(account) {
    if (!status().ready) throw unavailable();
    const current = savedConfig();
    let key;
    try { key = envKey || store.unseal(current.sealedKey); } catch { throw unavailable(); }
    if (!key || !current.namespace) throw unavailable();
    return { key, current, userId: `curiousity_${current.namespace}_${account.id}` };
  }
  function checkContext(ctx, ensure) {
    ensure();
    if (ctx.current !== savedConfig() || !status().ready) throw stateChanged();
  }
  async function configure(input, ensure) {
    if (configuring) throw new HttpError(409, 'Composio settings are already being updated.');
    if (!isObject(input) || typeof input.enabled !== 'boolean') throw new HttpError(400, 'Choose whether to enable Composio.');
    if (envKey && input.apiKey !== undefined) throw new HttpError(400, 'This project key is managed by COMPOSIO_API_KEY on the server.');
    const prior = savedConfig();
    let key = envKey;
    if (input.apiKey === undefined) { if (!key) key = store.unseal(prior?.sealedKey); }
    else if (input.apiKey !== null) {
      key = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
      if (!/^[!-~]{12,512}$/.test(key) || key.startsWith('ck_')) throw new HttpError(400, 'Enter a Composio Platform project API key, not a For You key.');
    }
    if (input.enabled && (!key || !callbackUrl)) throw new HttpError(400, 'Enabling Composio requires a Platform project key and PUBLIC_ORIGIN set to your public HTTPS site.');
    const namespace = prior?.namespace || randomUUID();
    configuring = true;
    try {
      if (key && (input.enabled || input.apiKey !== undefined)) {
        const result = await request(key, '/connected_accounts', { query: { limit: 1, user_ids: `curiousity_${namespace}_setup` } });
        if (!Array.isArray(result.items)) throw invalidResponse();
      }
      ensure();
      store.state.composio = { enabled: input.enabled, namespace, sealedKey: input.apiKey === undefined ? prior?.sealedKey || '' : store.seal(key) };
      store.save();
      return adminStatus();
    } finally { configuring = false; }
  }

  const records = (account) => account.workspace.composioConnections;
  const requireRecord = (account, id) => {
    const record = records(account).find((row) => row.id === id);
    if (!record) throw new HttpError(404, 'This connected app could not be found.');
    return record;
  };
  // Both our verified record and a fresh user-scoped upstream lookup are
  // required. Composio is deprecating user_id on the wire, not the filter.
  async function remoteAccounts(ctx, ids, signal) {
    if (!ids.length) return [];
    const { items } = await request(ctx.key, '/connected_accounts', { signal, query: {
      user_ids: ctx.userId, connected_account_ids: ids.join(','), limit: maxConnections,
    } });
    if (!Array.isArray(items)) throw invalidResponse();
    const owned = new Set(ids);
    return items.filter((row) => owned.has(row?.id) && (!row.user_id || row.user_id === ctx.userId) && row.experimental?.account_type !== 'SHARED');
  }
  function connectionView(record, row, key) {
    const state = row?.is_disabled ? 'DISABLED' : row?.status || 'UNAVAILABLE';
    const status = ['ACTIVE', 'DISABLED', 'EXPIRED', 'INACTIVE', 'REVOKED', 'FAILED'].includes(state) ? state : 'UNAVAILABLE';
    return { ...record, alias: safeLabel(record.alias, 80, key) || safeLabel(row?.alias, 80, key), status };
  }
  async function connections(account, ensure) {
    const flags = status();
    if (!flags.ready) return { ...flags, connections: [] };
    const ctx = context(account);
    const rows = await remoteAccounts(ctx, records(account).map(({ id }) => id));
    checkContext(ctx, ensure);
    return { ...flags, connections: records(account).map((record) => connectionView(record, rows.find((row) => row.id === record.id && row.toolkit?.slug === record.slug), ctx.key)) };
  }
  async function catalog(ctx, { search, cursor, limit = 24 } = {}) {
    const result = await request(ctx.key, '/toolkits', { query: { type: 'native', sort_by: 'usage', include_deprecated: false, limit, ...(search && { search }), ...(cursor && { cursor }) } });
    if (!Array.isArray(result.items)) throw invalidResponse();
    return { apps: result.items.map((row) => catalogEntry(row, ctx.key)).filter(Boolean), next: typeof result.next_cursor === 'string' && result.next_cursor.length <= 512 ? result.next_cursor : null };
  }
  async function apps(account, query, ensure) {
    const ctx = context(account);
    if (query.cursor !== undefined && (typeof query.cursor !== 'string' || query.cursor.length > 512)) throw new HttpError(400, 'Invalid app catalog page.');
    const result = await catalog(ctx, { search: string(query.q, 80), cursor: query.cursor });
    checkContext(ctx, ensure);
    return result;
  }

  function expireLinks() {
    for (const [owner, link] of links) {
      if (link.expiresAt > Date.now() && link.ctx.current === savedConfig()) continue;
      links.delete(owner);
      if (link.id) void closeSession(link.ctx, link.id);
    }
  }
  const interval = setInterval(expireLinks, 60_000).unref();
  async function begin(account, sessionKey, input, ensure) {
    const ctx = context(account);
    const slug = input?.slug, alias = safeLabel(input?.alias, 80, ctx.key);
    if (typeof slug !== 'string' || !slugPattern.test(slug)) throw new HttpError(400, 'Choose an app from the Composio catalog.');
    if (records(account).length >= maxConnections) throw new HttpError(409, 'Disconnect a saved app before adding another.');
    expireLinks();
    const prior = links.get(account.id);
    if (prior?.starting || links.size >= 256 && !prior) throw new HttpError(429, 'A connection is already starting. Wait a moment and try again.');
    if (prior?.id) void closeSession(prior.ctx, prior.id);
    const link = { ctx, sessionKey, expiresAt: Date.now() + linkLifetime, from: input?.from === 'chat' ? 'chat' : 'integrations', alias, starting: true };
    links.set(account.id, link);
    try {
      const { apps } = await catalog(ctx, { search: slug, limit: 50 });
      const app = apps.find((row) => row.slug === slug);
      if (!app) throw new HttpError(404, 'This app is not available for hosted OAuth in this workspace. Choose another app.');
      checkContext(ctx, ensure);
      link.id = await openSession(ctx, slug);
      checkContext(ctx, ensure);
      const result = await request(ctx.key, `${sessionPath(link.id)}/link`, { body: { toolkit: slug, callback_url: callbackUrl, ...(alias && { alias }) } });
      const { connected_account_id: accountId } = result;
      const url = connectUrl(result.redirect_url);
      if (!resourceId(accountId) || url.includes(ctx.key)) throw invalidResponse();
      checkContext(ctx, ensure);
      Object.assign(link, { accountId, app, starting: false });
      return { url };
    } catch (error) {
      if (links.get(account.id) === link) links.delete(account.id);
      if (link.id) void closeSession(ctx, link.id);
      throw error;
    }
  }
  async function complete(account, sessionKey, query, ensure) {
    expireLinks();
    const link = links.get(account.id);
    if (!link || link.sessionKey !== sessionKey || link.starting) return { from: 'integrations', result: 'restart' };
    const uri = query.session_uri;
    if (typeof uri !== 'string' || !uri || uri.length > 4096 || /[\u0000-\u001f\u007f]/.test(uri)) {
      return { from: link.from, result: query.status === 'failed' ? 'failed' : 'verifier' };
    }
    links.delete(account.id); // Consume before the first await, even on replay or mismatch.
    const { ctx, app, from, accountId, alias } = link;
    try {
      checkContext(ctx, ensure);
      const result = await request(ctx.key, '/connected_accounts/complete_auth', { body: { session_uri: uri, user_id: ctx.userId } });
      if (result.connected_account_id !== accountId || result.toolkit_slug !== app.slug) return { from, result: 'failed' };
      const [row] = await remoteAccounts(ctx, [accountId]);
      checkContext(ctx, ensure);
      if (row?.status !== 'ACTIVE' || row.is_disabled || row.toolkit?.slug !== app.slug) return { from, result: 'failed' };
      if (!records(account).some((row) => row.id === accountId)) {
        if (records(account).length >= maxConnections) return { from, result: 'failed' };
        records(account).push({ id: accountId, slug: app.slug, name: app.name, alias, createdAt: new Date().toISOString() });
        store.save();
      }
      return { from, result: 'connected' };
    } catch { return { from, result: 'failed' }; }
    finally { void closeSession(ctx, link.id); }
  }
  async function disconnect(account, id, ensure) {
    const record = requireRecord(account, id), ctx = context(account);
    if (disconnecting.has(id)) throw new HttpError(409, 'This app is already being disconnected.');
    disconnecting.add(id);
    try {
      const [row] = await remoteAccounts(ctx, [id]);
      checkContext(ctx, ensure);
      if (row?.toolkit?.slug === record.slug) {
        const result = await request(ctx.key, `/connected_accounts/${id}`, { method: 'DELETE', query: { revoke_on_delete: true }, missing: true });
        if (result && result.success !== true) throw invalidResponse();
      }
      // The upstream operation already happened; keep the verified list current
      // even if this browser signed out while the delete was in flight.
      account.workspace.composioConnections = records(account).filter((item) => item !== record);
      store.save();
    } finally { disconnecting.delete(id); }
  }
  function checkConnection(account, connection, ctx, ensure) {
    checkContext(ctx, ensure);
    if (disconnecting.has(connection.id) || !records(account).includes(connection)) throw new HttpError(409, 'This connected app is no longer available. Refresh Connected apps.');
  }
  async function active(account, id, ctx, ensure, signal) {
    const record = requireRecord(account, id);
    const [row] = await remoteAccounts(ctx, [id], signal);
    checkConnection(account, record, ctx, ensure);
    if (row?.status !== 'ACTIVE' || row.is_disabled || row.toolkit?.slug !== record.slug) throw new HttpError(409, 'That app needs to be connected again. Open Connected apps to manage it.');
    return record;
  }
  async function search(ctx, connection, useCase, signal) {
    return withSession(ctx, connection, { signal }, (path) => request(ctx.key, `${path}/search`, { signal, body: { queries: [{ use_case: useCase }] } }));
  }
  const toolDetails = (ctx, slug, signal) => request(ctx.key, `/tools/${slug}`, { signal, timeout: 7500, missing: true });
  async function listTools(ctx, connection, query, signal) {
    const limit = 16;
    const { items } = await request(ctx.key, '/tools', { signal, timeout: 6500, query: {
      toolkit_slug: connection.slug, include_deprecated: false, limit, ...(query && { query }),
    } });
    if (!Array.isArray(items)) throw invalidResponse();
    return items.slice(0, limit);
  }
  async function execute(account, ctx, connection, tool, args, ensure, signal) {
    return withSession(ctx, connection, { tool, signal }, (path) => {
      signal.throwIfAborted();
      checkConnection(account, connection, ctx, ensure);
      return request(ctx.key, `${path}/execute`, { signal, timeout: 32_000, body: {
        tool_slug: tool, account: connection.id, arguments: args, enable_auto_workbench_offload: false,
      } });
    });
  }
  function stop() {
    clearInterval(interval);
    for (const link of links.values()) if (link.id) void closeSession(link.ctx, link.id);
    links.clear();
  }
  return { status, adminStatus, configure, context, checkConnection, connections, apps, begin, complete, disconnect, active, search, toolDetails, listTools, execute, stop };
}
