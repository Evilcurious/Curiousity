import { appendFile } from 'node:fs/promises';

const trace = process.env.FIXTURE_INTEGRATIONS_TRACE;
const realFetch = globalThis.fetch;
const record = (call) => appendFile(trace, `${JSON.stringify(call)}\n`);
const drive = 'https://www.googleapis.com/auth/drive.file';
if (trace) globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  if (url.origin === 'https://workflow.example.test') {
    const body = JSON.parse(options.body);
    await record({ via: 'n8n', method: options.method, headers: options.headers, body, path: url.pathname, redirect: options.redirect });
    if (options.headers['X-Curiousity-Token'] !== 'workflow-fixture-private-secret') return new Response(null, { status: 401 });
    if (body.message === 'No confirmation') return new Response('Fixture private error', { status: 504 });
    if (body.message === 'No intentional reply') return Response.json({ rawNodeData: 'other-private-node-data' });
    return Response.json({ reply: `Approved: ${body.message} [${options.headers['X-Curiousity-Token']}]` });
  }
  if (url.href === 'https://oauth2.googleapis.com/token') {
    const body = Object.fromEntries(options.body);
    await record({ via: 'google-token', body });
    return Response.json({ access_token: `fixture-google-access-${body.code}`, refresh_token: `fixture-google-refresh-${body.code}`, expires_in: 3600, scope: `openid profile ${drive}` });
  }
  if (url.origin === 'https://openidconnect.googleapis.com') {
    const identity = options.headers.Authorization.replace('Bearer fixture-google-access-', '');
    return Response.json({ sub: `google-${identity}`, name: `Google ${identity}` });
  }
  if (url.href === 'https://open.tiktokapis.com/v2/oauth/token/') {
    const body = Object.fromEntries(options.body);
    await record({ via: 'tiktok-token', body });
    return Response.json({ open_id: `tiktok-${body.code}`, access_token: `fixture-tiktok-access-${body.code}`, refresh_token: `fixture-tiktok-refresh-${body.code}`, expires_in: 3600, scope: 'video.upload,user.info.basic' });
  }
  if (url.origin === 'https://open.tiktokapis.com' && url.pathname.endsWith('/user/info/')) {
    const identity = options.headers.Authorization.replace('Bearer fixture-tiktok-access-', '');
    return Response.json({ data: { user: { open_id: `tiktok-${identity}`, display_name: `TikTok ${identity}` } } });
  }
  return realFetch(input, options);
};
