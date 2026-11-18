import { appendFile } from 'node:fs/promises';

// Synthetic provider transport for integration/browser fixtures. Importing
// this file without the fixture env never changes global fetch.
const realFetch = globalThis.fetch;
const trace = process.env.FIXTURE_PROVIDER_TRACE;
if (trace) globalThis.fetch = async (input, options) => {
  const url = new URL(input);
  if (url.hostname !== 'models.example.test') return realFetch(input, options);
  const auth = options.headers.Authorization || '';
  const base = { route: url.pathname, port: url.port, authorization: auth, redirect: options.redirect };
  if (auth === 'Bearer denied-fixture') return new Response(null, { status: 401 });
  if (url.pathname === '/v1/models') {
    await appendFile(trace, `${JSON.stringify(base)}\n`);
    return Response.json({ data: [null, { id: 'fixture-chat' }, { id: 'fixture-speech' }] });
  }
  if (url.pathname === '/v1/chat/completions') {
    const body = JSON.parse(options.body);
    await appendFile(trace, `${JSON.stringify({ ...base, body })}\n`);
    const latest = body.messages.at(-1).content;
    if (body.messages[0].content.startsWith('Review a public discovery shortlist.')) {
      const { criteria, candidates } = JSON.parse(latest);
      const decisions = criteria.query.includes('AI invalid') ? [{ id: 'made-up-id', keep: true }] : candidates.map(({ id, source }) => ({
        id, keep: !criteria.query.includes('AI veto all') && !(criteria.query.includes('AI veto') && source === 'instagram'),
      }));
      return Response.json({ choices: [{ message: { content: JSON.stringify(decisions) } }] });
    }
    if (latest === 'Wait for disconnect') {
      try { await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })); }
      finally { await appendFile(trace, `${JSON.stringify({ aborted: true })}\n`); }
    }
    const reply = latest === 'Echo the fixture key' ? `Key ${auth}` : `Fixture reply ${body.messages.length}: ${latest}`;
    return Response.json({ choices: [{ message: { content: reply } }] });
  }
  if (url.pathname === '/v1/audio/transcriptions') {
    const audio = options.body.get('file');
    await appendFile(trace, `${JSON.stringify({ ...base, type: audio.type, bytes: audio.size, model: options.body.get('model') })}\n`);
    return Response.json({ language: 'English', segments: [{ start: .15, end: 1.6, text: 'A short caption example.' }, { start: 1.6, end: 2.8, text: 'It stays with the video.' }] });
  }
  return new Response(null, { status: 404 });
};
