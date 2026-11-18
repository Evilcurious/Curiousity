#!/usr/bin/env node
import { copyFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--version')) console.log('fixture');
else if (args.includes('--dump-single-json') && args.at(-1).endsWith('Q1L2M3N4O56')) console.log(JSON.stringify({
  title: 'Fixture livestream', is_live: true, live_status: 'is_live', formats: [{ protocol: 'm3u8_native', vcodec: 'h264', acodec: 'aac', height: 720, url: 'https://manifest.googlevideo.com/fixture.m3u8' }],
}));
else if (args.includes('--dump-single-json')) console.log(JSON.stringify({
  title: 'Fixture replay', channel: 'Fixture creator', duration: 41, live_status: 'was_live', was_live: true, language: 'en',
  subtitles: { en: [{ ext: 'vtt' }] }, heatmap: [{ start_time: 0, end_time: 9, value: 0.86 }],
}));
else {
  const template = args[args.indexOf('-o') + 1];
  if (!template) process.exit(2);
  if (args.includes('--skip-download')) writeFileSync(template.replace('%(ext)s', 'en.vtt'), 'WEBVTT\n\n00:00:00.000 --> 00:00:03.400\nHere is why a good clip needs a hook.\n\n00:00:03.400 --> 00:00:07.900\nKeep a payoff after the first line.\n');
  else { copyFileSync(process.env.FIXTURE_INPUT, template.replace('%(ext)s', 'mp4')); console.log('CF_DOWNLOAD 100.0%'); }
}
