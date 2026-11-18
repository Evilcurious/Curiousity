import { randomUUID } from 'node:crypto';
import { boundedText, externalUrl, guardedFetch } from './outbound.mjs';
import { HttpError, text } from './validation.mjs';

export const bufferEndpoint = 'https://mcp.buffer.com/mcp';
const versions = new Set(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);
const readableBuffer = new Set(['get_account', 'list_channels', 'get_channel', 'list_posts', 'get_post', 'get_aggregated_post_metrics', 'list_ideas', 'list_idea_groups', 'list_post_templates', 'get_post_template']);
const plainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
export const simpleToolName = (name) => typeof name === 'string' && /^[\w.-]{1,128}$/.test(name);

export function mcpInput(body, existing, store) {
  let kind = body.kind;
  if (!['buffer', 'remote'].includes(kind)) throw new HttpError(400, 'Choose Buffer or a remote MCP server.');
  const remote = kind === 'buffer' ? new URL(bufferEndpoint) : externalUrl(text(body.url, 600), { allowPort: true });
  if (remote.hostname.replace(/\.$/, '') === 'mcp.buffer.com') {
    if (remote.href !== bufferEndpoint) throw new HttpError(400, 'Use the official Buffer MCP endpoint.');
    kind = 'buffer';
  }
  const name = text(body.name, 64) || (kind === 'buffer' ? 'Buffer' : remote.host.slice(0, 64));
  const given = text(body.token, 4000).replace(/^Bearer +/i, '');
  if (given && !/^[A-Za-z0-9._~+/-]+=*$/.test(given)) throw new HttpError(400, 'Enter just the bearer token (without “Bearer ” or whitespace).');
  const secret = body.clearToken === true ? '' : given ? store.seal(given) : existing?.url === remote.href && existing.kind === kind ? existing.secret : '';
  if (kind === 'buffer' && !secret) throw new HttpError(400, 'Enter your Buffer API key from Buffer → Settings → API.');
  return { id: existing?.id || randomUUID(), kind, name, url: remote.href, secret, checkedAt: existing?.secret === secret && existing?.url === remote.href ? existing.checkedAt : null };
}
export const publicMcp = ({ id, kind, name, url, secret, checkedAt }) => ({ id, kind, name, url, hasToken: Boolean(secret), checkedAt: checkedAt || null });

async function streamReply(response, id) {
  if (!response.body) throw new HttpError(502, 'The MCP server did not return a result.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let chunks = '', bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) { bytes += value.byteLength; chunks += decoder.decode(value, { stream: true }); }
      if (bytes > 768 * 1024) throw new HttpError(502, 'The MCP response was too large.');
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(chunks))) {
        const event = chunks.slice(0, boundary.index);
        chunks = chunks.slice(boundary.index + boundary[0].length);
        const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        let message;
        try { message = JSON.parse(data); } catch { continue; }
        if (message?.id === id && !message.method) return message;
      }
      if (done) break;
    }
  } finally { reader.cancel().catch(() => {}); }
  throw new HttpError(502, 'The MCP stream ended without a matching result.');
}

export async function withMcp(profile, store, use, request = guardedFetch) {
  const token = profile.secret ? store.unseal(profile.secret) : '';
  let version, sessionId, id = 0;
  const signal = AbortSignal.timeout(25_000);
  const headers = () => ({ Accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(version ? { 'MCP-Protocol-Version': version } : {}), ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}) });
  async function rpc(method, params, notify = false) {
    const current = ++id;
    const message = { jsonrpc: '2.0', method, ...(notify ? {} : { id: current }), ...(params === undefined ? {} : { params }) };
    try {
      const response = await request(profile.url, { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(message), signal }, { allowPort: profile.kind === 'remote' });
      const advertised = response.headers.get('mcp-session-id');
      if (method === 'initialize' && advertised && /^[\x21-\x7e]{1,256}$/.test(advertised)) sessionId = advertised;
      if (!response.ok) {
        response.body?.cancel().catch(() => {});
        if ([401, 403].includes(response.status)) throw new HttpError(502, 'The MCP server refused authorization. Check the saved bearer token and account permissions.');
        if (response.status === 429) throw new HttpError(429, 'The MCP service is rate limited. Try again later.');
        throw new HttpError(502, `The MCP server returned HTTP ${response.status}. Check the Streamable HTTP endpoint.`);
      }
      if (notify) { response.body?.cancel().catch(() => {}); return null; }
      const reply = /^text\/event-stream\b/i.test(response.headers.get('content-type') || '')
        ? await streamReply(response, current) : JSON.parse(await boundedText(response, 768 * 1024));
      if (reply?.jsonrpc !== '2.0' || reply.id !== current) throw new HttpError(502, 'The MCP server returned an invalid reply.');
      if (reply.error) throw new HttpError(422, 'The MCP server rejected the tool or its arguments. Check the input schema.');
      if (!plainObject(reply.result)) throw new HttpError(502, 'The MCP server did not return a result.');
      return reply.result;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'Could not complete the request to the MCP server. Check its HTTPS URL and network access.');
    }
  }
  const list = async () => {
    const tools = [], cursors = new Set();
    let cursor;
    for (let page = 0; page < 4; page++) {
      const payload = await rpc('tools/list', cursor ? { cursor } : {});
      if (!Array.isArray(payload.tools)) throw new HttpError(502, 'The server did not return a tool catalog.');
      for (const item of payload.tools) {
        if (!simpleToolName(item?.name) || tools.some((tool) => tool.name === item.name)) continue;
        tools.push({ name: item.name, title: text(item.title || item.annotations?.title, 120), description: text(item.description, 600), inputSchema: plainObject(item.inputSchema) && JSON.stringify(item.inputSchema).length <= 16_000 ? item.inputSchema : { type: 'object' }, runnable: profile.kind !== 'buffer' || readableBuffer.has(item.name) });
        if (tools.length >= 100) return tools;
      }
      cursor = payload.nextCursor;
      if (typeof cursor !== 'string' || cursor.length > 1000 || cursors.has(cursor)) break;
      cursors.add(cursor);
    }
    return tools;
  };
  try {
    const hello = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Curiousity', version: '2.0.0' } });
    if (!versions.has(hello.protocolVersion)) throw new HttpError(502, 'The server negotiated an unsupported MCP version.');
    version = hello.protocolVersion;
    await rpc('notifications/initialized', undefined, true);
    if (!hello.capabilities?.tools) throw new HttpError(502, 'This MCP server does not advertise tools.');
    return await use({ list, serverName: text(hello.serverInfo?.name, 120), call: (name, args = {}) => rpc('tools/call', { name, arguments: args }) });
  } finally {
    if (sessionId) {
      // A server can opt out of DELETE; tool results are not retried.
      request(profile.url, { method: 'DELETE', headers: headers(), signal: AbortSignal.timeout(2500) }, { allowPort: profile.kind === 'remote' }).then((res) => res.body?.cancel()).catch(() => {});
    }
  }
}

export async function inspectMcp(profile, store) {
  return withMcp(profile, store, async (session) => ({ serverName: session.serverName, tools: await session.list() }));
}

export async function runMcp(profile, store, input) {
  if (!simpleToolName(input.name) || !plainObject(input.arguments) || JSON.stringify(input.arguments).length > 20_000) throw new HttpError(400, 'Choose a tool and enter a JSON object of arguments.');
  if (input.approved !== true) throw new HttpError(400, 'Review the tool and approve this request before running it.');
  if (profile.kind === 'buffer' && !readableBuffer.has(input.name)) throw new HttpError(403, 'Use a clip’s Buffer draft review for writes. Other Buffer writes are disabled here.');
  return withMcp(profile, store, async (session) => {
    if (!(await session.list()).some((item) => item.name === input.name && item.runnable)) throw new HttpError(404, 'This tool is not available on the saved MCP server.');
    const result = await session.call(input.name, input.arguments);
    const content = (Array.isArray(result.content) ? result.content : []).filter((item) => item?.type === 'text' && typeof item.text === 'string').map((item) => item.text).join('\n');
    let output = result.structuredContent !== undefined ? JSON.stringify(result.structuredContent, null, 2) : content || '(No text result)';
    if (profile.secret) output = output.replaceAll(store.unseal(profile.secret), '[redacted]');
    return { output: output.slice(0, 48_000), isError: result.isError === true };
  });
}
