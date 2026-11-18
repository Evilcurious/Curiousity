#!/usr/bin/env node
import { copyFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const id = args.at(-1).split('v=').at(-1);
const base = 'https://manifest.googlevideo.com/';
const master = `${base}master.m3u8`;
const hls = (file, extra = {}) => ({ protocol: 'm3u8_native', vcodec: 'h264', acodec: 'aac', height: 720, url: `${base}${file}.m3u8`, ...extra });
const streams = {
  Q1L2M3N4O56: [hls('bad'), hls('video', { acodec: 'none', manifest_url: master }), hls('audio', { vcodec: 'none', manifest_url: master })],
  DASHonly001: args.includes('--extractor-args') ? [{ protocol: 'http_dash_segments', vcodec: 'h264', url: `${base}videoplayback`, manifest_url: `${base}stream.mpd` }] : [],
  SilentLive1: [hls('silent', { acodec: 'none' })],
  SizeLimit01: [hls('oversize')],
  Rejected001: [hls('bad')],
  NoFormats01: [],
};
const vtt = {
  en: 'WEBVTT\n\n00:00:00.000 --> 00:00:03.400\nHere is why a good clip needs a hook.\n\n00:00:03.400 --> 00:00:07.900\nKeep a payoff after the first line.\n',
  es: 'WEBVTT\n\n00:00:00.000 --> 00:00:03.400\nUn buen vídeo empieza con un gancho.\n\n00:00:03.400 --> 00:00:07.900\nCumple lo que prometes en la primera frase.\n',
};
if (args.includes('--version')) console.log('fixture');
else if (args.includes('--dump-single-json') && Object.hasOwn(streams, id)) console.log(JSON.stringify({ title: 'Fixture livestream', is_live: true, live_status: 'is_live', formats: streams[id] }));
else if (args.includes('--dump-single-json')) console.log(JSON.stringify({
  title: 'Fixture replay', channel: 'Fixture creator', duration: 41, live_status: 'was_live', was_live: true, language: 'en',
  subtitles: { en: [{ ext: 'vtt' }], es: [{ ext: 'vtt' }] }, heatmap: [{ start_time: 0, end_time: 9, value: 0.86 }],
}));
else {
  const template = args[args.indexOf('-o') + 1];
  if (!template) process.exit(2);
  if (args.includes('--skip-download')) {
    const locale = args[args.indexOf('--sub-langs') + 1].replace(/[^a-z]/g, '');
    if (!Object.hasOwn(vtt, locale)) process.exit(2);
    writeFileSync(template.replace('%(ext)s', `${locale}.vtt`), vtt[locale]);
  } else {
    copyFileSync(process.env.FIXTURE_INPUT, template.replace('%(ext)s', 'mp4'));
    console.log('CF_DOWNLOAD 100.0%');
  }
}
