import { appendFile } from 'node:fs/promises';

// A process-local transport stub for tests only. No external service is contacted.
const request = globalThis.fetch;
export const mockOrgId = '61a000000000000000000001';
export const mockChannelId = '61a000000000000000000002';
export const mockPostId = '61a000000000000000000003';
const active = process.env.FIXTURE_MCP_TRACE;
if (active) globalThis.fetch = async (url, options) => {
  const host = new URL(url).hostname;
  if (!['mcp.buffer.com', 'mcp.example.test'].includes(host)) return request(url, options);
  if (options.method === 'DELETE') return new Response(null, { status: 204 });
  const rpc = JSON.parse(options.body), buffer = host === 'mcp.buffer.com', args = rpc.params?.arguments;
  let result;
  if (rpc.method === 'initialize') {
    if (options.headers.Authorization === 'Bearer fixture-denied') return new Response(null, { status: 401 });
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: buffer ? 'Buffer fixture' : 'Remote fixture', version: '1' } } }, { headers: { 'MCP-Session-Id': 'fixture-session' } });
  }
  if (options.headers['Mcp-Session-Id'] !== 'fixture-session' || options.headers['MCP-Protocol-Version'] !== '2025-06-18') return new Response(null, { status: 400 });
  if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
  if (rpc.method === 'tools/list') result = { tools: (buffer ? ['get_account', 'list_channels', 'create_post'] : ['hello']).map((name) => ({ name, description: `Fixture for ${name}`, inputSchema: { type: 'object' } })) };
  if (rpc.method === 'tools/call') {
    const name = rpc.params.name;
    if (buffer && name === 'get_account') result = { structuredContent: { account: { organizations: [{ id: mockOrgId, name: 'Fixture workspace' }] } } };
    if (buffer && name === 'list_channels') result = { content: [{ type: 'text', text: JSON.stringify({ channels: args.organizationId === mockOrgId ? [{ id: mockChannelId, displayName: 'Fixture Instagram', service: 'instagram' }] : [] }) }] };
    if (buffer && name === 'create_post') {
      await appendFile(active, `${JSON.stringify(args)}\n`);
      result = { structuredContent: { post: { id: mockPostId, status: options.headers.Authorization === 'Bearer fixture-unconfirmed' ? 'scheduled' : 'draft' } } };
    }
    if (!buffer && name === 'hello') result = { content: [{ type: 'text', text: `Hello ${args.name}; ${options.headers.Authorization}` }] };
  }
  const answer = { jsonrpc: '2.0', id: rpc.id, ...(result ? { result } : { error: { code: -32601, message: 'Unknown fixture tool' } }) };
  if (rpc.params?.name === 'list_channels') return new Response(`: fixture keepalive\r\n\r\nevent: message\r\ndata: ${JSON.stringify(answer)}\r\n\r\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  return Response.json(answer);
};
