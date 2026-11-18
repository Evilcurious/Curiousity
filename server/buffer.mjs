import { createHash, randomBytes } from 'node:crypto';
import { externalUrl } from './outbound.mjs';
import { withMcp } from './mcp.mjs';
import { HttpError, text } from './validation.mjs';

export const bufferId = (id) => typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id);
export const bufferChannels = Object.freeze({ instagram: 'Instagram Reel', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', threads: 'Threads', bluesky: 'Bluesky', twitter: 'X' });
const linkAge = 3 * 24 * 60 * 60_000;
const hash = (token) => createHash('sha256').update(token).digest('hex');

function unwrap(result) {
  if (result.isError) throw new HttpError(422, 'Buffer rejected the request. Check channel permissions and required post or media settings in Buffer.');
  if (result.structuredContent !== undefined) return result.structuredContent;
  for (const item of Array.isArray(result.content) ? result.content : []) {
    if (item?.type !== 'text') continue;
    try { return JSON.parse(item.text); } catch { /* Check the next content block. */ }
  }
  throw new HttpError(502, 'The Buffer MCP server did not return structured results.');
}

function listValue(payload, key) {
  const data = payload?.data ?? payload?.result ?? payload;
  const value = Array.isArray(data) ? data : data?.[key] ?? data?.account?.[key] ?? data?.items;
  return Array.isArray(value) ? value : Array.isArray(value?.nodes) ? value.nodes : null;
}

export async function bufferOrganizations(profile, store, open = withMcp) {
  return open(profile, store, async ({ call }) => {
    const rows = listValue(unwrap(await call('get_account')), 'organizations');
    if (!rows) throw new HttpError(502, 'Could not read your Buffer organizations. Discover the tools and check the connected account.');
    return rows.filter((row) => bufferId(row?.id)).slice(0, 80).map(({ id, name }) => ({ id, name: text(name, 120) || 'Buffer organization' }));
  });
}

async function channelsFor(call, organizationId) {
  const rows = listValue(unwrap(await call('list_channels', { organizationId })), 'channels');
  if (!rows) throw new HttpError(502, 'Could not read the channels for this Buffer organization.');
  return rows.filter((row) => bufferId(row?.id) && row.isDisconnected !== true && row.isConnected !== false && typeof row.service === 'string' && Object.hasOwn(bufferChannels, row.service.toLowerCase()))
    .slice(0, 100).map((row) => ({ id: row.id, name: text(row.displayName || row.name, 120) || 'Buffer channel', service: row.service.toLowerCase(), reminder: (row.service.toLowerCase() === 'instagram' && /personal/i.test(row.type || '')) || (row.service.toLowerCase() === 'facebook' && /group/i.test(row.type || '')) }));
}

export async function listBufferChannels(profile, store, organizationId, open = withMcp) {
  if (!bufferId(organizationId)) throw new HttpError(400, 'Select a Buffer organization.');
  return open(profile, store, ({ call }) => channelsFor(call, organizationId));
}

export function bufferPostArgs({ input, clip, mediaUrl }) {
  if (input.consent !== true) throw new HttpError(400, 'Review the draft and confirm exactly what will be sent to Buffer.');
  if (!bufferId(input.channelId) || typeof input.service !== 'string' || !Object.hasOwn(bufferChannels, input.service)) throw new HttpError(400, 'Choose a supported Buffer channel.');
  const args = { channelId: input.channelId, schedulingType: 'automatic', mode: 'addToQueue', saveToDraft: true, text: text(input.description, 2200), assets: [{ video: { url: mediaUrl } }] };
  if (input.service === 'instagram') args.metadata = { instagram: { type: 'reel', shouldShareToFeed: true } };
  if (input.service === 'facebook') args.metadata = { facebook: { type: 'post' } };
  if (input.service === 'youtube') {
    if (typeof input.madeForKids !== 'boolean') throw new HttpError(400, 'Choose whether the YouTube video is made for kids.');
    args.metadata = { youtube: { title: text(input.title || clip.title, 100) || 'Video clip', categoryId: '22', privacy: 'private', madeForKids: input.madeForKids, notifySubscribers: false } };
  }
  return args;
}

export async function submitBufferDraft(profile, store, args, { organizationId, service }, open = withMcp) {
  let writing = false;
  try {
    return await open(profile, store, async ({ call }) => {
      const channel = (await channelsFor(call, organizationId)).find((row) => row.id === args.channelId && row.service === service);
      if (!channel) throw new HttpError(422, 'The selected Buffer channel is no longer available. Reload the destinations and review again.');
      writing = true;
      // Pin the draft flag at the boundary. An uncertain response is never retried here.
      const result = unwrap(await call('create_post', { ...args, schedulingType: channel.reminder ? 'notification' : 'automatic', saveToDraft: true }));
      const data = result?.data ?? result?.result ?? result;
      const post = data?.post ?? data?.createPost?.post ?? data;
      if (!bufferId(post?.id) || !['draft', 'needs_approval'].includes(String(post.status).toLowerCase())) throw new HttpError(502, 'Buffer did not confirm a draft. Check your Buffer dashboard before sending again.');
      return { id: post.id, status: String(post.status).toLowerCase() };
    });
  } catch (err) {
    const error = err instanceof HttpError ? err : new HttpError(502, 'Could not complete the Buffer request.');
    error.safeToRetry = !writing || error.status === 422 || error.status === 429;
    throw error;
  }
}

export function bufferMediaUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 1700) throw new HttpError(400, 'Provide a stable, public HTTPS URL for the MP4.');
  return externalUrl(raw.trim(), { allowQuery: true }).href;
}

export function allocateVideoLink(store, origin, job, clip) {
  const now = Date.now();
  const token = randomBytes(24).toString('base64url');
  const entry = { hash: hash(token), jobId: job.id, clipId: clip.id, expires: now + linkAge };
  store.state.bufferLinks = store.state.bufferLinks.filter((item) => item.expires > now);
  store.state.bufferLinks.push(entry);
  return { url: `${origin}/media/buffer/${token}.mp4`, expiry: new Date(entry.expires).toISOString(), entry };
}
export function videoLink(store, token) {
  return /^[A-Za-z0-9_-]{32}$/.test(token) ? store.state.bufferLinks.find((item) => item.hash === hash(token) && item.expires > Date.now()) : null;
}
