const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const mean = (items) => items.reduce((sum, n) => sum + n, 0) / (items.length || 1);
const overlap = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

export function normalizeCues(raw) {
  return (Array.isArray(raw) ? raw : []).flatMap((item) => {
    if (!item) return [];
    const start = Number(item.start), end = Number(item.end), text = clean(item.text);
    return Number.isFinite(start) && Number.isFinite(end) && end > Math.max(0, start) && text
      ? [{ start: Math.max(0, start), end, text: text.slice(0, 300) }] : [];
  }).sort((a, b) => a.start - b.start);
}

export function parseVtt(input) {
  const seconds = (stamp) => stamp.split(':').reduce((total, part) => total * 60 + Number(part.replace(',', '.')), 0);
  const transcript = [];
  const blocks = input.replace(/\r/g, '').split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const index = lines.findIndex((line) => line.includes(' --> '));
    if (index < 0) continue;
    const [from, to] = lines[index].split(' --> ');
    let text = lines.slice(index + 1).join(' ').replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (key) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ' })[key]);
    text = clean(text);
    const start = seconds(from.trim()), end = seconds(to.trim().split(/\s/)[0]);
    const last = transcript.at(-1);
    if (last?.text === text && start - last.end < 0.6) { last.end = Math.max(last.end, end); continue; }
    if (last && start < last.end && text.startsWith(`${last.text} `)) text = text.slice(last.text.length + 1);
    if (last && start < last.end && start > last.start && start < end) last.end = start;
    transcript.push({ start, end, text });
  }
  return normalizeCues(transcript);
}

export function buildCandidates({ duration, count, cues = [], audio = [], heatmap = [] }) {
  if (!Number.isFinite(duration) || duration < 6) return [];
  const length = Math.min(duration, clamp((duration / count) * 0.88, 8, 42));
  const step = Math.max(3, length * 0.38, duration / 550);
  const starts = [];
  for (let start = 0; start <= duration - length; start += step) starts.push(start);
  if (duration - length - (starts.at(-1) ?? 0) > 0.75) starts.push(duration - length);
  // Include evenly spaced starts for short sources that cannot fill all requested slots at full length.
  const desired = Math.min(count, Math.floor(duration / 8) || 1);
  if (desired > 1) for (let i = 0; i < desired; i++) starts.push(i * (duration - length) / (desired - 1));
  const peaks = heatmap.filter((h) => Number.isFinite(h.start_time) && Number.isFinite(h.end_time) && Number.isFinite(h.value))
    .map((h) => ({ start: h.start_time, end: h.end_time, value: clamp(h.value, 0, 1) }));
  const sortedAudio = audio.slice().sort((a, b) => a - b);
  const reference = sortedAudio[Math.floor((sortedAudio.length - 1) * 0.58)] ?? -34;
  const seen = new Set();
  return starts.flatMap((guess, index) => {
    const candidateCue = cues.find((cue) => Math.abs(cue.start - guess) <= 1.5 && cue.start + length * 0.75 <= duration);
    const start = Math.round(clamp(candidateCue ? candidateCue.start - 0.17 : guess, 0, duration - Math.min(6, length)) * 100) / 100;
    if (seen.has(start)) return [];
    seen.add(start);
    let end = Math.min(duration, start + length);
    const endCue = cues.filter((cue) => Math.abs(cue.end - end) < Math.min(2.5, length * 0.15)).at(-1);
    if (endCue) end = Math.min(duration, endCue.end + 0.15);
    end = Math.round(end * 100) / 100;
    const window = { start, end };
    const excerpt = clean(cues.filter((cue) => overlap(cue, window) > 0.12).map((cue) => cue.text).join(' '));
    const samples = audio.slice(Math.floor(start), Math.ceil(end));
    const active = samples.filter((level) => level > -44);
    const energy = samples.length ? clamp((mean(active) - reference + 3) / 16, 0, 1) * (active.length / samples.length) : 0;
    const replay = peaks.length ? clamp(peaks.reduce((sum, p) => sum + overlap(window, p) * p.value, 0) / (end - start), 0, 1) : 0;
    const hook = /\b(here(?:'s| is) (?:why|how|what)|the reason|what if|the secret|never|actually|imagine|turns out|wait|but|mistake|surpris\w*|instead)\b|[?!]/i.test(excerpt.slice(0, 210));
    const pace = clamp(excerpt.split(/\s+/).filter(Boolean).length / ((end - start) * 2.3), 0, 1);
    const score = Math.round(45 + (peaks.length ? 25 * replay + 11 * energy : 20 * energy) + 14 * pace + (hook ? 8 : 0));
    const reason = replay > 0.45 ? 'This section shows stronger replay interest in YouTube’s heatmap.' : hook ? 'The transcript suggests a hook that could work on its own.' : energy > 0.34 ? 'Audio activity is higher than the surrounding recording.' : excerpt ? 'This section has enough dialogue to stand as a clip.' : 'A time-based candidate. No transcript or strong engagement signal was available here.';
    const firstLine = excerpt.split(/(?<=[.!?])\s/)[0];
    const title = firstLine
      ? firstLine.length > 64 ? `${firstLine.slice(0, 61).replace(/\s+\S*$/, '')}…` : firstLine.replace(/[.!]$/, '')
      : `Highlight at ${timeLabel(start)}`;
    return [{ id: `m${index + 1}`, start, end, excerpt, score: clamp(score, 0, 100), title, reason }];
  }).sort((a, b) => b.score - a.score || a.start - b.start);
}

export function pickMoments(ranked, count) {
  const picked = [];
  for (const item of ranked) {
    if (picked.length >= count) break;
    if (picked.every((other) => overlap(item, other) <= 0.14 * Math.min(item.end - item.start, other.end - other.start))) picked.push(item);
  }
  return picked;
}

export function clipCues(allCues, start, end) {
  const rows = [];
  for (const cue of allCues) {
    const lo = Math.max(start, cue.start), hi = Math.min(end, cue.end);
    if (hi - lo < 0.18) continue;
    const words = cue.text.split(/\s+/);
    const pieces = [];
    let part = '';
    for (const word of words) {
      if (part && (part.length + word.length > 50 || part.split(' ').length >= 8)) { pieces.push(part); part = ''; }
      part += `${part ? ' ' : ''}${word}`;
    }
    if (part) pieces.push(part);
    for (let i = 0; i < pieces.length; i++) {
      const partStart = cue.start + (cue.end - cue.start) * i / pieces.length;
      const partEnd = cue.start + (cue.end - cue.start) * (i + 1) / pieces.length;
      if (Math.min(hi, partEnd) - Math.max(lo, partStart) >= 0.14) {
        rows.push({ start: Math.max(lo, partStart) - start, end: Math.min(hi, partEnd) - start, text: pieces[i] });
      }
    }
  }
  return rows.sort((a, b) => a.start - b.start).map((cue, index, sorted) => ({ ...cue, end: Math.min(cue.end, sorted[index + 1]?.start ?? cue.end) })).filter((cue) => cue.end - cue.start >= 0.12);
}

const pad = (n) => String(n).padStart(2, '0');
function timestamp(total, ass = false) {
  const precision = ass ? 100 : 1000, ticks = Math.max(0, Math.round(total * precision));
  const h = Math.floor(ticks / (precision * 3600)), m = Math.floor(ticks / (precision * 60)) % 60, s = Math.floor(ticks / precision) % 60;
  return `${ass ? h : pad(h)}:${pad(m)}:${pad(s)}${ass ? '.' : ','}${String(ticks % precision).padStart(ass ? 2 : 3, '0')}`;
}
export const timeLabel = (seconds) => `${pad(Math.floor(seconds / 60))}:${pad(Math.floor(seconds) % 60)}`;
export const makeSrt = (rows) => rows.map((cue, index) => `${index + 1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}\n`).join('\n');
const captionFont = new Map([['ar', 'Noto Sans Arabic'], ['ur', 'Noto Sans Arabic'], ['hi', 'Noto Sans Devanagari'], ['bn', 'Noto Sans Bengali']]);
export const makeAss = (rows, { width = 720, height = 1280 } = {}, language) => `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${captionFont.get(language) || 'DejaVu Sans'},${Math.max(22, Math.round(Math.min(width, height) * .057))},&H00F7FFF5,&H0060FABF,&H000B100A,&H76000000,-1,0,0,0,100,100,0,0,1,3.5,1,2,${Math.round(width * .08)},${Math.round(width * .08)},${Math.round(height * (height > width ? .175 : .105))},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${rows.map((cue) => `Dialogue: 0,${timestamp(cue.start, true)},${timestamp(cue.end, true)},Default,,0,0,0,,${cue.text.replaceAll('\\', '＼').replaceAll('{', '(').replaceAll('}', ')')}`).join('\n')}
`;
