import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeAss, makeSrt } from '../server/captions.mjs';
import { ffmpeg, ROOT, run, toolsStatus } from '../server/tools.mjs';
import { jobOptions } from '../server/validation.mjs';
import { captionPresets, defaultCaptionStyle, matchingPreset } from '../shared/captions.mjs';

const rows = [{ start: 0, end: 2, text: 'Yeh aik achhi baat hai.' }];
const frame = { width: 720, height: 1280 };

test('whitelists style options, uses script-specific fonts and keeps SRT plain text', () => {
  const body = { demo: true, count: 'auto' };
  const style = { font: 'mono', effect: 'box', size: 'large', animation: 'highlight', exitAnimation: 'fade' };
  assert.deepEqual(jobOptions(body).captionStyle, defaultCaptionStyle);
  assert.deepEqual(jobOptions({ ...body, captionStyle: style }).captionStyle, style);
  for (const captionStyle of [null, [], { font: 'System' }, { effect: 'constructor' }, { size: 50 }, { animation: 'injected' }, { exitAnimation: 'pop' }, { extra: 'none' }]) {
    assert.throws(() => jobOptions({ ...body, captionStyle }), { status: 400 });
  }
  const ass = makeAss(rows, frame, 'ur-Latn', style);
  assert.match(ass, /Style: Default,DejaVu Sans Mono,52,/);
  assert.match(ass, /,3,4\.5,0,2,58,58,224,1/); // opaque box, bottom-center alignment
  assert.match(ass, /\\fad\(0,200\)/);
  assert.deepEqual([...ass.matchAll(/\\k(\d+)/g)].map((match) => Number(match[1])), [40, 40, 40, 40, 40]);
  const urdu = [{ ...rows[0], text: 'یہ ایک اچھی بات ہے۔' }];
  assert.match(makeAss(urdu, frame, 'ur', style), /Style: Default,Noto Sans Arabic,52,/);
  assert.equal(makeSrt(rows), '1\n00:00:00,000 --> 00:00:02,000\nYeh aik achhi baat hai.\n');
});

test('the 13 device-video presets share the Clip Studio validation and ASS renderer', () => {
  assert.equal(Object.keys(captionPresets).length, 13);
  for (const [id, preset] of Object.entries(captionPresets)) {
    const { captionStyle } = jobOptions({ demo: true, count: 1, captionStyle: preset.style });
    assert.equal(matchingPreset(captionStyle), id);
    assert.match(makeAss(rows, frame, 'en', captionStyle), /Dialogue: 0,/);
  }
});

test('FFmpeg renders visible font effects and changes pixels during caption entrance, cue and exit', { timeout: 25_000 }, async (t) => {
  if (!(await toolsStatus()).subtitles) return t.skip('FFmpeg with libass not installed');
  const dir = await mkdtemp(join(tmpdir(), 'cf-caption-styles-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(join(ROOT, 'server', 'assets', 'fonts'), join(dir, 'fonts'), { recursive: true });
  const width = 360, height = 240, bytes = width * height * 3;
  async function render(style) {
    await writeFile(join(dir, 'style.ass'), makeAss(rows, { width, height }, 'ur-Latn', style));
    const chunks = [];
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-filter_threads', '1', '-f', 'lavfi', '-i', `color=black:s=${width}x${height}:r=20:d=2`,
      '-vf', 'ass=style.ass:fontsdir=fonts', '-an', '-threads', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], { cwd: dir, onData: (chunk) => chunks.push(chunk) });
    const output = Buffer.concat(chunks);
    assert.equal(output.length, 40 * bytes);
    return (index) => {
      let light = 0, bright = 0, lime = 0, y = 0;
      const frame = output.subarray(index * bytes, (index + 1) * bytes);
      for (let i = 0; i < frame.length; i += 3) {
        const g = frame[i + 1], b = frame[i + 2];
        light += g;
        if (g > 128) { bright++; y += Math.floor(i / (width * 3)); if (g > b + 40) lime++; }
      }
      return { light, bright, lime, y: y / bright };
    };
  }
  const outline = await render({});
  const glow = await render({ effect: 'glow' });
  assert.equal(outline(20).lime, 0);
  assert.ok(glow(20).lime > 400, 'the lime effect has green glyph pixels');
  const box = await render({ effect: 'box' });
  assert.ok(box(20).light > outline(20).light * 1.1, 'the solid box adds background pixels');
  const fade = await render({ animation: 'fade', exitAnimation: 'fade' });
  assert.equal(fade(0).light, 0);
  assert.ok(fade(20).bright > 400);
  assert.ok(fade(39).light < fade(20).light * .4);
  const pop = await render({ font: 'serif', animation: 'pop', exitAnimation: 'shrink' });
  assert.ok(pop(0).bright < pop(20).bright * .85);
  assert.ok(pop(2).bright > pop(20).bright);
  assert.ok(pop(39).light < pop(20).light * .35);
  const rise = await render({ font: 'mono', animation: 'rise' });
  assert.ok(rise(0).y > rise(20).y + 3);
  const highlight = await render({ animation: 'highlight' });
  assert.ok(highlight(32).lime > highlight(0).lime * 3);
  const wave = await render(captionPresets.wave.style);
  assert.ok(wave(0).bright < wave(20).bright * .9, 'Wave has a compressed first frame');
  const rotate = await render(captionPresets.rotating.style);
  assert.ok(rotate(0).bright < rotate(20).bright * .92, 'Rotate starts with smaller, rotated glyphs');
  const flicker = await render(captionPresets.vhs.style);
  assert.ok(flicker(0).light < flicker(20).light * .7, 'Tape flicker affects the rendered frame');
});
