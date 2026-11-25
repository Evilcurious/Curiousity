import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pickMoments } from './moments.mjs';
import { ffmpeg, run } from './tools.mjs';

// Mix strong audio/replay/text candidates with candidates spread across the
// source. A quiet visual moment must not be excluded just because it has no words.
export function visualCandidatePool(candidates, duration, limit) {
  const budget = Math.min(24, Math.max(12, 2 * limit));
  if (candidates.length <= budget) return candidates;
  const strongest = pickMoments(candidates, Math.max(limit, Math.ceil(budget / 2)));
  const spaced = [];
  for (let i = 0; i < Math.ceil(budget / 2); i++) {
    const midpoint = (i + .5) * duration / Math.ceil(budget / 2);
    const nearest = candidates.reduce((best, item) =>
      Math.abs((item.start + item.end) / 2 - midpoint) < Math.abs((best.start + best.end) / 2 - midpoint) ? item : best);
    spaced.push(nearest);
  }
  // Fill a mixture of strong, distinct windows and quiet stretches before adding overlaps.
  return [...new Set([...strongest.slice(0, Math.floor(budget / 2)), ...spaced, ...strongest, ...candidates])].slice(0, budget);
}

const nativeSeconds = 90;
const previewBytes = 6 * 1024 ** 2;
async function motionPreview(path, scratch, duration, signal) {
  const output = join(scratch, 'ai-preview.mp4');
  try {
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-threads', '1', '-i', path,
      '-map', '0:V:0', '-map', '0:a:0?', '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1',
      '-filter_threads', '1', '-vf', 'fps=12,scale=360:360:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1',
      '-t', String(duration), '-fs', String(previewBytes), '-c:v', 'libx264', '-threads', '1', '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p', '-crf', '27', '-maxrate', '340k', '-bufsize', '680k', '-c:a', 'aac', '-ac', '1', '-b:a', '40k', '-movflags', '+faststart', output], { signal, timeout: 32_000 });
    const { size } = await stat(output);
    if (!size || size >= previewBytes) return null;
    return (await readFile(output)).toString('base64');
  } catch (error) {
    signal.throwIfAborted();
    return null; // No model call yet. Use frames if this source cannot be transcoded.
  } finally { await rm(output, { force: true }); }
}

export async function videoEvidence(path, candidates, { meta, duration, scratch, live, native, signal }) {
  const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const source = { title: typeof meta?.title === 'string' ? meta.title.slice(0, 180) : '', duration, viewCount: count(meta?.view_count), likeCount: count(meta?.like_count), live };
  if (native && duration <= nativeSeconds) {
    const video = await motionPreview(path, scratch, duration, signal);
    if (video) return { video, candidates, source, signalLabel: 'Video preview' };
  }
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(65_000)]);
  // Use two frames per window (opening and payoff), not just the URL or
  // thumbnail. Three bounded workers avoid decoding the source all at once.
  const frames = candidates.flatMap(({ id, start, end }) => [.18, .76].map((part) => ({ id, time: start + (end - start) * part })));
  const images = new Array(frames.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, frames.length) }, async () => {
    for (let index; (index = next++) < frames.length;) {
      const { id, time } = frames[index];
      const chunks = [];
      let bytes = 0;
      try {
        await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', time.toFixed(3), '-threads', '1', '-i', path,
          '-map', '0:V:0', '-an', '-frames:v', '1', '-vf', 'scale=320:320:force_original_aspect_ratio=decrease,setsar=1',
          '-threads', '1', '-q:v', '6', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], { signal: deadline, timeout: 9000, onData(chunk) {
          if ((bytes += chunk.length) > 60_000) throw new Error('Frame exceeded the evidence budget.');
          chunks.push(chunk);
        } });
        if (bytes) images[index] = { id, label: `${id}, ${time.toFixed(2)}s in the ${live ? 'captured window' : 'video'}`, data: Buffer.concat(chunks).toString('base64') };
      } catch (error) { if (deadline.aborted) throw deadline.reason; }
    }
  }));
  const observed = images.filter(Boolean);
  if (!observed.length) throw new Error('Could not read video frames for AI analysis.');
  const seen = new Set(observed.map(({ id }) => id));
  return { images: observed, candidates: candidates.filter(({ id }) => seen.has(id)), source, signalLabel: 'Video frames' };
}
