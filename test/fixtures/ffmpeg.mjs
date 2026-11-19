#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { truncateSync } from 'node:fs';
const args = process.argv.slice(2);
const isCapture = args.includes('-live_start_index') || args.includes('dash');
const inputs = args.flatMap((arg, index) => arg === '-i' ? [args[index + 1]] : []);
const contains = (pattern) => inputs.some((url) => url.endsWith(pattern));
if (isCapture && contains('/bad.m3u8')) { console.error('HTTP error 403 Forbidden'); process.exit(1); }
if (isCapture && args[args.indexOf('-t') + 1] !== process.env.FIXTURE_LIVE_LIMIT_SECONDS) process.exit(1);
if (isCapture && contains('/video.m3u8') && (!contains('/audio.m3u8') || !args.includes('1:a:0'))) process.exit(1);
const segmentList = args.includes('-segment_list') ? args[args.indexOf('-segment_list') + 1] : null;
const length = process.env.FIXTURE_LIVE_FIXTURE_SECONDS || '12';
const elapsed = Number(process.env.FIXTURE_LIVE_PROGRESS_SECONDS || length) * 1_000_000;
const capture = ['-hide_banner', '-loglevel', 'error', '-y', '-i', process.env.FIXTURE_INPUT, '-t', length, ...(contains('/silent.m3u8') ? ['-an'] : []), '-c', 'copy', ...(segmentList ? ['-f', 'segment', '-segment_time', '6', '-segment_list_type', 'csv', '-segment_list', segmentList, '-reset_timestamps', '1'] : ['-f', 'matroska']), args.at(-1)];
const result = spawnSync(process.env.FIXTURE_FFMPEG, isCapture ? capture : args, { stdio: 'inherit' });
if (result.status !== 0 || !isCapture) process.exit(result.status ?? 1);
if (contains('/oversize.m3u8')) truncateSync(args.at(-1).replace('%06d', '000000'), 11 * 1024 * 1024);
if (contains('/stream.mpd') || contains('/silent.m3u8')) { console.log(`out_time_us=${elapsed}\nprogress=end`); process.exitCode = 0; }
else {
  process.on('SIGINT', () => process.exit(255));
  console.log(`out_time_us=${elapsed}\nprogress=continue`);
  setTimeout(() => process.exit(0), 30_000);
}
