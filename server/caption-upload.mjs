import { createWriteStream } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Busboy from 'busboy';
import { HttpError } from './validation.mjs';

export const maxStillImageBytes = 12 * 1024 ** 2;
const idleMs = 120_000;

export function responseSignal(res) {
  const controller = new AbortController();
  const closed = () => { if (!res.writableFinished) controller.abort(new Error('The client disconnected.')); };
  res.once('close', closed);
  if (res.destroyed) closed();
  return { signal: controller.signal, release: () => res.off('close', closed) };
}

export async function receiveVideo(req, path, signal, { limit = Infinity, label = 'video' } = {}) {
  const idle = new AbortController();
  const combined = AbortSignal.any([signal, idle.signal]);
  combined.throwIfAborted();
  const timer = setTimeout(() => idle.abort(new HttpError(408, 'The upload stopped sending data. Choose the files and try again.')), idleMs);
  timer.unref();
  let bytes = 0, checkAfter = 0;
  // Keep the HTTP socket out of pipeline(): on a disk error we still want to
  // send an actionable HTTP response, not just reset the connection. Check
  // free space as we go so a large upload cannot fill the workspace volume.
  const input = new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length;
    timer.refresh();
    if (bytes > limit) return done(new HttpError(413, `The ${label} exceeds the ${Math.floor(limit / 1024 ** 2)} MB upload limit.`));
    if (bytes < checkAfter) return done(null, chunk);
    checkAfter = bytes + 8 * 1024 ** 2;
    statfs(dirname(path), { bigint: true }).then(({ bavail, bsize }) => {
      if (bavail * bsize < 128n * 1024n ** 2n) done(new HttpError(507, 'This server is low on disk space. Free some space for the workspace before retrying.'));
      else done(null, chunk);
    }, done);
  } });
  const failed = (error) => input.destroy(error);
  req.on('error', failed);
  try {
    const written = pipeline(input, createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal: combined });
    req.pipe(input);
    await written;
    if (!bytes) throw new HttpError(400, `Choose a ${label} file that is not empty.`);
  } catch (error) {
    if (combined.aborted) throw combined.reason;
    if (['ENOSPC', 'EDQUOT'].includes(error.code)) throw new HttpError(507, 'The server ran out of space while saving the upload. Free disk space and try again.');
    throw error;
  } finally {
    clearTimeout(timer);
    req.unpipe(input);
    req.off('error', failed);
  }
}

export async function receiveStill(req, { audio, image }, signal, audioLimit) {
  const ctrl = new AbortController();
  const scope = AbortSignal.any([signal, ctrl.signal]);
  scope.throwIfAborted();
  let parser;
  try { parser = Busboy({ headers: req.headers, limits: { files: 2, fields: 0, parts: 3 } }); }
  catch { throw new HttpError(400, 'Upload one picture and one audio file.'); }
  const rejectPair = () => ctrl.abort(new HttpError(400, 'Upload exactly one picture and one audio file.'));
  const maxBytes = audioLimit + maxStillImageBytes + 65_536;
  const tooLarge = () => new HttpError(413, 'The picture and audio upload exceeds the size limit.');
  if (Number(req.get('content-length')) > maxBytes) throw tooLarge();
  const timer = setTimeout(() => ctrl.abort(new HttpError(408, 'The upload stopped sending data. Choose the files and try again.')), idleMs).unref();
  let received = 0;
  const activity = (chunk) => {
    timer.refresh();
    if ((received += chunk.length) > maxBytes) ctrl.abort(tooLarge());
  };
  const failure = (error) => ctrl.abort(error);
  const stop = () => queueMicrotask(() => parser.destroy());
  scope.addEventListener('abort', stop, { once: true });
  const seen = new Set(), writes = [];
  const parsed = new Promise((resolve) => {
    parser.once('error', () => { rejectPair(); resolve(); }).once('close', resolve);
  });
  parser.on('filesLimit', rejectPair).on('fieldsLimit', rejectPair).on('partsLimit', rejectPair);
  parser.on('file', (name, stream) => {
    stream.on('error', failure);
    if (scope.aborted || !['audio', 'image'].includes(name) || seen.has(name)) {
      stream.resume(); rejectPair(); return;
    }
    seen.add(name);
    writes.push(receiveVideo(stream, name === 'audio' ? audio : image, scope, { label: name, limit: name === 'audio' ? audioLimit : maxStillImageBytes }).catch(failure));
  });
  req.on('error', failure).on('data', activity).pipe(parser);
  try {
    await parsed;
    await Promise.all(writes);
    scope.throwIfAborted();
    if (seen.size !== 2) throw new HttpError(400, 'Upload a picture and an audio file together.');
  } finally {
    clearTimeout(timer);
    req.unpipe(parser);
    req.removeListener('data', activity).removeListener('error', failure);
    scope.removeEventListener('abort', stop);
  }
}
