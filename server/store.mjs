import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const boundedEnv = (name, fallback, low, high) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= low && value <= high ? value : fallback;
};
export const dataRoot = resolve(process.env.DATA_DIR || '.clipforge');
export const maxSourceSeconds = boundedEnv('MAX_SOURCE_MINUTES', 180, 1, 720) * 60;
export const maxSourceBytes = boundedEnv('MAX_SOURCE_MB', 2048, 10, 16384) * 1024 * 1024;
export const jobDir = (id) => join(dataRoot, 'projects', id);
export const activeStatuses = new Set(['uploading', 'queued', 'waiting_replay', 'fetching', 'downloading', 'capturing', 'analyzing', 'transcribing', 'rendering']);

export function createStore(root = dataRoot) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const filename = join(root, 'workspace.json');
  const keyPath = join(root, '.key');
  let key;
  try { key = readFileSync(keyPath); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (existsSync(filename)) throw new Error('Workspace encryption key is missing. Restore .key from a backup.');
    key = randomBytes(32);
    writeFileSync(keyPath, key, { flag: 'wx', mode: 0o600 });
  }
  if (key.length !== 32) throw new Error('Workspace key is invalid. Restore the original data directory and key.');
  let state = { jobs: [], users: [], sessions: [], branding: { theme: 'signal' }, bufferLinks: [], providers: [], activeProviderId: null, captions: { providerId: null, model: '' }, tiktok: {}, google: {} };
  try { state = { ...state, ...JSON.parse(readFileSync(filename, 'utf8')) }; } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Could not read workspace.json. Restore it from a valid backup.', { cause: error });
  }
  return {
    state,
    save() {
      writeFileSync(`${filename}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 });
      renameSync(`${filename}.tmp`, filename);
    },
    seal(value) {
      if (!value) return '';
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const buffer = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), buffer]).toString('base64');
    },
    unseal(value) {
      if (!value) return '';
      const buffer = Buffer.from(value, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12));
      decipher.setAuthTag(buffer.subarray(12, 28));
      return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}
