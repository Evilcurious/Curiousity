import { createWriteStream } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError } from './validation.mjs';

export function responseSignal(res) {
  const controller = new AbortController();
  const closed = () => { if (!res.writableFinished) controller.abort(new Error('The client disconnected.')); };
  res.once('close', closed);
  if (res.destroyed) closed();
  return { signal: controller.signal, release: () => res.off('close', closed) };
}

export async function receiveVideo(req, path, signal) {
  const idle = new AbortController();
  const combined = AbortSignal.any([signal, idle.signal]);
  const timer = setTimeout(() => idle.abort(new HttpError(408, 'The video upload stopped sending data. Choose the file and try again.')), 120_000);
  timer.unref();
  let bytes = 0, checkAfter = 0;
  // Keep the HTTP socket out of pipeline(): on a disk error we still want to
  // send an actionable HTTP response, not just reset the connection. Check
  // free space as we go so a large upload cannot fill the workspace volume.
  const input = new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length;
    timer.refresh();
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
    if (!bytes) throw new HttpError(400, 'Choose a video file that is not empty.');
  } catch (error) {
    if (combined.aborted) throw combined.reason;
    if (['ENOSPC', 'EDQUOT'].includes(error.code)) throw new HttpError(507, 'The server ran out of space while saving the video. Free disk space and try again.');
    throw error;
  } finally {
    clearTimeout(timer);
    req.unpipe(input);
    req.off('error', failed);
  }
}
