#!/usr/bin/env node
import { appendFileSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const target = args.at(-1);
const id = target.endsWith('/@fixture-channel/live') ? 'WaitReplayA' : target.split('v=').at(-1);
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
else if (process.env.FIXTURE_LIVE_CHAT && args.includes('live_chat')) {
  const filename = 'stream.live_chat.json';
  writeFileSync(filename, '');
  const timer = setInterval(() => {
    if (!existsSync(process.env.FIXTURE_LIVE_CHAT)) return;
    const events = Array.from({ length: 8 }, (_, i) => ({ isLive: true, replayChatItemAction: { actions: [{ addChatItemAction: { item: { liveChatTextMessageRenderer: {
      id: `demo-text-${i}`, timestampUsec: String(Date.now() * 1000), message: { runs: [{ text: 'synthetic chat body — never forward or store me' }] },
    } } } }] } }));
    appendFileSync(filename, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
    clearInterval(timer);
  }, 250);
  setTimeout(() => clearInterval(timer), 60_000);
}
else if (process.env.FIXTURE_REPLAY_STATE && args.includes('--dump-single-json') && id.startsWith('WaitReplay')) {
  const states = JSON.parse(readFileSync(process.env.FIXTURE_REPLAY_STATE, 'utf8'));
  const state = states[id] || 'was_live';
  if (process.env.FIXTURE_REPLAY_TRACE) appendFileSync(process.env.FIXTURE_REPLAY_TRACE, `${JSON.stringify({ target, state })}\n`);
  if (state === 'post_live_error') { console.error('ERROR: [youtube] This livestream is still being processed.'); process.exit(1); }
  if (state === 'private') { console.error('ERROR: [youtube] This video is private.'); process.exit(1); }
  console.log(JSON.stringify({ id, title: 'Fixture scheduled replay', channel: 'Fixture creator', duration: 12, is_live: state === 'is_live',
    live_status: state === 'was_live_empty' ? 'was_live' : state, ...(state === 'was_live_empty' ? { formats: [] } : {}),
    ...(state === 'is_live' ? { formats: [hls('capture')], ...(process.env.FIXTURE_LIVE_CHAT && { subtitles: { live_chat: [{ protocol: 'youtube_live_chat' }] } }) } : {}) }));
}
else if (args.includes('--dump-single-json') && Object.hasOwn(streams, id)) console.log(JSON.stringify({ id, title: 'Fixture livestream', is_live: true, live_status: 'is_live', formats: streams[id] }));
else if (args.includes('--dump-single-json')) console.log(JSON.stringify({
  id, title: 'Fixture replay', channel: 'Fixture creator', duration: 41, live_status: 'was_live', was_live: true, language: 'en',
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
    copyFileSync((process.env.FIXTURE_REPLAY_INPUT && id.startsWith('WaitReplay')) ? process.env.FIXTURE_REPLAY_INPUT : process.env.FIXTURE_INPUT, template.replace('%(ext)s', 'mp4'));
    console.log('CF_DOWNLOAD 100.0%');
  }
}
