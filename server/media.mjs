import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { ROOT, ffmpeg, python, run, runYt, toolsStatus } from './tools.mjs';
import { maxSourceBytes, maxSourceSeconds, jobDir } from './store.mjs';
import { buildCandidates, clipCues, makeAss, makeSrt, normalizeCues, parseVtt, pickMoments } from './moments.mjs';
import { rankWithProvider, transcribeRemote } from './providers.mjs';
import { liveArgs, livePlans, livePlanKey } from './live.mjs';
import { exportFrame, languageCode, languageLabel } from '../shared/exports.mjs';
import { localizeClips, suggestHashtags } from './localization.mjs';

const demoImage = join(ROOT, 'public', 'images', 'demo-studio.jpg');
const demoAudio = join(ROOT, 'server', 'assets', 'demo-audio.m4a');
const captionFonts = join(ROOT, 'server', 'assets', 'fonts');
const ffmpegPath = isAbsolute(ffmpeg) ? ['--ffmpeg-location', ffmpeg] : [];
const sourceFormat = 'bv*[height<=1080]+ba/b[height<=1080]/b';

function sourceError(error) {
  const log = `${error.message}\n${error.output || ''}`;
  if (/sign in|bot|forbidden|429|403|po token/i.test(log)) return 'YouTube declined this request. This can happen on server IPs or restricted videos. Try an authorized public video or run from a different allowed network.';
  if (/not currently live|no live stream/i.test(log)) return 'This channel is not live right now. Try again during the event or use a completed replay link.';
  if (/private|copyright|geo.restrict|unavailable|members.only|login required/i.test(log)) return 'This video is unavailable or restricted. Try an authorized public source.';
  if (/not yet available|premieres in|live event will begin/i.test(log)) return 'The stream has not started yet. Try again once it is live.';
  if (/network|failed to resolve|connection|timed out|unable to download webpage/i.test(log)) return 'Could not reach YouTube from this server. Check its outbound network access.';
  if (/requested format|no video formats|only images/i.test(log)) return 'No downloadable video format was offered. Try another authorized video or wait for the replay.';
  return 'Could not read this YouTube source. Check the URL and try updating yt-dlp with npm run setup.';
}

async function getMetadata(url, signal, extended = false) {
  try {
    const result = await runYt(['--skip-download', '--ignore-no-formats-error', '--dump-single-json', '--no-warnings', ...(extended ? ['--extractor-args', 'youtube:formats=incomplete'] : []), '--', url], { signal, timeout: 90_000, maxOutput: 25 * 1024 * 1024 });
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
  let checking;
  const checkSize = async () => {
    if (ctrl.signal.aborted) return;
    checking ||= (async () => {
      const files = await readdir(dir);
      let size = 0;
      for (const file of files) size += (await stat(join(dir, file)).catch(() => ({ size: 0 }))).size;
      if (size > maxSourceBytes) ctrl.abort(new Error('The source exceeded this workspace’s download size limit.'));
    })().finally(() => { checking = null; });
    await checking;
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

// Use one rendition of each type before trying additional resolutions on the same transport.
function variedPlans(plans, attempted) {
  const distinct = new Set(attempted), primary = new Map(), secondary = [];
  for (const plan of plans) {
    const key = livePlanKey(plan);
    if (distinct.has(key)) continue;
    distinct.add(key);
    if (!primary.has(plan.type)) primary.set(plan.type, plan);
    else secondary.push(plan);
  }
  return [...primary.values(), ...secondary];
}

async function captureLive(meta, options, scratch, session, progress, update) {
  const video = join(scratch, 'capture.mkv');
  const duration = Math.min(options.liveMinutes * 60, maxSourceSeconds);
  const size = withSizeLimit(scratch, session.signal);
  const attempted = new Set();
  let rejected;
  async function attempt(plan) {
    attempted.add(livePlanKey(plan));
    await rm(video, { force: true });
    update({ capturedSeconds: 0, detail: `Recording from the live edge · ${plan.label}.` });
    let mediaSeconds = 0, lastMedia = Date.now(), watchdog, hardStop, pending = '', finishedEarly = false;
    try {
      await run(ffmpeg, liveArgs(plan, duration, video, maxSourceBytes), {
        signal: size.signal, timeout: (duration + 70) * 1000,
        onChild: (stop) => {
          function requestStop() {
            session.finishCapture = null;
            clearInterval(watchdog);
            stop('SIGINT');
            hardStop = setTimeout(() => stop('SIGKILL'), 4500).unref();
          }
          session.finishCapture = () => { finishedEarly = true; requestStop(); };
          watchdog = setInterval(() => { if (Date.now() - lastMedia >= 38_000) requestStop(); }, 2000).unref();
        },
        onData: (buffer) => {
          const received = (pending + buffer.toString()).split('\n');
          pending = received.pop().slice(-300);
          for (const line of received) {
            const found = line.match(/^out_time_us=(\d+)\s*$/);
            if (!found) continue;
            const seconds = Math.min(duration, Number(found[1]) / 1_000_000);
            if (seconds <= mediaSeconds) continue;
            mediaSeconds = seconds;
            lastMedia = Date.now();
            progress(Math.min(39, 9 + mediaSeconds / duration * 30), { capturedSeconds: Math.floor(mediaSeconds) });
          }
        },
      });
    } catch (error) {
      if (/403|429|forbidden|not authorized/i.test(error.output || '')) rejected = true;
    } finally { session.finishCapture = null; clearInterval(watchdog); clearTimeout(hardStop); }
    await size.check();
    if (size.signal.aborted) throw size.signal.reason;
    if ((await stat(video).catch(() => null))?.size > 0) {
      try {
        const probe = await audioProfile(video, size.signal);
        // Finish-capture is intentionally an interrupt. The written file is usable if it has enough media.
        if ((probe.duration || mediaSeconds) >= 6) {
          update({ capturedSeconds: Math.floor(Math.min(duration, probe.duration || mediaSeconds)) });
          return { path: video, duration: Math.min(duration, probe.duration || mediaSeconds), profile: probe, inputFormat: plan.label };
        }
      } catch (error) { if (size.signal.aborted) throw error; }
    }
    if (finishedEarly) throw new Error('The saved live window was too short or could not be read. Retry and let it record for longer.');
    return null;
  }
  async function tryPlans(plans, limit) {
    for (const plan of variedPlans(plans, attempted).slice(0, limit)) {
      const captured = await attempt(plan);
      if (captured) return captured;
    }
    return null;
  }
  try {
    let plans = livePlans(meta);
    const standard = await tryPlans(plans.filter((plan) => !plan.silent), 3);
    if (standard) return standard;
    // yt-dlp omits some live DASH manifests from its default list. Request the expanded
    // public list only if needed; this does not enable missing-auth or protected formats.
    update({ detail: 'Looking for alternate public live formats.' });
    try {
      const expanded = livePlans(await getMetadata(options.url, size.signal, true));
      plans = [...expanded.filter((plan) => plan.type === 'dash'), ...expanded.filter((plan) => plan.type !== 'dash'), ...plans];
    } catch (error) { if (size.signal.aborted) throw error; if (/declined/i.test(error.message)) rejected = true; }
    const alternate = await tryPlans(plans.filter((plan) => !plan.silent), 3);
    if (alternate) return alternate;
    const silent = await tryPlans(plans.filter((plan) => plan.silent), 1);
    if (silent) return silent;
    if (rejected) throw new Error('YouTube declined the public live media requests from this host. Check the stream is public and authorized and try again from an allowed network.');
    if (!attempted.size) throw new Error('YouTube did not expose a capturable public HLS or DASH stream. Update yt-dlp (npm run setup), confirm the broadcast is public and still live, or use its replay when ready.');
    throw new Error('The available live formats could not produce six seconds of playable video. Confirm the stream is still live, check this host’s access to YouTube, and retry.');
  } finally { size.done(); }
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

function sourceLanguage(meta) {
  const original = Object.keys(meta?.automatic_captions || {}).find((key) => key.endsWith('-orig'));
  const originalAudio = Array.isArray(meta?.formats) && meta.formats.find((format) => format?.language_preference === 10 && format.language);
  return languageCode(original) || languageCode(meta?.language) || languageCode(originalAudio?.language);
}

function captionLocale(meta, target) {
  const safe = (key) => /^[\w-]{1,30}$/.test(key) && key !== 'live_chat';
  const manual = Object.keys(meta.subtitles || {}).filter(safe);
  const automatic = Object.keys(meta.automatic_captions || {}).filter(safe);
  const desired = target || sourceLanguage(meta);
  if (desired) {
    for (const choices of [manual, automatic]) {
      const match = [`${desired}-orig`, desired, ...choices].find((key) => choices.includes(key) && languageCode(key) === desired);
      if (match) return match;
    }
    return null;
  }
  return manual.find((key) => key === 'en') || manual[0] || (automatic.includes('en') && automatic.length < 5 ? 'en' : null);
}

async function downloadCaptions(meta, url, scratch, signal, target) {
  const locale = captionLocale(meta, target);
  if (!locale) return null;
  const prefix = target ? 'translated' : 'transcript';
  try {
    await runYt(['--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', `^${locale}$`, '--sub-format', 'vtt', '--no-warnings', '-o', join(scratch, `${prefix}.%(ext)s`), '--', url], { signal, timeout: 90_000 });
    const file = (await readdir(scratch)).find((name) => name.startsWith(`${prefix}.`) && name.endsWith('.vtt'));
    if (file) {
      const cues = parseVtt(await readFile(join(scratch, file), 'utf8'));
      if (cues.length) return { cues, language: languageCode(locale), label: 'YouTube transcript' };
    }
  } catch (error) { if (signal.aborted) throw signal.reason; }
  return null;
}

async function runWhisper(path, signal, english = false) {
  const res = await run(python, [join(ROOT, 'scripts', 'transcribe.py'), path, ...(english ? ['--translate'] : [])], { signal, timeout: 2 * 60 * 60_000, maxOutput: 24 * 1024 * 1024 });
  const result = JSON.parse(res.out.trim().split('\n').at(-1));
  return { cues: normalizeCues(result.cues), language: languageCode(result.language), label: english ? 'Local Whisper translation' : 'Local Whisper' };
}

async function findTranscript({ meta, options, source, scratch, store, tools, signal, audio }) {
  if (meta && !meta.is_live && meta.live_status !== 'is_live') {
    const track = await downloadCaptions(meta, options.url, scratch, signal);
    if (track) return track;
  }
  if (!audio.some((db) => db > -58)) return { cues: [], label: 'No speech detected' };
  const choice = store.state.captions;
  const profile = store.state.providers.find((p) => p.id === choice.providerId);
  let warning;
  if (profile && choice.model) {
    try {
      const chunkSeconds = 600;
      await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', '-f', 'segment', '-segment_time', String(chunkSeconds), join(scratch, 'audio-%04d.mp3')], { signal, timeout: 12 * 60_000 });
      const parts = (await readdir(scratch)).filter((name) => /^audio-\d+\.mp3$/.test(name)).sort().map((name) => join(scratch, name));
      const result = await transcribeRemote(profile, store, choice.model, parts, chunkSeconds, signal);
      const cues = normalizeCues(result.cues);
      if (cues.length) return { cues, language: result.language || sourceLanguage(meta), label: profile.name };
      warning = 'The transcription provider found no timestamped dialogue.';
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      warning = 'The configured transcription provider could not return timestamped captions.';
    }
  }
  if (tools.whisper) {
    try {
      const result = await runWhisper(source, signal);
      return result.cues.length ? result : { cues: [], label: 'No speech detected' };
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      warning = 'Whisper could not transcribe this source. Check model downloads and setup, or use a transcription provider.';
    }
  }
  return { cues: [], label: 'Unavailable', warning: warning || 'No source captions were available. Install local Whisper or configure a transcription provider to generate them.' };
}

async function renderClip({ clip, path, options, rows, language, frame, dir, scratch, signal, tools }) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const { width, height } = frame;
  const mini = (n) => Math.max(2, 2 * Math.floor(n / 8));
  const small = `${mini(width)}:${mini(height)}`;
  const poster = `${Math.max(2, 2 * Math.floor(width / 4))}:${Math.max(2, 2 * Math.floor(height / 4))}`;
  if (rows.length) {
    await writeFile(join(dir, 'captions.srt'), makeSrt(rows));
    if (tools.subtitles) await writeFile(join(scratch, 'clip.ass'), makeAss(rows, frame, language));
  }
  const filter = [
    '[0:v]split=2[back][front]',
    `[back]scale=${small}:force_original_aspect_ratio=increase,crop=${small},gblur=sigma=9,eq=brightness=-0.15:saturation=0.8,scale=${width}:${height}[bg]`,
    `[front]scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1${rows.length && tools.subtitles ? ',ass=clip.ass:fontsdir=caption-fonts' : ''}[out]`,
  ].join(';');
  const start = clip.start.toFixed(3);
  const input = options.demo ? ['-loop', '1', '-framerate', '24', '-i', demoImage, '-ss', start, '-i', demoAudio] : ['-ss', start, '-i', path];
  let missingGlyphs = false;
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'warning', '-y', '-filter_complex_threads', '2', ...input, '-t', (clip.end - clip.start).toFixed(3),
    '-filter_complex', filter, '-map', '[out]', '-map', options.demo ? '1:a:0' : '0:a:0?', '-map_metadata', '-1', '-r', '24', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '23',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', join(dir, 'video.mp4')], { cwd: scratch, signal, timeout: 6 * 60_000,
    onLog(log) { if (/failed to find any fallback with glyph/i.test(log)) missingGlyphs = true; },
  });
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '0.8', '-i', 'video.mp4', '-frames:v', '1', '-vf', `scale=${poster}`, '-threads', '2', '-q:v', '4', 'poster.jpg'], { cwd: dir, signal, timeout: 28_000 }).catch(() => {});
  return { withCaptions: rows.length > 0, burnedCaptions: rows.length > 0 && tools.subtitles, withPoster: existsSync(join(dir, 'poster.jpg')), missingGlyphs };
}

export async function processProject(job, store, session, update) {
  const { options } = job;
  const frame = exportFrame(options);
  const { signal } = session;
  const tools = await toolsStatus();
  if (!tools.ffmpeg) throw new Error('FFmpeg is not installed. Follow the Setup guide and restart the server.');
  if (!options.demo && !tools.ytDlp) throw new Error('yt-dlp is not installed. Run npm run setup, then restart the server.');
  const root = jobDir(job.id);
  const scratch = join(root, 'work');
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  let path, duration, meta, probed, audio = [], transcript = { cues: [], label: 'Off' }, isLive = false, lastProgress = 0;
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
      transcript = { cues: fixture.cues, language: 'en', label: 'Sample transcript' };
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
        const capture = await captureLive(meta, options, scratch, session, progress, update);
        ({ path, duration, profile: probed } = capture);
        update({ liveInput: capture.inputFormat });
      } else {
        update({ ...common, status: 'downloading', progress: 9, detail: 'Downloading an authorized copy of the source.' });
        path = await downloadSource(options, scratch, signal, progress);
      }
      update({ status: 'analyzing', progress: 41, detail: 'Measuring audio activity and looking for captions.' });
      const prof = probed || await audioProfile(path, signal);
      audio = prof.audio;
      duration = isLive ? duration : prof.duration || Number(meta.duration);
      if (!Number.isFinite(duration) || duration < 6) throw new Error('At least six seconds of playable video are needed to make a clip.');
      if (duration > maxSourceSeconds + 10) throw new Error('This source exceeded the configured duration limit.');
      update({ duration, progress: 48, detail: 'Reading the source transcript or transcribing speech.' });
      transcript = await findTranscript({ meta, options, source: path, scratch, store, tools, signal, audio });
    }
    const warnings = [];
    if (isLive && !audio.length) warnings.push('The live window had no audio track. Clips can still be exported without spoken captions.');
    const heatmap = !isLive && Array.isArray(meta?.heatmap) ? meta.heatmap : [];
    const candidates = buildCandidates({ duration, count: options.count, cues: transcript.cues, audio, heatmap });
    const activeProvider = store.state.providers.find((p) => p.id === store.state.activeProviderId);
    const profile = !options.demo && activeProvider;
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
    const originalRows = options.captions ? picks.map((moment) => clipCues(transcript.cues, moment.start, moment.end)) : picks.map(() => []);
    const asTracks = (result) => result && { tracks: picks.map((moment) => clipCues(result.cues, moment.start, moment.end)), label: result.label };
    let localized = { tracks: originalRows, language: transcript.language || null };
    const target = options.captionLanguage;
    if (options.captions && target && target !== 'source' && target !== transcript.language) {
      update({ progress: 60, detail: `Preparing ${languageLabel(target)} captions.` });
      localized = await localizeClips({ original: originalRows, sourceLanguage: transcript.language, target, provider: profile, store, signal,
        tryTrack: async () => {
          if (options.demo) {
            const translations = JSON.parse(await readFile(join(ROOT, 'server', 'assets', 'demo-translations.json'), 'utf8'));
            const translated = translations[target];
            return translated?.length === transcript.cues.length ? asTracks({ cues: transcript.cues.map((row, i) => ({ ...row, text: translated[i] })), label: 'Bundled translation' }) : null;
          }
          return isLive ? null : asTracks(await downloadCaptions(meta, options.url, scratch, signal, target));
        },
        tryEnglish: path && tools.whisper && audio.some((db) => db > -58) ? async () => {
          try { return asTracks(await runWhisper(path, signal, true)); }
          catch (error) { if (signal.aborted) throw signal.reason; return null; }
        } : null,
      });
    }
    const anyCaptions = localized.tracks.some((rows) => rows.length);
    if (localized.warning) warnings.push(options.demo ? 'The demo includes English, Urdu and Spanish caption tracks. Original English captions were used.' : localized.warning);
    if (options.captions && !anyCaptions && !localized.warning && (!isLive || audio.length)) warnings.push(transcript.warning || 'No usable spoken captions were available for these clips.');
    if (anyCaptions && !tools.subtitles) warnings.push('This FFmpeg build does not support burned subtitles. SRT files are still available.');
    if (anyCaptions && tools.subtitles) await cp(captionFonts, join(scratch, 'caption-fonts'), { recursive: true });
    const signals = [transcript.cues.length && 'Transcript', audio.some((db) => db > -58) && 'Audio activity', heatmap.length && 'Replay heatmap'].filter(Boolean);
    update({ status: 'rendering', progress: 62, engine, signals, frame, captionsSource: localized.label || transcript.label, warnings, detail: `Rendering 1 of ${picks.length} clips in ${frame.ratio}.` });
    const clips = [];
    const fontWarning = 'Some caption characters could not be drawn. Install fonts for the caption language and rerun the project. The SRT contains the full text.';
    for (const [index, moment] of picks.entries()) {
      if (signal.aborted) throw signal.reason;
      const id = `clip-${index + 1}`;
      const rows = localized.tracks[index];
      update({ detail: `Rendering ${index + 1} of ${picks.length} clips in ${frame.ratio}.`, progress: 62 + Math.floor(index / picks.length * 35) });
      let rendered;
      try { rendered = await renderClip({ clip: moment, path, options, rows, language: localized.language, frame, dir: join(root, id), scratch, signal, tools }); }
      catch (error) { if (signal.aborted) throw signal.reason; throw new Error('FFmpeg could not render a clip. Check free disk space and that FFmpeg includes libx264 and libass.'); }
      const { excerpt, ai, ...fields } = moment;
      const hashtags = suggestHashtags({ choice: options.hashtagLanguage, transcriptLanguage: transcript.language || sourceLanguage(meta), localizedLanguage: localized.language, excerpt, translated: rows.map((row) => row.text).join(' '), live: isLive });
      const { missingGlyphs, ...assets } = rendered;
      if (missingGlyphs && !warnings.includes(fontWarning)) warnings.push(fontWarning);
      clips.push({ ...fields, id, duration: Number((moment.end - moment.start).toFixed(2)), captionLanguage: rows.length ? localized.language : null, ...hashtags, ...assets });
      update({ clips: clips.slice(), warnings: warnings.slice() });
    }
    update({ status: 'ready', progress: 100, detail: `${clips.length} ${clips.length === 1 ? 'clip is' : 'clips are'} ready for review.`, finishedAt: new Date().toISOString() });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
