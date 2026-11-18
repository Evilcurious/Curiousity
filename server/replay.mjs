import { boundedEnv } from './store.mjs';

export const replayWaitMinutes = Math.floor(boundedEnv('REPLAY_WAIT_MINUTES', 360, 1, 1440));
const checkDelay = boundedEnv('REPLAY_CHECK_SECONDS', 60, 5, 600) * 1000;
export const replayWaiting = 'waiting_replay';

export function replayState(meta, mode) {
  if (mode === 'live') return null;
  if (meta.live_status === 'post_live' || ((meta.was_live || meta.live_status === 'was_live') && !meta.url && Array.isArray(meta.formats) && !meta.formats.length)) return 'processing';
  if (mode !== 'replay') return null;
  if (meta.live_status === 'is_upcoming') return 'upcoming';
  return meta.is_live === true || meta.live_status === 'is_live' ? 'live' : null;
}

const details = {
  live: 'The stream is still live. Curiousity will clip its replay when YouTube publishes it.',
  upcoming: 'The broadcast has not started. Curiousity will check for its replay.',
  processing: 'The broadcast ended. Waiting for YouTube to publish a playable replay.',
};

export function checkReplayDeadline(job, now = Date.now()) {
  if (job.replayWait && now >= job.replayWait.deadline) throw new Error('The YouTube replay did not become available before the wait expired. Try the individual replay link once it is playable.');
}

export function planReplayCheck(job, state, now = Date.now()) {
  checkReplayDeadline(job, now);
  const deadline = job.replayWait?.deadline ?? now + replayWaitMinutes * 60_000;
  return { status: replayWaiting, progress: 4, sourceKind: 'replay', detail: details[state], replayWait: { state, deadline, nextCheckAt: Math.min(deadline, now + checkDelay) } };
}
