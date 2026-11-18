import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boundedEnv, jobDir } from './store.mjs';
import { ROOT, ffmpeg, run, toolsStatus } from './tools.mjs';
import { clipCues, normalizeCues } from './moments.mjs';
import { makeAss, makeSrt } from './captions.mjs';
import { compatibleProvider, transcribeRemote } from './providers.mjs';
import { runWhisper } from './transcription.mjs';

export const isCaptionJob = (job) => job.kind === 'captions';
export const captionInputPath = (id) => join(jobDir(id), 'input.video');
export const captionFiles = new Set(['video.mp4', 'captions.srt']);
const chunkSeconds = 600;
const taskTimeout = boundedEnv('CAPTION_TASK_MINUTES', 240, 1, 1440) * 60_000;
const fonts = join(ROOT, 'server', 'assets', 'fonts');
const common = ['-hide_banner', '-nostdin', '-y', '-filter_threads', '2'];
// Uploads are files, not playlists. Keep network protocols and demuxers that
// follow arbitrary file/URL references away from user-provided inputs. The MOV
// demuxer’s external data references are off by default (never enabled here).
const inputArgs = (path) => ['-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm,avi', '-threads', '2', '-i', path];

export function captionJobPublic(job) {
  const base = `/api/captions/${job.id}`;
  const { id, title, status, progress, detail, error, frame, duration, style, renderedStyle, captionCount, language, engine, warnings, createdAt, updatedAt } = job;
  return { id, title, status, progress, detail, error, frame, duration, style, renderedStyle, captionCount, language, engine, warnings, createdAt, updatedAt,
    videoUrl: job.renderVersion ? `${base}/video.mp4?v=${job.renderVersion}` : null, captionsUrl: job.trackReady ? `${base}/captions.srt` : null };
}

async function probe(source, signal) {
  let duration = null, frame, hasAudio = false, pending = '';
  await run(ffmpeg, [...common, '-loglevel', 'info', ...inputArgs(source), '-map', '0:V:0', '-vf', 'showinfo', '-frames:v', '1', '-an', '-sn', '-dn', '-f', 'null', '-'], {
    signal, timeout: 35_000,
    onLog(chunk) {
      const lines = (pending + chunk).split(/[\r\n]/);
      pending = lines.pop().slice(-2400);
      for (const line of lines) {
        const found = line.match(/^  Duration: (\d+):(\d{2}):(\d{2}\.\d+)/);
        if (found && duration === null) duration = Number(found[1]) * 3600 + Number(found[2]) * 60 + Number(found[3]);
        if (/^  Stream #0:\d+(?:\[[^\]]+\])?(?:\([^)]*\))?: Audio:/.test(line)) hasAudio = true;
        const size = line.match(/^\[Parsed_showinfo_.*?\]\s+n:\s*0\s.*?\bsar:(\d+)\/(\d+)\s+s:(\d+)x(\d+)/);
        if (size && !frame) {
          const [, num, den, w, h] = size.map(Number);
          const width = w * (num && den ? num / den : 1), height = h;
          const factor = Math.min(1, 1920 / Math.max(width, height));
          const even = (n) => Math.max(2, 2 * Math.round(n * factor / 2));
          frame = { width: even(width), height: even(height) };
        }
      }
    },
  });
  if (!frame) throw new Error('No decodable video stream.');
  return { duration: Number.isFinite(duration) && duration > 0 ? duration : null, frame, hasAudio };
}

function mediaError(error, fallback) {
  if (['ENOSPC', 'EDQUOT'].includes(error.code) || /No space left on device|Disk quota exceeded/i.test(error.output || '')) return new Error('The server ran out of space while processing this video. Free disk space and try again.');
  if (error.message === 'The media tool timed out.') return new Error('Video processing timed out on this server. Try a shorter video or increase the processing timeout.');
  return new Error(fallback);
}

function encodeProgress(duration, update) {
  let pending = '', lastAt = 0, lastValue = 64;
  return (chunk) => {
    if (!duration) return;
    const lines = (pending + chunk.toString()).split('\n');
    pending = lines.pop().slice(-256);
    for (const line of lines) {
      const match = /^out_time_us=(\d+)/.exec(line);
      if (!match) continue;
      const next = Math.min(99, Math.floor(65 + Number(match[1]) / 1_000_000 / duration * 34));
      if (next > lastValue && Date.now() - lastAt >= 1500) {
        lastAt = Date.now(); lastValue = next; update({ progress: next });
      }
    }
  };
}

export async function processCaptionJob(job, store, { signal }, update) {
  const dir = jobDir(job.id), scratch = join(dir, 'work'), source = captionInputPath(job.id);
  const tools = await toolsStatus();
  const style = job.style;
  try {
    await mkdir(scratch, { recursive: true, mode: 0o700 });
    if (!tools.ffmpeg) throw new Error('Install FFmpeg on this server using the Setup guide.');
    let { duration, frame, language } = job, rows;
    if (!job.trackReady) {
      update({ status: 'analyzing', progress: 7, detail: 'Checking the uploaded video.' });
      let info;
      try { info = await probe(source, signal); }
      catch (error) { signal.throwIfAborted(); throw mediaError(error, 'Could not read this video. Upload a playable MP4, MOV, WebM, MKV or AVI file.'); }
      ({ duration, frame } = info);
      if (!info.hasAudio) throw new Error('This video has no audio track to transcribe.');
      update({ duration, frame, progress: 16, detail: 'Preparing audio for transcription.' });
      try {
        await run(ffmpeg, [...common, '-loglevel', 'error', ...inputArgs(source), '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1',
          '-ac', '1', '-ar', '16000', '-af', 'aresample=async=1:first_pts=0', '-c:a', 'libmp3lame', '-b:a', '48k', '-f', 'segment', '-segment_time', String(chunkSeconds), '-reset_timestamps', '1', join(scratch, 'audio-%06d.mp3')], { signal, timeout: taskTimeout });
      } catch (error) { signal.throwIfAborted(); throw mediaError(error, 'FFmpeg could not read the audio track. Try a video with a supported audio codec.'); }
      const parts = (await readdir(scratch)).filter((file) => /^audio-\d+\.mp3$/.test(file)).sort().map((file) => join(scratch, file));
      if (!parts.length) throw new Error('No playable audio was found in this video.');
      const choice = job.captionEngine;
      const profile = choice && store.state.providers.find((item) => item.id === choice.providerId && item.type === choice.type && item.baseUrl === choice.baseUrl);
      if (choice && !compatibleProvider(profile)) throw new Error('The selected transcription provider changed. Choose a caption engine in Settings and start a new upload.');
      const engine = profile ? profile.name : 'Local Whisper';
      update({ engine, progress: 28, detail: profile ? `Transcribing audio with ${profile.name}.` : 'Transcribing speech locally with Whisper.' });
      let track;
      if (profile) {
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(taskTimeout)]);
        const result = await transcribeRemote({ ...profile }, store, choice.model, parts, chunkSeconds, deadline);
        track = { cues: normalizeCues(result.cues), language: result.language };
      } else {
        if (!tools.whisper) throw new Error('Install local Whisper or select a compatible transcription provider in AI provider settings.');
        try { track = await runWhisper(scratch, signal, false, { chunkSeconds, timeout: taskTimeout }); }
        catch (error) { signal.throwIfAborted(); throw mediaError(error, 'Local Whisper could not transcribe the audio. Check model downloads and Setup, or select a timestamped transcription provider.'); }
      }
      signal.throwIfAborted();
      rows = clipCues(track.cues, 0, duration ?? Infinity);
      language = track.language;
      if (!rows.length) throw new Error('No timestamped speech was found. Choose a video with clear dialogue.');
      await writeFile(join(dir, 'cues.json'), JSON.stringify(rows), { mode: 0o600 });
      await writeFile(join(dir, 'captions.srt'), makeSrt(rows), { mode: 0o600 });
      update({ trackReady: true, captionCount: rows.length, language, progress: 61 });
    } else {
      rows = JSON.parse(await readFile(join(dir, 'cues.json'), 'utf8'));
    }
    if (!tools.subtitles) {
      update({ status: 'ready', progress: 100, detail: 'SRT ready. Install FFmpeg with libass to render a styled MP4.' });
      return;
    }
    signal.throwIfAborted();
    update({ status: 'rendering', progress: 64, detail: 'Burning the selected style into the full video.' });
    await cp(fonts, join(scratch, 'fonts'), { recursive: true });
    await writeFile(join(scratch, 'captions.ass'), makeAss(rows, frame, language, style), { mode: 0o600 });
    let missingGlyphs = false;
    const output = join(scratch, 'render.mp4');
    try {
      await run(ffmpeg, [...common, '-loglevel', 'warning', ...inputArgs(source), '-map', '0:V:0', '-map', '0:a:0?', '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1',
        '-vf', `scale=${frame.width}:${frame.height},setsar=1,ass=captions.ass:fontsdir=fonts`, '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-ac', '2', '-b:a', '128k', '-movflags', '+faststart', '-progress', 'pipe:1', output], {
        cwd: scratch, signal, timeout: taskTimeout, onData: encodeProgress(duration, update), onLog: (chunk) => { if (/failed to find any fallback with glyph/i.test(chunk)) missingGlyphs = true; },
      });
      if (!(await stat(output)).size) throw new Error('Missing output.');
      signal.throwIfAborted();
      await rename(output, join(dir, 'video.mp4'));
    } catch (error) { signal.throwIfAborted(); throw mediaError(error, 'FFmpeg could not render this video. Check that it includes libx264 and libass, and check free disk space.'); }
    update({ status: 'ready', progress: 100, renderedStyle: style, renderVersion: randomUUID(), detail: 'Your captioned MP4 and plain SRT are ready.',
      warnings: missingGlyphs ? ['Some characters could not be drawn. Install fonts for the caption language on the server. The SRT contains the full text.'] : [] });
  } catch (error) {
    if (['ENOSPC', 'EDQUOT'].includes(error.code)) throw mediaError(error);
    if (error.name === 'TimeoutError') throw new Error('Transcription timed out. Try a shorter video or increase the processing timeout.');
    throw error;
  } finally {
    // Preserve inputs only when there is a reusable transcript. Never keep
    // large failed, unsupported or cancelled first uploads on disk.
    await rm(job.trackReady ? scratch : dir, { recursive: true, force: true });
  }
}
