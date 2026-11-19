import { mkdir, open, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { runYt } from './tools.mjs';

const bucketMs = 10_000;
export const chatHistoryMs = 130_000;
const maxBytes = 32 * 1024 * 1024;

// Only time and event IDs enter the in-memory meter. Replayed history, ticker
// duplicates, memberships and moderation actions are not live text messages.
export function liveChatEvents(line) {
  let row;
  try { row = JSON.parse(line); } catch { return []; }
  const actions = row?.isLive === true && row.replayChatItemAction?.actions;
  if (!Array.isArray(actions)) return [];
  return actions.slice(0, 100).flatMap((action) => {
    const item = action?.addChatItemAction?.item;
    const message = item?.liveChatTextMessageRenderer || item?.liveChatPaidMessageRenderer;
    if (!message || typeof message.id !== 'string' || !message.id || message.id.length > 256) return [];
    const at = Number(message.timestampUsec) / 1000;
    return Number.isFinite(at) ? [{ id: message.id, at }] : [];
  });
}

export function createChatMeter() {
  const seen = new Set(), buckets = new Map();
  let lastSpike = -Infinity, total = 0, spikes = 0;
  return {
    add(events, since, now) {
      for (const { id, at } of events) {
        if (at < Math.max(since, now - chatHistoryMs) || at > now + 5000 || seen.has(id)) continue;
        seen.add(id);
        if (seen.size > 8192) seen.delete(seen.values().next().value);
        const key = Math.floor(at / bucketMs) * bucketMs;
        buckets.set(key, (buckets.get(key) || 0) + 1);
        total++;
      }
    },
    sample(now) {
      for (const key of buckets.keys()) if (key < now - chatHistoryMs) buckets.delete(key);
      const minute = [...buckets].reduce((sum, [key, n]) => sum + (key >= now - 60_000 ? n : 0), 0);
      let spike;
      // Allow batched delivery from YouTube; evaluate recent completed windows,
      // not the instantaneous number of lines arriving from the downloader.
      const completed = [...buckets].filter(([start]) => start + bucketMs + 3000 <= now && start >= now - 45_000).sort(([a], [b]) => b - a);
      for (const [start, messages] of completed) {
        if (start < lastSpike + 45_000) continue;
        const baseline = Array.from({ length: 6 }, (_, i) => buckets.get(start - (i + 1) * bucketMs) || 0).sort((a, b) => a - b)[3];
        if (messages < Math.max(5, baseline * 2.5 + 3)) continue;
        lastSpike = start;
        spikes++;
        spike = { at: start + bucketMs / 2, messages, baseline };
        break;
      }
      return { minute, total, spikes, spike };
    },
  };
}

export function monitorLiveChat({ url, scratch, signal, timeout, onEvents, onState }) {
  const ctrl = new AbortController();
  const active = AbortSignal.any([signal, ctrl.signal]);
  const dir = join(scratch, 'chat'), path = join(dir, 'stream.live_chat.json');
  let position = 0, pending = '', reading, timer, fileSeenAt = 0, state = 'connecting';
  const decoder = new StringDecoder('utf8');
  const publish = (next) => { if (state !== next) { state = next; onState(next); } };
  const begin = Date.now();
  async function read() {
    if (active.aborted) return;
    if (!fileSeenAt && Date.now() - begin > 65_000) throw new Error('Live chat did not connect.');
    // Cap both the chat file and the downloader's transient fragments.
    const sizes = await Promise.all((await readdir(dir)).map((name) => stat(join(dir, name)).then((entry) => entry.size, () => 0)));
    if (sizes.reduce((a, b) => a + b, 0) > maxBytes) throw new Error('Live chat exceeded the temporary size limit.');
    const file = await open(path, 'r').catch((err) => { if (err.code !== 'ENOENT') throw err; });
    if (!file) return;
    const now = Date.now();
    fileSeenAt ||= now;
    try {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      for (let block = 0; block < 16; block++) {
        const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
        if (!bytesRead || active.aborted) break;
        position += bytesRead;
        const lines = (pending + decoder.write(buffer.subarray(0, bytesRead))).split('\n');
        pending = lines.pop();
        if (pending.length > 256 * 1024) throw new Error('Live chat contains an oversized entry.');
        for (const line of lines) onEvents(liveChatEvents(line));
      }
      if (!active.aborted && (position || now - fileSeenAt >= 12_000)) publish('listening');
    } finally { await file.close(); }
  }
  const task = (async () => {
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      active.throwIfAborted();
      timer = setInterval(() => {
        reading ||= read().catch((error) => ctrl.abort(error)).finally(() => { reading = null; });
      }, 1000).unref();
      await runYt(['--skip-download', '--ignore-no-formats-error', '--write-subs', '--sub-langs', 'live_chat', '--sub-format', 'json', '--no-part', '--no-continue', '--no-progress', '-o', 'stream.%(ext)s', '--', url], { cwd: dir, signal: active, timeout, maxOutput: 128 * 1024 });
      clearInterval(timer);
      await reading;
      await read();
      if (!signal.aborted) publish(state === 'listening' ? 'finished' : 'unavailable');
    } catch { if (!signal.aborted) publish('unavailable'); }
    finally { clearInterval(timer); await reading; await rm(dir, { force: true, recursive: true }); }
  })();
  return async () => { ctrl.abort(); await task; };
}
