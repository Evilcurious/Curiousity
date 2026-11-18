import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { ROOT, ffmpeg, python, run, runYt, toolsStatus } from './tools.mjs';
import { maxSourceBytes, maxSourceSeconds, jobDir } from './store.mjs';
import { buildCandidates, clipCues, makeAss, makeSrt, normalizeCues, parseVtt, pickMoments } from './moments.mjs';
import { rankWithProvider, transcribeRemote } from './providers.mjs';

const demoImage = join(ROOT, 'public', 'images', 'demo-studio.jpg');
const demoAudio = join(ROOT, 'server', 'assets', 'demo-audio.m4a');
const ffmpegPath = isAbsolute(ffmpeg) ? ['--ffmpeg-location', ffmpeg] : [];
const sourceFormat = 'bv*[height<=1080]+ba/b[height<=1080]/b';

function sourceError(error) {
  const log = `${error.message}\n${error.output || ''}`;
  if (/requested format|no video formats|only images/i.test(log)) return 'No downloadable video format was offered. Try another authorized video or wait for the replay.';
  if (/sign in|bot|forbidden|429|403|po token/i.test(log)) return 'YouTube declined this request. This can happen on server IPs or restricted videos. Try an authorized public video or run from a different allowed network.';
  if (/not currently live|no live stream/i.test(log)) return 'This channel is not live right now. Try again during the event or use a completed replay link.';
  if (/private|copyright|geo.restrict|unavailable|members.only|login required/i.test(log)) return 'This video is unavailable or restricted. Try an authorized public source.';
  if (/not yet available|premieres in|live event will begin/i.test(log)) return 'The stream has not started yet. Try again once it is live.';
  if (/network|failed to resolve|connection|timed out|unable to download webpage/i.test(log)) return 'Could not reach YouTube from this server. Check its outbound network access.';
  return 'Could not read this YouTube source. Check the URL and try updating yt-dlp with npm run setup.';
}

async function getMetadata(url, signal) {
  try {
    const result = await runYt(['--skip-download', '--dump-single-json', '--no-warnings', '--', url], { signal, timeout: 90_000, maxOutput: 25 * 1024 * 1024 });
    const meta = JSON.parse(result.out.trim());
    if (!meta || meta._type === 'playlist' || !meta.title) throw new Error('Missing video metadata');
    return meta;
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw new Error(sourceError(error));
  }
}

function withSizeLimit(dir, signal) {
  const ctrl = new AbortController();
  let checking = false;
  const checkSize = async () => {
    if (checking || ctrl.signal.aborted) return;
    checking = true;
    try {
      const files = await readdir(dir);
      let size = 0;
      for (const file of files) size += (await stat(join(dir, file)).catch(() => ({ size: 0 }))).size;
      if (size > maxSourceBytes) ctrl.abort(new Error('The source exceeded this workspace’s download size limit.'));
    } finally { checking = false; }
  };
  const timer = setInterval(() => { checkSize().catch(() => {}); }, 2500);
  timer.unref();
  return { signal: AbortSignal.any([signal, ctrl.signal]), check: checkSize, done: () => clearInterval(timer) };
}

async function downloadSource(options, scratch, signal, progress) {
  const size = withSizeLimit(scratch, signal);
  try {
    await runYt([
      ...ffmpegPath, '-f', sourceFormat, '--merge-output-format', 'mp4', '--max-filesize', String(Math.floor(maxSourceBytes)), '--no-mtime',
      '--newline', '--progress', '--no-warnings', '--progress-template', 'download:CF_DOWNLOAD %(progress._percent_str)s',
      '-o', join(scratch, 'source.%(ext)s'), '--', options.url,
    ], { signal: size.signal, timeout: 55 * 60_000, onData: (chunk) => {
      const percents = [...chunk.toString().matchAll(/CF_DOWNLOAD\s+([\d.]+)%/g)];
      if (percents.length) progress(Math.min(38, 10 + Number(percents.at(-1)[1]) * 0.27));
    } });
    await size.check();
    if (size.signal.aborted) throw size.signal.reason;
  } catch (error) {
    if (size.signal.aborted) throw size.signal.reason;
    throw new Error(sourceError(error));
  } finally { size.done(); }
  const name = (await readdir(scratch)).find((file) => /^source\.(mp4|mkv|webm|mov|ts|flv)$/i.test(file));
  if (!name) throw new Error('No source file was downloaded. The selected video may exceed the workspace’s size limit.');
  return join(scratch, name);
}

function selectHls(meta) {
  return (meta.formats || []).filter((format) => {
    if (!format.protocol?.startsWith('m3u8') || format.vcodec === 'none' || format.acodec === 'none' || !format.height || format.height > 1080) return false;
    try {
      const url = new URL(format.url);
      return url.protocol === 'https:' && /(^|\.)(googlevideo\.com|youtube\.com)$/.test(url.hostname);
    } catch { return false; }
  }).sort((a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0))[0];
}

async function captureLive(meta, options, scratch, session, progress) {
  const hls = selectHls(meta);
  if (!hls) throw new Error('No public HLS feed with video and audio was offered. Try the replay when YouTube finishes processing it.');
  const video = join(scratch, 'capture.ts');
  const duration = Math.min(options.liveMinutes * 60, maxSourceSeconds);
  const agent = hls.http_headers?.['User-Agent'] || meta.http_headers?.['User-Agent'];
  const headers = typeof agent === 'string' && agent.length <= 250 && !/[\r\n]/.test(agent) ? ['-user_agent', agent] : [];
  const size = withSizeLimit(scratch, session.signal);
  let captureError, reported = 0;
  try {
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-rw_timeout', '18000000', '-live_start_index', '-1', ...headers, '-i', hls.url,
      '-t', String(duration), '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-c', 'copy', '-f', 'mpegts', '-progress', 'pipe:1', video], {
      signal: size.signal, timeout: (duration + 80) * 1000,
      onChild: (stop) => { session.finishCapture = () => { session.finishCapture = null; stop('SIGINT'); }; },
      onData: (buffer) => {
        const found = [...buffer.toString().matchAll(/out_time_us=(\d+)/g)].at(-1);
        if (found) {
          reported = Math.floor(Number(found[1]) / 1_000_000);
          progress(Math.min(39, 9 + reported / duration * 30), { capturedSeconds: Math.min(reported, duration) });
        }
      },
    });
    await size.check();
  } catch (error) {
    captureError = error;
  } finally { session.finishCapture = null; size.done(); }
  if (size.signal.aborted) throw size.signal.reason;
  if (!existsSync(video) || (await stat(video)).size < 100_000) {
    throw new Error(captureError ? 'The live capture could not collect enough video. Try again while the stream is active.' : 'The live stream ended before enough video was captured.');
  }
  return { path: video, duration: reported > 0 ? Math.min(reported, duration) : undefined };
}

async function audioProfile(path, signal) {
  const audio = [];
  let square = 0, samples = 0, leftover, total = 0, duration;
  try {
    await run(ffmpeg, ['-hide_banner', '-v', 'info', '-i', path, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'], {
      signal, timeout: 12 * 60_000,
      onData(chunk) {
        if (leftover) { chunk = Buffer.concat([leftover, chunk]); leftover = null; }
        if (chunk.length % 2) leftover = chunk.subarray(chunk.length - 1);
        for (let offset = 0; offset + 1 < chunk.length; offset += 2) {
          const sample = chunk.readInt16LE(offset) / 32768;
          square += sample * sample;
          samples++;
          total++;
          if (samples === 8000) { audio.push(10 * Math.log10(Math.max(1e-8, square / samples))); samples = 0; square = 0; }
        }
      },
      onLog(line) {
        const time = line.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (time) duration = Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]);
      },
    });
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (!duration && !total) throw new Error('FFmpeg could not read the downloaded source.');
  }
  if (samples > 0) audio.push(10 * Math.log10(Math.max(1e-8, square / samples)));
  return { audio, duration: duration || total / 8000 };
}

function captionLocale(meta) {
  const manual = Object.keys(meta.subtitles || {}).filter((key) => key !== 'live_chat');
  const automatic = Object.keys(meta.automatic_captions || {});
  const preferred = meta.language;
  // Prefer the source language or manual subtitles, not translated auto-generated tracks.
  if (typeof preferred === 'string' && /^[\w-]{1,30}$/.test(preferred)) {
    for (const key of [`${preferred}-orig`, preferred, `${preferred.split('-')[0]}-orig`, preferred.split('-')[0]]) {
      if (manual.includes(key) || automatic.includes(key)) return key;
    }
  }
  if (manual.length) return manual.find((key) => key === 'en') || manual.find((key) => /^[\w-]{1,30}$/.test(key));
  const original = automatic.find((key) => /^[\w-]+-orig$/.test(key));
  return original || (automatic.includes('en') && automatic.length < 5 ? 'en' : null);
}

async function downloadCaptions(meta, url, scratch, signal) {
  const language = captionLocale(meta);
  if (!language) return [];
  try {
    await runYt(['--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', `^${language}$`, '--sub-format', 'vtt', '--no-warnings', '-o', join(scratch, 'transcript.%(ext)s'), '--', url], { signal, timeout: 90_000 });
    const file = (await readdir(scratch)).find((name) => name.startsWith('transcript.') && name.endsWith('.vtt'));
    if (file) return parseVtt(await readFile(join(scratch, file), 'utf8'));
  } catch (error) { if (signal.aborted) throw signal.reason; }
  return [];
}

async function findTranscript({ meta, options, source, scratch, store, tools, signal, audio }) {
  if (!audio.some((db) => db > -58)) return { cues: [], label: 'No speech detected' };
  if (meta && !meta.is_live && meta.live_status !== 'is_live') {
    const cues = await downloadCaptions(meta, options.url, scratch, signal);
    if (cues.length) return { cues, label: 'YouTube transcript' };
  }
  const choice = store.state.captions;
  const profile = store.state.providers.find((p) => p.id === choice.providerId);
  let warning;
  if (profile && choice.model) {
    try {
      const chunkSeconds = 600;
      await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', '-f', 'segment', '-segment_time', String(chunkSeconds), join(scratch, 'audio-%04d.mp3')], { signal, timeout: 12 * 60_000 });
      const parts = (await readdir(scratch)).filter((name) => /^audio-\d+\.mp3$/.test(name)).sort().map((name) => join(scratch, name));
      const cues = normalizeCues(await transcribeRemote(profile, store, choice.model, parts, chunkSeconds, signal));
      if (cues.length) return { cues, label: profile.name };
      warning = 'The transcription provider found no timestamped dialogue.';
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      warning = 'The configured transcription provider could not return timestamped captions.';
    }
  }
  if (tools.whisper) {
    try {
      const res = await run(python, [join(ROOT, 'scripts', 'transcribe.py'), source], { signal, timeout: 2 * 60 * 60_000, maxOutput: 24 * 1024 * 1024 });
      const cues = normalizeCues(JSON.parse(res.out.trim().split('\n').at(-1)));
      return { cues, label: cues.length ? 'Local Whisper' : 'No speech detected' };
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      warning = 'Whisper could not transcribe this source. Check model downloads and setup, or use a transcription provider.';
    }
  }
  return { cues: [], label: 'Unavailable', warning: warning || 'No source captions were available. Install local Whisper or configure a transcription provider to generate them.' };
}

async function renderClip({ clip, path, options, cues, dir, signal, tools }) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const rows = options.captions ? clipCues(cues, clip.start, clip.end) : [];
  if (rows.length) {
    await writeFile(join(dir, 'captions.srt'), makeSrt(rows));
    if (tools.subtitles) await writeFile(join(dir, 'clip.ass'), makeAss(rows));
  }
  const filter = [
    '[0:v]split=2[back][front]',
    '[back]scale=180:320:force_original_aspect_ratio=increase,crop=180:320,gblur=sigma=9,eq=brightness=-0.15:saturation=0.8,scale=720:1280[bg]',
    '[front]scale=720:1280:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1[fg]',
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1${rows.length && tools.subtitles ? ',ass=clip.ass' : ''}[out]`,
  ].join(';');
  const start = clip.start.toFixed(3);
  const input = options.demo ? ['-loop', '1', '-framerate', '24', '-i', demoImage, '-ss', start, '-i', demoAudio] : ['-ss', start, '-i', path];
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-filter_complex_threads', '2', ...input, '-t', (clip.end - clip.start).toFixed(3),
    '-filter_complex', filter, '-map', '[out]', '-map', options.demo ? '1:a:0' : '0:a:0?', '-map_metadata', '-1', '-r', '24', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '23',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'video.mp4'], { cwd: dir, signal, timeout: 6 * 60_000 });
  await rm(join(dir, 'clip.ass'), { force: true });
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '0.8', '-i', 'video.mp4', '-frames:v', '1', '-vf', 'scale=360:640', '-threads', '2', '-q:v', '4', 'poster.jpg'], { cwd: dir, signal, timeout: 28_000 }).catch(() => {});
  return { withCaptions: rows.length > 0, burnedCaptions: rows.length > 0 && tools.subtitles, withPoster: existsSync(join(dir, 'poster.jpg')) };
}

export async function processProject(job, store, session, update) {
  const { options } = job;
  const { signal } = session;
  const tools = await toolsStatus();
  if (!tools.ffmpeg) throw new Error('FFmpeg is not installed. Follow the Setup guide and restart the server.');
  if (!options.demo && !tools.ytDlp) throw new Error('yt-dlp is not installed. Run npm run setup, then restart the server.');
  const root = jobDir(job.id);
  const scratch = join(root, 'work');
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  let path, duration, meta, audio = [], transcript = { cues: [], label: 'Off' }, isLive = false, lastProgress = 0;
  const progress = (value, extra = {}) => {
    if (value < (job.progress || 0)) value = job.progress;
    if (Date.now() - lastProgress < 900) return;
    lastProgress = Date.now();
    update({ progress: Math.round(value), ...extra });
  };
  try {
    if (options.demo) {
      const fixture = JSON.parse(await readFile(join(ROOT, 'server', 'assets', 'demo-cues.json'), 'utf8'));
      ({ duration } = fixture);
      transcript = { cues: fixture.cues, label: 'Sample transcript' };
      update({ title: 'The anatomy of a great hook', status: 'analyzing', progress: 50, duration, sourceKind: 'demo', detail: 'Scoring the bundled sample moments.' });
      ({ audio } = await audioProfile(demoAudio, signal));
    } else {
      update({ status: 'fetching', progress: 4, detail: 'Checking this link and detecting the source type.' });
      meta = await getMetadata(options.url, signal);
      isLive = meta.is_live === true || meta.live_status === 'is_live';
      if (meta.live_status === 'is_upcoming') throw new Error('This livestream has not started yet. Try again once it is live.');
      if (meta.live_status === 'post_live' && !isLive) throw new Error('YouTube is still processing this replay. Try again after the video becomes available.');
      if (!isLive && options.mode === 'live') throw new Error('This source is not currently live. Use Auto-detect or Video / replay.');
      if (isLive && options.mode === 'recorded') throw new Error('This source is still live. Switch to Auto-detect or Live monitor.');
      if (!isLive && Number(meta.duration) > maxSourceSeconds) throw new Error(`This source exceeds the ${Math.round(maxSourceSeconds / 60)}-minute workspace limit.`);
      const common = { title: String(meta.title).trim().slice(0, 180), creator: String(meta.channel || meta.uploader || '').slice(0, 90), sourceKind: isLive ? 'live' : meta.was_live || meta.live_status === 'was_live' ? 'replay' : 'video' };
      if (isLive) {
        update({ ...common, status: 'capturing', progress: 9, capturedSeconds: 0, captureLimitSeconds: Math.min(options.liveMinutes * 60, maxSourceSeconds), detail: `Recording up to ${Math.min(options.liveMinutes, maxSourceSeconds / 60)} min from the live edge.` });
        ({ path, duration } = await captureLive(meta, options, scratch, session, progress));
      } else {
        update({ ...common, status: 'downloading', progress: 9, detail: 'Downloading an authorized copy of the source.' });
        path = await downloadSource(options, scratch, signal, progress);
      }
      update({ status: 'analyzing', progress: 41, detail: 'Measuring audio activity and looking for captions.' });
      const prof = await audioProfile(path, signal);
      audio = prof.audio;
      duration = prof.duration || duration || Number(meta.duration);
      if (!Number.isFinite(duration) || duration < 6) throw new Error('At least six seconds of playable video are needed to make a clip.');
      if (duration > maxSourceSeconds + 10) throw new Error('This source exceeded the configured duration limit.');
      update({ duration, progress: 48, detail: 'Reading the source transcript or transcribing speech.' });
      transcript = await findTranscript({ meta, options, source: path, scratch, store, tools, signal, audio });
    }
    const warnings = transcript.warning ? [transcript.warning] : [];
    if (options.captions && !transcript.cues.length && !transcript.warning) warnings.push('No usable spoken captions were found in this source.');
    const heatmap = !isLive && Array.isArray(meta?.heatmap) ? meta.heatmap : [];
    const candidates = buildCandidates({ duration, count: options.count, cues: transcript.cues, audio, heatmap });
    const profile = !options.demo && store.state.providers.find((p) => p.id === store.state.activeProviderId);
    let engine = 'Local analysis', ordered = candidates;
    if (profile?.model && candidates.some((m) => m.excerpt)) {
      const eligible = candidates.filter((m) => m.excerpt.length > 15);
      const pool = [...new Set([...pickMoments(eligible, Math.max(12, options.count)), ...eligible])].slice(0, Math.min(30, Math.max(14, options.count * 2)));
      if (pool.length) {
        update({ progress: 57, detail: `Ranking candidate moments with ${profile.name}.` });
        try {
          const ranking = await rankWithProvider(profile, store, pool, signal);
          ordered = candidates.map((item) => {
            const ai = ranking.get(item.id);
            return ai ? { ...item, score: Math.round(ai.score * 0.7 + item.score * 0.3), title: ai.title || item.title, reason: ai.reason || item.reason, ai: true } : item;
          }).sort((a, b) => Number(Boolean(b.ai)) - Number(Boolean(a.ai)) || b.score - a.score);
          engine = profile.name;
        } catch (error) {
          if (signal.aborted) throw signal.reason;
          warnings.push('The selected AI model did not return a usable ranking. Local scoring was used instead.');
        }
      }
    } else if (profile?.model) warnings.push('The selected AI model needs a transcript; this source was scored locally.');
    const picks = pickMoments(ordered, options.count);
    if (!picks.length) throw new Error('No playable moment could be found in the source.');
    if (picks.length < options.count) warnings.push(`Found ${picks.length} distinct moments of ${options.count} requested. Longer sources can support more non-overlapping clips.`);
    if (options.captions && transcript.cues.length && !tools.subtitles) warnings.push('This FFmpeg build does not support burned subtitles. SRT files are still available.');
    const signals = [transcript.cues.length && 'Transcript', audio.some((db) => db > -58) && 'Audio activity', heatmap.length && 'Replay heatmap'].filter(Boolean);
    update({ status: 'rendering', progress: 62, engine, signals, captionsSource: transcript.label, warnings, detail: `Rendering 1 of ${picks.length} vertical clips.` });
    const clips = [];
    for (const [index, moment] of picks.entries()) {
      if (signal.aborted) throw signal.reason;
      const id = `clip-${index + 1}`;
      update({ detail: `Rendering ${index + 1} of ${picks.length} vertical clips.`, progress: 62 + Math.floor(index / picks.length * 35) });
      let rendered;
      try { rendered = await renderClip({ clip: moment, path, options, cues: transcript.cues, dir: join(root, id), signal, tools }); }
      catch (error) { if (signal.aborted) throw signal.reason; throw new Error('FFmpeg could not render a clip. Check free disk space and that FFmpeg includes libx264 and libass.'); }
      const { excerpt, ai, ...fields } = moment;
      clips.push({ ...fields, id, duration: Number((moment.end - moment.start).toFixed(2)), ...rendered });
      update({ clips: clips.slice() });
    }
    update({ status: 'ready', progress: 100, detail: `${clips.length} ${clips.length === 1 ? 'clip is' : 'clips are'} ready for review.`, finishedAt: new Date().toISOString() });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
