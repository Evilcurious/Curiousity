import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uploadCaptions } from '../src/caption-upload.mjs';

function fakeUpload(t) {
  let xhr;
  const XMLHttpRequest = class {
    upload = {};
    constructor() { xhr = this; }
    open(method, path) { Object.assign(this, { method, path }); }
    setRequestHeader() {}
    send(body) { this.body = body; }
    abort() { this.aborted = true; this.onabort?.(); this.onloadend?.(); }
    getResponseHeader() { return 'application/json'; }
  };
  const original = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = XMLHttpRequest;
  t.after(() => { if (original === undefined) delete globalThis.XMLHttpRequest; else globalThis.XMLHttpRequest = original; });
  const signal = new AbortController().signal, progress = [];
  const result = uploadCaptions({ file: new File(['media'], 'recording.mp4'), style: {}, engine: 'local', language: 'ur-Latn' }, signal, (value) => progress.push(value));
  return { xhr, result, progress };
}

test('sending the last upload byte is not a receipt; a missing receipt fails visibly instead of spinning forever', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { xhr, result, progress } = fakeUpload(t);
  const failure = assert.rejects(result, /server did not confirm the upload/);
  assert.match(xhr.path, /engine=local&language=ur-Latn$/);
  xhr.upload.onprogress({ lengthComputable: true, loaded: 5, total: 5 });
  assert.deepEqual(progress, [99]);
  xhr.upload.onload();
  assert.deepEqual(progress, [99, 100]);
  assert.equal(xhr.aborted, undefined);
  t.mock.timers.tick(35_000);
  await failure;
  assert.equal(xhr.aborted, true);
});

test('a valid 202 returns the queued job and clears the upload receipt timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { xhr, result } = fakeUpload(t);
  xhr.upload.onload();
  Object.assign(xhr, { status: 202, response: { id: 'caption-job', status: 'queued' } });
  xhr.onload(); xhr.onloadend();
  assert.deepEqual(await result, xhr.response);
  t.mock.timers.tick(150_000);
  assert.equal(xhr.aborted, undefined);
});
