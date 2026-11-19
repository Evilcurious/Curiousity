import { randomUUID } from 'node:crypto';
import { copyFile, link, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { exportFrame } from '../shared/exports.mjs';
import { jobDir } from './store.mjs';
import { HttpError, text } from './validation.mjs';

export const mediaNames = new Set(['video.mp4', 'poster.jpg', 'captions.srt']);
const isShared = (job) => job.status === 'ready' && Boolean(job.sharedAt);
export const sharedJob = (store, id, unavailable) => store.state.jobs.find((job) => job.id === id && !unavailable.has(job.id) && isShared(job));

function viewClip(job, clip, user) {
  const base = `/api/library/${job.id}/clips/${clip.id}`;
  return {
    projectId: job.id, id: clip.id, projectTitle: job.title, title: clip.title, duration: clip.duration, sharedAt: job.sharedAt, byYou: job.ownerId === user.id,
    frame: job.frame || exportFrame(job.options), captionLanguage: clip.captionLanguage || null, hashtags: clip.hashtags || [], demo: Boolean(job.options?.demo),
    posterUrl: clip.withPoster ? `${base}/poster.jpg` : null, captionsUrl: clip.withCaptions ? `${base}/captions.srt` : null, videoUrl: `${base}/video.mp4`,
  };
}

export function browseShared(store, user, unavailable, query) {
  const offset = Math.min(10_000, Math.max(0, parseInt(query.offset, 10) || 0));
  const q = text(query.q, 120).toLowerCase();
  const clips = store.state.jobs.filter((job) => isShared(job) && !unavailable.has(job.id))
    .sort((a, b) => b.sharedAt.localeCompare(a.sharedAt))
    .flatMap((job) => job.clips.filter((clip) => `${clip.title} ${job.title} ${(clip.hashtags || []).join(' ')}`.toLowerCase().includes(q)).map((clip) => viewClip(job, clip, user)));
  return { clips: clips.slice(offset, offset + 24), next: clips.length > offset + 24 ? offset + 24 : null };
}

export async function saveSharedClip(store, user, job, clip, stillShared, reserveProject) {
  const origin = `${job.id}/${clip.id}`;
  const existing = store.state.jobs.find((item) => item.ownerId === user.id && item.libraryOrigin === origin);
  if (existing) return existing;
  if (job.ownerId === user.id) return job;
  reserveProject(true);
  const id = randomUUID(), clipId = 'clip-1', base = jobDir(id), target = join(base, clipId), source = join(jobDir(job.id), clip.id);
  const frame = job.frame || exportFrame(job.options);
  const copy = { id: clipId, title: clip.title, reason: 'Saved from the shared clip library.', start: 0, end: clip.duration, duration: clip.duration, score: clip.score,
    captionLanguage: clip.captionLanguage, hashtagLanguage: clip.hashtagLanguage, hashtags: clip.hashtags, withPoster: clip.withPoster, withCaptions: clip.withCaptions, burnedCaptions: clip.burnedCaptions };
  try {
    await mkdir(target, { recursive: true, mode: 0o700 });
    for (const filename of ['video.mp4', ...(copy.withPoster ? ['poster.jpg'] : []), ...(copy.withCaptions ? ['captions.srt'] : [])]) {
      const from = join(source, filename), to = join(target, filename);
      try { await link(from, to); }
      catch (error) { if (!['EXDEV', 'ENOTSUP', 'EPERM'].includes(error.code)) throw error; await copyFile(from, to); }
    }
    if (!stillShared()) throw new HttpError(404, 'This clip is no longer shared.');
    reserveProject(false);
    const now = new Date().toISOString();
    const saved = { id, ownerId: user.id, libraryOrigin: origin, title: clip.title, duration: clip.duration, sourceKind: 'shared', frame,
      options: { demo: Boolean(job.options?.demo), count: 1, tiktok: false, captions: Boolean(clip.withCaptions), aspectRatio: frame.ratio, platform: 'universal' },
      status: 'ready', progress: 100, detail: 'Saved from the shared clip library.', clips: [copy], createdAt: now, updatedAt: now, finishedAt: now };
    store.state.jobs.unshift(saved);
    store.save();
    return saved;
  } catch (error) {
    await rm(base, { recursive: true, force: true });
    if (error.code === 'ENOENT') throw new HttpError(404, 'This clip is no longer available.');
    throw error;
  }
}
