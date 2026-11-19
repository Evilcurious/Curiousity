import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { maxSourceBytes, maxSourceSeconds } from './store.mjs';
import { ffmpeg, run } from './tools.mjs';
import { createChatMeter, monitorLiveChat } from './live-chat.mjs';
import { maxClips } from './validation.mjs';

export const liveModes = ['analytics', 'auto', 'full'];
const durationOf = (segments) => segments.length ? segments.at(-1).end - segments[0].start : 0;

// The FFmpeg segment list names only closed files, so analysis cannot race the
// writer or seek into an unfinished container. Never trust paths from the list.
export function captureSegments(csv) {
  const rows = [];
  for (const line of csv.split('\n')) {
    const match = line.match(/^(live-\d{6}\.mkv),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)\s*$/);
    if (!match) break;
    const [, file, from, to] = match, start = Number(from), end = Number(to);
    if (file !== `live-${String(rows.length).padStart(6, '0')}.mkv` || end <= start || end > maxSourceSeconds + 10 || (rows.length && Math.abs(rows.at(-1).end - start) > 0.25)) break;
    rows.push({ file, start, end });
  }
  return rows;
}

export async function runLiveMonitor({ job, meta, scratch, session, update, record, analyze }) {
  const { signal } = session;
  const recording = new AbortController();
  const recordSignal = AbortSignal.any([signal, recording.signal]);
  const limit = job.options.count === 'auto' ? maxClips : job.options.count;
  const meter = createChatMeter();
  const list = join(scratch, 'live-segments.csv');
  const patch = (changes) => update({ monitor: { ...job.monitor, ...changes } });
  let segments = [], pending, reading, interval, stopChat, snapshotCtrl, anchor, attemptStarted = Infinity;
  let analyticsCursor = 0, spike, evaluations = 0, messages = 0, spikeCount = 0;
  let chatState = meta.subtitles?.live_chat?.some((track) => track?.protocol === 'youtube_live_chat') ? 'connecting' : 'unavailable';
  const remaining = () => limit - job.clips.length;
  const newSegments = () => segments.filter((segment) => segment.start >= analyticsCursor - 0.25);
  const switching = () => job.monitor.mode === 'full';
  const snapshotReady = () => job.monitor.mode === 'analytics' && !pending && remaining() > 0 && durationOf(newSegments()) >= 6;
  const segmentRows = async () => captureSegments(await readFile(list, 'utf8').catch((err) => { if (err.code === 'ENOENT') return ''; throw err; }));

  function batch(rows, reaction = null) {
    if (signal.aborted || switching() || pending || remaining() <= 0 || durationOf(rows) < 6) return false;
    const ctrl = snapshotCtrl = new AbortController();
    const batchSignal = AbortSignal.any([signal, ctrl.signal]);
    const dir = join(scratch, 'analysis'), manifest = join(scratch, 'snapshot.ffconcat'), source = join(dir, 'source.mkv');
    const start = rows[0].start, end = rows.at(-1).end;
    const description = reaction ? 'Analyzing a chat spike with AI…' : 'Analyzing the latest captured footage…';
    patch({ analysis: description, busy: true, canAnalyze: false });
    pending = (async () => {
      try {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await writeFile(manifest, `ffconcat version 1.0\n${rows.map(({ file, start, end }) => `file ${file}\nduration ${(end - start).toFixed(6)}\n`).join('')}`, { mode: 0o600 });
        await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-safe', '1', '-f', 'concat', '-i', manifest, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-fs', String(Math.floor(maxSourceBytes) + 1), source], { signal: batchSignal, timeout: 12 * 60_000 });
        if ((await stat(source)).size > maxSourceBytes) throw new Error('This analysis window exceeded the source size limit.');
        const before = job.clips.length;
        const result = await analyze({ source, dir, offset: start, depth: end - start, limit: reaction ? 1 : remaining(), reaction, signal: batchSignal });
        if (!reaction) analyticsCursor = end;
        patch({ analysis: result || (job.clips.length > before ? `${job.clips.length - before} new ${job.clips.length - before === 1 ? 'clip' : 'clips'} ready for review.` : 'No distinct moments found in this footage.') });
      } catch (error) {
        if (!batchSignal.aborted) patch({ analysis: 'This window could not be analyzed. Already rendered clips are kept.' });
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
        await rm(manifest, { force: true }).catch(() => {});
        pending = null;
        snapshotCtrl = null;
        if (!signal.aborted && !switching()) patch({ busy: false, canAnalyze: snapshotReady() });
      }
    })();
    return true;
  }

  function autoBatch(final = false) {
    if (job.monitor.mode !== 'auto' || !spike || pending || !segments.length || remaining() <= 0 || evaluations >= 12) return;
    // Live media and chat travel independently. Use their wall/recording offset
    // to locate an approximate 28-second reaction window, not a replay timecode.
    const point = spike.seconds;
    if (!final && segments.at(-1).end < point + 8) return;
    const rows = segments.filter((row) => row.start < point + 8 && row.end > point - 20);
    const next = spike;
    spike = undefined;
    if (batch(rows, next)) evaluations++;
  }

  async function tick() {
    if (recordSignal.aborted) return;
    segments = await segmentRows();
    if (recordSignal.aborted) return;
    const sample = meter.sample(Date.now());
    messages = sample.minute; spikeCount = sample.spikes;
    if (sample.spike && anchor && job.monitor.mode === 'auto') {
      const seconds = anchor.seconds + (sample.spike.at - anchor.at) / 1000;
      if (seconds >= 0) spike = { ...sample.spike, seconds };
    }
    if (job.monitor.mode !== 'auto') spike = undefined;
    const chat = { state: chatState, messagesPerMinute: messages, messages: sample.total, spikes: spikeCount };
    const canAnalyze = snapshotReady(), seconds = Math.floor(segments.at(-1)?.end || 0);
    const previous = job.monitor.chat;
    if (seconds !== job.monitor.seconds || canAnalyze !== job.monitor.canAnalyze || previous.state !== chat.state || previous.messages !== chat.messages || previous.messagesPerMinute !== chat.messagesPerMinute || previous.spikes !== chat.spikes) {
      patch({ seconds, canAnalyze, chat });
    }
    autoBatch();
  }

  patch({ clipLimit: limit, chat: { state: chatState, messagesPerMinute: 0, messages: 0, spikes: 0 } });
  if (chatState === 'connecting') stopChat = monitorLiveChat({ url: job.options.url, scratch, signal: recordSignal, timeout: (job.captureLimitSeconds + 120) * 1000,
    onEvents: (events) => meter.add(events, attemptStarted, Date.now()), onState: (state) => { chatState = state; } });
  session.requestAnalysis = () => snapshotReady() && batch(newSegments());
  session.switchToFull = () => { recording.abort(); snapshotCtrl?.abort(); };
  interval = setInterval(() => {
    reading ||= tick().catch(() => {}).finally(() => { reading = null; });
  }, 1250).unref();
  try {
    const capture = await record({ signal: recordSignal, list,
      onAttempt() { segments = []; anchor = null; attemptStarted = Date.now(); },
      onMedia(seconds) { anchor = { seconds, at: Date.now() }; },
    });
    clearInterval(interval);
    await reading;
    session.requestAnalysis = null;
    recording.abort();
    // Wait for the in-flight batch before analyzing the last complete segment(s).
    await pending;
    signal.throwIfAborted();
    if (switching()) return;
    segments = await segmentRows();
    patch({ phase: 'finishing', canAnalyze: false, seconds: Math.floor(segments.at(-1)?.end || 0),
      chat: { ...job.monitor.chat, state: chatState === 'listening' ? 'finished' : chatState === 'connecting' ? 'unavailable' : chatState } });
    update({ status: 'analyzing', progress: 45, duration: capture.duration, liveInput: capture.inputFormat, detail: 'Finishing the recorded live window.' });
    if (job.monitor.mode === 'analytics') batch(newSegments());
    else autoBatch(true);
    await pending;
    signal.throwIfAborted();
    if (switching()) return;
    const detail = job.clips.length ? 'Capture finished. Your clips are ready; the project is still open.'
      : job.monitor.mode === 'auto' && ['unavailable', 'connecting'].includes(chatState) ? 'Capture finished without a clip. Public chat was unavailable.'
      : 'Capture finished without a clip. You can switch to Full to analyze the replay.';
    update({ status: 'ready', progress: 100, detail, finishedAt: new Date().toISOString(), monitor: { ...job.monitor, phase: 'idle', busy: false, canAnalyze: false } });
  } catch (error) {
    snapshotCtrl?.abort();
    if (!switching() || signal.aborted) throw error;
  }
  finally {
    session.requestAnalysis = null;
    clearInterval(interval);
    recording.abort();
    await reading;
    await stopChat?.();
    await pending;
    session.switchToFull = null;
  }
}
