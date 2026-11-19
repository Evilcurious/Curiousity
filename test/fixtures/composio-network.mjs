import { appendFile } from 'node:fs/promises';

export const projectKey = 'fixture-composio-project-key-only-Q7';
export const modelKey = 'fixture-app-model-key-only-P6';
export const oauthToken = 'fixture-upstream-oauth-token-only-S5';
export const publicSite = 'https://workspace.example.test';
export const emailTool = 'GMAIL_SEND_EMAIL';
export const toolkitFixture = (slug, name, extras = {}) => ({ slug, name, type: 'native', toolkit_type: 'api', composio_managed_auth_schemes: ['OAUTH2'], meta: { description: `Connect to ${name}.` }, ...extras });
const traces = process.env.FIXTURE_COMPOSIO_TRACE;
const upstream = globalThis.fetch;
const reply = (content) => Response.json({ choices: [{ message: { content } }] });
const apps = [toolkitFixture('gmail', 'Gmail'), toolkitFixture('slack', 'Slack'), toolkitFixture('provider_mcp', 'External MCP', { toolkit_type: 'mcp' }), toolkitFixture('no_auth', 'Unlinked workspace', { no_auth: true }), toolkitFixture('api_key', 'API key only', { composio_managed_auth_schemes: ['API_KEY'] })];
const inputSchema = { type: 'object', properties: {
  recipient_email: { type: 'string', minLength: 3 }, subject: { type: 'string' }, body: { type: 'string' },
}, required: ['recipient_email', 'subject', 'body'], additionalProperties: false };
let seq = 0;
const sessions = new Map(), accounts = new Map();
const item = (account) => ({ id: account.id, toolkit: { slug: account.slug }, alias: account.alias, status: account.status, is_disabled: false,
  state: { val: { access_token: oauthToken } }, data: { token: oauthToken }, ...(account.seq % 2 === 0 && { user_id: account.userId }) });
const err = (status) => Response.json({ error: `synthetic upstream details ${projectKey}` }, { status });
if (traces) globalThis.fetch = async (input, options) => {
  const url = new URL(input), { hostname, pathname } = url;
  if (hostname !== 'backend.composio.dev' && hostname !== 'app-models.example.test') return upstream(input, options);
  const { method } = options, body = options.body ? JSON.parse(options.body) : undefined;
  const keyOk = options.headers['x-api-key'] === projectKey;
  await appendFile(traces, `${JSON.stringify({ hostname, method, pathname, query: Object.fromEntries(url.searchParams), body, keyOk, redirect: options.redirect })}\n`);
  if (hostname === 'app-models.example.test') {
    if (options.headers.Authorization !== `Bearer ${modelKey}`) return err(401);
    if (pathname !== '/v1/chat/completions') return err(404);
    if (body.messages[0]?.role !== 'system') return reply('Ordinary chat did not see any apps.');
    const { request: prompt, app_context: context } = JSON.parse(body.messages.at(-1).content);
    if (context.result) return prompt.includes('summary failure') ? err(503) : reply('The approved fixture action completed.');
    if (prompt.includes('clarify')) return reply(JSON.stringify({ reply: 'Which address should I use?' }));
    const tool = prompt.includes('invalid tool') ? 'COMPOSIO_PROXY_EXECUTE' : emailTool;
    const args = { recipient_email: 'recipient@example.test', subject: 'Reviewed draft', body: 'This is the exact approved text.' };
    if (prompt.includes('invalid arguments')) args.unknown_input = 'not allowed';
    return reply(JSON.stringify({ tool, arguments: args }));
  }
  if (!keyOk || !pathname.startsWith('/api/v3.1/')) return err(401);
  const path = pathname.slice('/api/v3.1'.length);
  if (path === '/toolkits') {
    const q = url.searchParams.get('search')?.toLowerCase();
    return Response.json({ items: apps.filter((app) => !q || app.slug.includes(q) || app.name.toLowerCase().includes(q)), next_cursor: null });
  }
  if (path === '/connected_accounts' && method === 'GET') {
    if (!url.searchParams.has('user_ids')) return err(400);
    const ids = url.searchParams.get('connected_account_ids')?.split(',');
    return Response.json({ items: [...accounts.values()].filter((account) => account.userId === url.searchParams.get('user_ids') && (!ids || ids.includes(account.id))).map(item) });
  }
  if (path === '/connected_accounts/complete_auth') {
    const match = /^fixture-verifier-(\d+)$/.exec(body.session_uri || '');
    const account = match && accounts.get(`ca_fixture_${match[1]}`);
    if (!account || account.userId !== body.user_id || account.status !== 'INITIATED') return err(400);
    account.status = 'ACTIVE';
    return Response.json({ connected_account_id: account.id, toolkit_slug: account.slug });
  }
  if (path.startsWith('/connected_accounts/') && method === 'DELETE') {
    if (url.searchParams.get('revoke_on_delete') !== 'true') return err(400);
    return accounts.delete(path.split('/').at(-1)) ? Response.json({ success: true, revoke_job_id: 'fixture-job' }) : err(404);
  }
  if (path === '/tool_router/session' && method === 'POST') {
    if (!body.user_id || body.toolkits?.enable?.length !== 1 || body.instant !== false || body.manage_connections?.enable !== false || body.proxy_execute?.enable !== false || body.workbench?.enable !== false || body.execute?.enable_multi_execute !== false) return err(400);
    const id = `trs_fixture_${++seq}`;
    sessions.set(id, body);
    return Response.json({ session_id: id, mcp: { url: 'https://never-exposed.example.test/mcp', headers: { Authorization: projectKey } } }, { status: 201 });
  }
  if (path === `/tools/${emailTool}`) return Response.json({ slug: emailTool, name: 'Send an email', toolkit: { slug: 'gmail' }, input_parameters: inputSchema, no_auth: false, is_deprecated: false });
  const match = /^\/tool_router\/session\/([^/]+)(?:\/([^/]+))?$/.exec(path);
  if (!match) return err(404);
  const [, id, action] = match;
  const session = sessions.get(id), slug = session?.toolkits?.enable?.[0];
  if (!session) return err(404);
  if (method === 'DELETE' && !action) { sessions.delete(id); return Response.json({ success: true }); }
  if (action === 'link' && body.toolkit === slug && body.callback_url?.endsWith('/api/composio/callback')) {
    const n = ++seq, accountId = `ca_fixture_${n}`;
    accounts.set(accountId, { id: accountId, userId: session.user_id, slug, alias: body.alias || null, status: 'INITIATED', seq: n });
    return Response.json({ redirect_url: `https://connect.composio.dev/link/ln_fixture_${n}`, connected_account_id: accountId, link_token: `ln_fixture_${n}` });
  }
  const account = accounts.get(session.connected_accounts?.[slug]?.[0]);
  if (!account || account.userId !== session.user_id || account.slug !== slug || account.status !== 'ACTIVE') return err(403);
  if (action === 'search') {
    const primary = slug === 'gmail' ? [emailTool] : [];
    return Response.json({ success: true, results: [{ primary_tool_slugs: primary }], tool_schemas: {
      ...(primary.length && { [emailTool]: { toolkit: 'gmail', tool_slug: emailTool, hasFullSchema: false } }),
      COMPOSIO_PROXY_EXECUTE: { toolkit: slug, tool_slug: 'COMPOSIO_PROXY_EXECUTE', hasFullSchema: true, input_schema: { type: 'object' } },
      SLACK_SEND_MESSAGE: { toolkit: 'slack', tool_slug: 'SLACK_SEND_MESSAGE', hasFullSchema: true, input_schema: { type: 'object' } },
    } });
  }
  if (action === 'execute') {
    if (body.tool_slug !== emailTool || body.account !== account.id || session.tools?.[slug]?.enable?.[0] !== emailTool || body.enable_auto_workbench_offload !== false) return err(400);
    return Response.json({ result_type: 'completed', data: { sent: true, recipient: body.arguments.recipient_email, api_key: projectKey, authorization: `Bearer ${oauthToken}`, data: modelKey }, error: null, log_id: 'log_fixture_Q9' });
  }
  return err(404);
};
