import { lookup } from 'node:dns';
import { Agent } from 'undici';
import ipaddr from 'ipaddr.js';
import { HttpError } from './validation.mjs';

export function isPublicAddress(value) {
  try {
    const ip = ipaddr.process(value);
    // Reject special IPv4 ranges and IPv6 transition, link-local, loopback and private addresses.
    return ip.range() === 'unicast' && (ip.kind() === 'ipv4' || ip.match(ipaddr.parse('2000::'), 3));
  } catch { return false; }
}

const local = new Set(['localhost', '127.0.0.1', '[::1]']);
const hostnameOf = (url) => url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();

export function externalUrl(raw, { allowLocal = false, allowQuery = false } = {}) {
  let url;
  try { url = new URL(raw); } catch { /* Report a validation error below. */ }
  if (!url || url.username || url.password || url.hash || (!allowQuery && url.search)) throw new HttpError(400, 'Enter an HTTPS URL without credentials or a fragment.');
  if (allowLocal && local.has(url.hostname) && ['http:', 'https:'].includes(url.protocol)) return url;
  const host = hostnameOf(url);
  if (url.protocol !== 'https:' || url.port || (ipaddr.isValid(host) ? !isPublicAddress(host) : !host.includes('.') || /(?:^|\.)(localhost|local|internal|home|lan|onion|intranet)$/.test(host))) {
    throw new HttpError(400, 'Use a public HTTPS endpoint. Only the host administrator may use a loopback AI service.');
  }
  return url;
}

// Pin the address chosen by the resolver at socket creation. A preflight DNS
// check followed by normal fetch would resolve again and allow DNS rebinding.
export function safeResolver(hostname, options, done, resolve = lookup) {
  resolve(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return done(error);
    if (!Array.isArray(addresses) || !addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      return done(Object.assign(new Error('Endpoint does not resolve to a public address.'), { code: 'EHOSTUNREACH' }));
    }
    const available = addresses.filter(({ family }) => !options.family || family === options.family);
    if (!available.length) return done(Object.assign(new Error('No address for this IP family.'), { code: 'EHOSTUNREACH' }));
    return options.all ? done(null, available) : done(null, available[0].address, available[0].family);
  });
}

const dispatcher = new Agent({ connect: { lookup: safeResolver, timeout: 7000 }, connections: 3, keepAliveTimeout: 5000 });
export function guardedFetch(input, options, { allowLocal = false, allowQuery = false } = {}) {
  const url = externalUrl(input, { allowLocal, allowQuery });
  return fetch(url.href, { ...options, redirect: 'error', ...(allowLocal && local.has(url.hostname) ? {} : { dispatcher }) });
}

export async function boundedText(response, bytes = 512 * 1024) {
  if (!response.body) return '';
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let length = 0, body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return body + decoder.decode();
      length += value.byteLength;
      if (length > bytes) throw new HttpError(502, 'The remote response was too large.');
      body += decoder.decode(value, { stream: true });
    }
  } finally { reader.cancel().catch(() => {}); }
}
