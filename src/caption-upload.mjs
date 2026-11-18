export function uploadVideo(file, style, signal, progress) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const params = new URLSearchParams({ name: file.name.slice(0, 180), style: JSON.stringify(style) });
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const release = () => signal.removeEventListener('abort', abort);
    request.open('POST', `/api/captions/upload?${params}`);
    request.setRequestHeader('X-Clipforge', 'workspace');
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.responseType = 'json';
    request.upload.onprogress = (event) => progress(Math.min(100, Math.round(event.loaded / file.size * 100)));
    request.onloadend = release;
    request.onabort = () => reject(signal.reason || new Error('Upload stopped.'));
    request.onerror = () => reject(new Error('The upload connection was lost. Check your network and the server’s proxy settings, then try again.'));
    request.onload = () => {
      if (request.status === 202 && request.response?.id) return resolve(request.response);
      const fallback = request.status === 413 ? 'The reverse proxy rejected this upload. Ask the server operator to check its upload size limit.' : `Could not upload the video (HTTP ${request.status}).`;
      reject(new Error(request.response?.error || fallback));
    };
    signal.addEventListener('abort', abort, { once: true });
    // A File is sent directly; no FileReader, multipart buffering or base64.
    request.send(file);
  });
}
