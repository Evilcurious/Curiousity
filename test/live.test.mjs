import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { liveArgs, livePlans, publicLiveUrl } from '../server/live.mjs';
import { ffmpeg, run, toolsStatus } from '../server/tools.mjs';

const base = 'https://manifest.googlevideo.com';
const master = `${base}/master.m3u8`;
const hls = { protocol: 'm3u8_native', manifest_url: master };

test('live plans handle muxed, split, master-only, DASH and video-only inputs', () => {
  const formats = [
    { ...hls, vcodec: 'avc1', acodec: 'mp4a', height: 1080, url: `${base}/mux.m3u8` },
    { ...hls, vcodec: 'avc1', acodec: 'none', height: 720, url: `${base}/video.m3u8` },
    { ...hls, vcodec: 'none', acodec: 'mp4a', url: `${base}/described.m3u8`, source_preference: -2, abr: 500 },
    { ...hls, vcodec: 'none', url: `${base}/audio.m3u8`, language_preference: 10 },
    { protocol: 'http_dash_segments', url: `${base}/videoplayback`, manifest_url: `${base}/manifest/dash/token`, vcodec: 'avc1' },
  ];
  const plans = livePlans({ formats });
  assert.deepEqual(plans.map((plan) => plan.type), ['muxed', 'split', 'master', 'dash', 'silent']);
  assert.equal(plans[1].audioUrl, `${base}/audio.m3u8`);
  assert.equal(plans[2].url, master);
  assert.deepEqual(livePlans({ formats: formats.slice(1, 2) }).map((plan) => plan.type), ['master', 'silent']);
  const args = liveArgs(plans[1], 120, 'capture.mkv');
  assert.ok(args.includes('1:a:0'));
  assert.equal(args[args.indexOf('-t') + 1], '120');
  assert.ok(liveArgs(plans[4], 120, 'capture.mkv').includes('0:a:0?'));
  assert.equal(liveArgs(plans[3], 120, 'capture.mkv').includes('-live_start_index'), false);
  assert.ok(liveArgs(plans[3], 120, 'capture.mkv').includes('0:a:0'));
  assert.equal(livePlans({ formats: [{ ...formats[0], height: 1440 }] })[0].url, formats[0].url);
});

test('live inputs reject unsupported origins, credentials, cleartext and protected formats', () => {
  for (const url of ['file:///etc/passwd', 'http://manifest.googlevideo.com/live', 'https://googlevideo.com.example.net/live', 'https://example.net/live', 'https://user@googlevideo.com/live', 'https://googlevideo.com:8443/live']) {
    assert.equal(publicLiveUrl(url), null);
    assert.deepEqual(livePlans({ formats: [{ protocol: 'm3u8', url }] }), []);
  }
  assert.deepEqual(livePlans({ formats: [{ protocol: 'm3u8', url: master, has_drm: true }] }), []);
});

test('FFmpeg records a public-style split HLS live window from real media segments', { timeout: 30_000 }, async (t) => {
  if (!(await toolsStatus()).ffmpeg) return t.skip('FFmpeg not installed');
  const dir = await mkdtemp(join(tmpdir(), 'cf-live-media-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await run(ffmpeg, ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=176x96:rate=24', '-t', '12', '-an', '-c:v', 'libx264', '-g', '96', '-preset', 'ultrafast', '-f', 'hls', '-hls_time', '4', '-hls_list_size', '3', '-hls_flags', 'omit_endlist', 'video.m3u8'], { cwd: dir, timeout: 10_000 });
  await run(ffmpeg, ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '12', '-c:a', 'aac', '-f', 'hls', '-hls_time', '4', '-hls_list_size', '3', '-hls_flags', 'omit_endlist', 'audio.m3u8'], { cwd: dir, timeout: 10_000 });
  // The AAC encoder may flush a final partial segment; a running stream would not publish it yet.
  const audioPlaylist = join(dir, 'audio.m3u8');
  const playlist = await readFile(audioPlaylist, 'utf8');
  await writeFile(audioPlaylist, playlist.replace(/#EXTINF:0\.\d+,\n[^\n]+\n$/, ''));
  const server = createServer(async (req, res) => {
    try { res.end(await readFile(join(dir, basename(req.url)))); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  // The selector only accepts HTTPS YouTube/Googlevideo inputs. Point the same FFmpeg arguments at a local fixture here.
  const result = await run(ffmpeg, liveArgs({ kind: 'hls', url: `${origin}/video.m3u8`, audioUrl: `${origin}/audio.m3u8` }, 6, 'capture.mkv'), { cwd: dir, timeout: 14_000 });
  assert.match(result.out, /progress=end/);
  const probe = await run(ffmpeg, ['-hide_banner', '-i', 'capture.mkv', '-t', '0', '-f', 'null', '-'], { cwd: dir });
  assert.match(probe.err, /Duration: 00:00:06\.\d+/);
  assert.match(probe.err, /Stream #0:0.*Video: h264/);
  assert.match(probe.err, /Stream #0:1.*Audio: aac/);
});
