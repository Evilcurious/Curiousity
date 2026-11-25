import { apiResponseError } from './api-errors.mjs';

export function uploadCaptions({ file, audio, image, style, engine, language, translator }, signal, progress) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const still = Boolean(audio && image);
    const params = new URLSearchParams({ name: (still ? audio.name : file.name).slice(0, 180), style: JSON.stringify(style), engine, language,
      ...(still && { source: 'still' }), ...(translator && { translator }) });
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    let timer;
    const expire = (message, ms) => {
      clearTimeout(timer);
      timer = setTimeout(() => { reject(new Error(message)); request.abort(); }, ms);
    };
    const idle = () => expire('The upload stopped progressing. Check your connection and the server’s upload settings.', 150_000);
    request.open('POST', `/api/captions/upload?${params}`);
    request.setRequestHeader('X-Clipforge', 'workspace');
    let body = file;
    if (still) {
      body = new FormData(); body.append('image', image); body.append('audio', audio);
    } else request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.responseType = 'json';
    request.upload.onprogress = (event) => {
      idle();
      if (event.lengthComputable) progress(Math.min(99, Math.floor(event.loaded / event.total * 100)));
    };
    request.upload.onload = () => {
      progress(100);
      expire('The server did not confirm the upload. Check Caption projects before retrying; if it’s missing, check the reverse proxy’s upload settings.', 35_000);
    };
    request.onloadend = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    request.onabort = () => reject(signal.reason || new Error('Upload stopped.'));
    request.onerror = () => reject(new Error('The upload connection was lost. Check your network and the server’s proxy settings, then try again.'));
    request.onload = () => {
      if (request.status === 202 && request.response?.id) return resolve(request.response);
      const fallback = request.status === 413 ? 'The upload was too large for the server or reverse proxy.' : `Could not upload the media (HTTP ${request.status}).`;
      reject(apiResponseError(request.status, request.response, { contentType: request.getResponseHeader('Content-Type') || '', fallback }));
    };
    signal.addEventListener('abort', abort, { once: true });
    idle();
    request.send(body);
  });
}
