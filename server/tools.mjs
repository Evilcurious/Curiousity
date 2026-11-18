import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..');
const venv = (name) => resolve(ROOT, '.venv', 'bin', name);
export const ffmpeg = process.env.FFMPEG_BIN || (existsSync(venv('ffmpeg')) ? venv('ffmpeg') : 'ffmpeg');
export const python = process.env.PYTHON_BIN || (existsSync(venv('python')) ? venv('python') : process.env.PYTHON || 'python3');
export const yt = process.env.YTDLP_BIN ? [process.env.YTDLP_BIN, []] : [python, ['-m', 'yt_dlp']];

export function run(command, args, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const { signal, timeout = 120_000, cwd, onData, onLog, onChild, maxOutput = 1024 * 1024 } = opts;
    if (signal?.aborted) return reject(signal.reason);
    const grouped = process.platform !== 'win32';
    const proc = spawn(command, args, { cwd, detached: grouped, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '', limitError, callbackError;
    const stop = (s = 'SIGINT') => {
      if (proc.exitCode !== null || proc.signalCode || !proc.pid) return;
      try { if (grouped) process.kill(-proc.pid, s); else proc.kill(s); } catch { /* Already exited. */ }
    };
    const report = (callback, value) => {
      if (!callback || callbackError) return;
      try { callback(value); }
      catch (error) { callbackError = error; stop('SIGKILL'); }
    };
    const abort = () => stop('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { limitError = new Error('The media tool timed out.'); stop('SIGKILL'); }, timeout);
    timer.unref();
    proc.stdout.on('data', (chunk) => {
      if (onData) report(onData, chunk);
      else {
        out += chunk.toString();
        if (out.length > maxOutput) { limitError = new Error('The media tool returned too much data.'); stop('SIGKILL'); }
      }
    });
    proc.stderr.on('data', (chunk) => {
      const line = chunk.toString();
      err = (err + line).slice(-12_000);
      report(onLog, line);
    });
    const dispose = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    proc.on('error', (error) => { dispose(); reject(error); });
    proc.on('close', (code) => {
      dispose();
      if (signal?.aborted) return reject(signal.reason);
      if (callbackError) return reject(callbackError);
      if (limitError) return reject(limitError);
      if (code !== 0) return reject(Object.assign(new Error(`Media tool exited with code ${code}.`), { output: `${out.slice(-3000)}\n${err}` }));
      resolvePromise({ out, err });
    });
    onChild?.(stop);
  });
}

export const runYt = (args, opts) => run(yt[0], [...yt[1], '--ignore-config', '--no-playlist', '--js-runtimes', 'node', '--socket-timeout', '15', '--retries', '2', '--fragment-retries', '2', ...args], opts);

let check, checkAt = 0;
export async function toolsStatus() {
  if (!check || Date.now() - checkAt > 35_000) {
    checkAt = Date.now();
    const verify = (command, args) => run(command, args, { timeout: 7000 }).catch(() => null);
    check = Promise.all([
      verify(ffmpeg, ['-hide_banner', '-filters']),
      verify(yt[0], [...yt[1], '--version']),
      verify(python, ['-c', 'from importlib.util import find_spec; raise SystemExit(0 if find_spec("faster_whisper") else 1)']),
    ]).then(([media, downloader, whisper]) => ({ ffmpeg: Boolean(media), subtitles: Boolean(media && /\bass\s+V->V/.test(media.out)), ytDlp: Boolean(downloader), whisper: Boolean(whisper) }));
  }
  return check;
}
