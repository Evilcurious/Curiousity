import { join } from 'node:path';
import { ROOT, python, run } from './tools.mjs';
import { normalizeCues } from './moments.mjs';
import { languageCode } from '../shared/exports.mjs';

export async function runWhisper(path, signal, english = false, { chunkSeconds, timeout = 2 * 60 * 60_000 } = {}) {
  const args = [join(ROOT, 'scripts', 'transcribe.py'), path, ...(english ? ['--translate'] : []), ...(chunkSeconds ? ['--chunks', String(chunkSeconds)] : [])];
  const res = await run(python, args, { signal, timeout, maxOutput: 24 * 1024 * 1024 });
  const result = JSON.parse(res.out.trim().split('\n').at(-1));
  return { cues: normalizeCues(result.cues), language: languageCode(result.language), label: english ? 'Local Whisper translation' : 'Local Whisper' };
}
