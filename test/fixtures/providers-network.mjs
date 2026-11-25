import { setTimeout as delay } from 'node:timers/promises';
import { appendFile } from 'node:fs/promises';

// Synthetic provider transport for integration/browser fixtures. Importing
// this file without the fixture env never changes global fetch.
const realFetch = globalThis.fetch;
const trace = process.env.FIXTURE_PROVIDER_TRACE;
if (trace) globalThis.fetch = async (input, options) => {
  const url = new URL(input);
  if (url.hostname === 'generativelanguage.googleapis.com') {
    const body = JSON.parse(options.body);
    await appendFile(trace, `${JSON.stringify({ route: url.pathname, body })}\n`);
    const { windows } = JSON.parse(body.contents[0].parts[0].text);
    const window = windows.find(({ transcript }) => transcript.length > 15) || windows[0];
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify([{ id: window.id, score: 96, title: 'From the video preview' }]) }] } }] });
  }
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
    if (Array.isArray(latest)) {
      const { windows } = JSON.parse(latest[0].text);
      const winner = windows.find(({ transcript }) => transcript.length > 15) || windows.at(-1);
      const rankings = body.model === 'fixture-invalid-vision' ? [{ id: 'invented', score: 100, start: 500, end: 900 }, { id: winner.id, score: 290 }] :
        [{ id: 'invented', score: 100 }, { id: winner.id, score: 96, start: 500, end: 900, title: 'A visual highlight', reason: 'The scene has a clear subject.' }];
      return Response.json({ choices: [{ message: { content: JSON.stringify(rankings) } }] });
    }
    if (body.messages[0].content.startsWith('Review a public discovery shortlist.')) {
      const { criteria, candidates } = JSON.parse(latest);
      const decisions = criteria.query.includes('AI invalid') ? [{ id: 'made-up-id', keep: true }] : candidates.map(({ id, source }) => ({
        id, keep: !criteria.query.includes('AI veto all') && !(criteria.query.includes('AI veto') && source === 'instagram'),
      }));
      return Response.json({ choices: [{ message: { content: JSON.stringify(decisions) } }] });
    }
    if (body.messages[0].content.startsWith('A public livestream chat spike was observed.')) {
      const { windows } = JSON.parse(latest);
      return Response.json({ choices: [{ message: { content: JSON.stringify(windows.map(({ id }) => ({ id, score: 91 }))) } }] });
    }
    if (body.messages[0].content.startsWith('Translate short subtitle cues')) {
      if (body.model === 'fixture-quota') return Response.json({ error: 'private fixture: never show the provider payload' }, { status: 429 });
      const cues = JSON.parse(latest);
      const english = body.messages[0].content.startsWith('Translate short subtitle cues into English.');
      // Simulate a model omitting cues on the first request. A repair asks only
      // for the missing IDs; the response uses a wrapped array and field alias.
      const partial = english && !body.messages[0].content.includes('Output only the requested id and text pairs');
      const translations = (partial ? cues.slice(0, 1) : cues).map(({ id }) => ({ id, translation: english ? 'A well-made video starts with a hook.' : 'Una breve frase de ejemplo.' }));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ translations }) } }] });
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
    if (process.env.FIXTURE_SPEECH_PAUSE_MS) await delay(Number(process.env.FIXTURE_SPEECH_PAUSE_MS), null, { signal: options.signal });
    if (process.env.FIXTURE_SPEECH_LANGUAGE === 'es') return Response.json({ language: 'Spanish', segments: [{ start: .15, end: 1.6, text: 'Así se prepara un buen vídeo.' }] });
    return Response.json({ language: 'English', segments: [{ start: .15, end: 1.6, text: 'A short caption example.' }, { start: 1.6, end: 2.8, text: 'It stays with the video.' }] });
  }
  return new Response(null, { status: 404 });
};
