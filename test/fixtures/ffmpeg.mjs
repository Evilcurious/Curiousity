#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
const isCapture = args.includes('-live_start_index');
const capture = ['-hide_banner', '-loglevel', 'error', '-y', '-i', process.env.FIXTURE_INPUT, '-t', '12', '-c', 'copy', '-f', 'mpegts', args.at(-1)];
const result = spawnSync(process.env.FIXTURE_FFMPEG, isCapture ? capture : args, { stdio: 'inherit' });
if (result.status !== 0 || !isCapture) process.exit(result.status ?? 1);
process.on('SIGINT', () => process.exit(255));
console.log('out_time_us=12000000\nprogress=continue');
setTimeout(() => process.exit(0), 30000);
