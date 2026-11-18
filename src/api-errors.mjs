export function apiResponseError(status, payload, { contentType = '', fallback = 'The Curiousity engine could not complete the request.' } = {}) {
  const detail = typeof payload?.error === 'string' ? payload.error : '';
  if (status === 404 && (payload?.code === 'API_ROUTE_NOT_FOUND' || detail === 'API route not found.')) {
    return Object.assign(new Error('This API route is missing on the running server. Ask the server operator to restart Curiousity after updating it. If the app was already restarted, check that the HTTPS proxy forwards /api/ paths unchanged.'), { status, code: 'API_ROUTE_NOT_FOUND' });
  }
  if (/^text\/html\b/i.test(contentType) && ((status >= 200 && status < 300) || status === 404 || status === 405)) {
    return Object.assign(new Error('The API returned a web page instead of JSON. Check that the HTTPS proxy sends /api/ requests to the Curiousity server without rewriting the path.'), { status, code: 'API_PROXY_RESPONSE' });
  }
  return Object.assign(new Error(detail || fallback), { status });
}

export function isMissingApi(error) {
  return error?.code === 'API_ROUTE_NOT_FOUND' || error?.code === 'API_PROXY_RESPONSE';
}
