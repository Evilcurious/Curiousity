import { join } from 'node:path';
import { ROOT, python, run } from './tools.mjs';
import { normalizeCues } from './moments.mjs';
import { languageCode } from '../shared/exports.mjs';

export async function runWhisper(path, signal, english = false, { chunkSeconds, timeout = 2 * 60 * 60_000, onProgress } = {}) {
  const args = [join(ROOT, 'scripts', 'transcribe.py'), path, ...(english ? ['--translate'] : []), ...(chunkSeconds ? ['--chunks', String(chunkSeconds)] : [])];
  let pending = '';
  const res = await run(python, args, { signal, timeout, maxOutput: 24 * 1024 * 1024, onLog: onProgress && ((chunk) => {
    const lines = (pending + chunk).split('\n'); pending = lines.pop().slice(-240);
    for (const line of lines) {
      const match = /^CF_TRANSCRIBE (\d+) (\d+)$/.exec(line.trim());
      if (match) onProgress(Number(match[1]), Number(match[2]));
    }
  }) });
  const result = JSON.parse(res.out.trim().split('\n').at(-1));
  return { cues: normalizeCues(result.cues), language: languageCode(result.language), label: english ? 'Local Whisper translation' : 'Local Whisper' };
}
