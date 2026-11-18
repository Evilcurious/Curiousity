import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

export const exampleAdmin = { email: 'admin@example.test', password: 'synthetic-admin-test-only-Q8' };
export const memberPassword = 'synthetic-member-only-P9';
export const writeHeaders = { 'X-Clipforge': 'workspace' };

export async function startEngine(t, { cwd, env, flags = [], imports = [] } = {}) {
  const child = spawn(process.execPath, [...imports.flatMap((path) => ['--import', resolve(path)]), resolve('server/main.mjs'), ...flags], { cwd, env: {
    ...process.env, HOST: '127.0.0.1', PORT: '0', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', PUBLIC_ORIGIN: '', TRUST_PROXY: '', ALLOW_SIGNUP: 'true',
    GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REDIRECT_URI: '', TIKTOK_CLIENT_KEY: '', TIKTOK_CLIENT_SECRET: '', TIKTOK_REDIRECT_URI: '', ...env,
  } });
  const exited = once(child, 'close');
  const stop = async () => { child.kill('SIGTERM'); await exited; };
  t.after(stop);
  const url = await new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error('Engine did not start.')), 10000);
    timer.unref();
    let log = '', out = '';
    child.stderr.on('data', (chunk) => { log += chunk.toString(); });
    child.stdout.on('data', (chunk) => {
      out += chunk.toString();
      const match = out.match(/listening on (http:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Engine exited (${code}): ${log}`)); });
    child.once('error', reject);
  });
  return { url, stop, agent: () => cookieClient(url) };
}

export function cookieClient(url) {
  let cookie = '';
  const getHeaders = () => ({ ...writeHeaders, ...(cookie ? { Cookie: cookie } : {}) });
  const request = (path, options = {}) => fetch(`${url}/api${path}`, { ...options, headers: { ...getHeaders(), ...(options.headers || {}) } });
  const send = (method, path, body, headers) => request(path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const post = (path, body, headers) => send('POST', path, body, headers);
  const put = (path, body, headers) => send('PUT', path, body, headers);
  async function start(path, credentials, headers) {
    const res = await post(`/auth/${path}`, credentials, headers);
    if (res.ok) cookie = res.headers.get('set-cookie')?.split(';', 1)[0] || '';
    return res;
  }
  const signin = (email = exampleAdmin.email, password = exampleAdmin.password, headers) => start('signin', { email, password }, headers);
  const signup = (email, password = memberPassword, headers) => start('signup', { email, password, confirmPassword: password }, headers);
  return { url, request, getHeaders, post, put, signin, signup };
}
