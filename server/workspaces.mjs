import { createHash } from 'node:crypto';
import { canUsePremium } from './accounts.mjs';
import { defaultTheme, hasTheme } from '../shared/themes.mjs';
import { HttpError } from './validation.mjs';

export function sharedProviders(store, account) {
  if (!canUsePremium(account)) return [];
  return store.state.users.filter((user) => user.role === 'admin' && user !== account)
    .flatMap((user) => user.workspace.providers.filter((profile) => profile.premiumShared && profile.model));
}

export function scopedStore(store, user) {
  const state = user.workspace;
  // Account-only upload workers must never scan other accounts' jobs. A getter
  // keeps access live as new projects are created without persisting a second copy.
  if (!Object.hasOwn(state, 'jobs')) Object.defineProperty(state, 'jobs', { get: () => store.state.jobs.filter((job) => job.ownerId === user.id) });
  return {
    state, save: store.save, seal: store.seal, unseal: store.unseal,
    chatProfile: (id) => state.providers.find((profile) => profile.id === id) || sharedProviders(store, user).find((profile) => profile.id === id),
  };
}

export function publicBrand(store) {
  const { theme, logoVersion } = store.state.branding;
  return { theme: hasTheme(theme) ? theme : defaultTheme, logoUrl: logoVersion ? `/api/brand/logo?v=${logoVersion}` : null };
}

export function updateBrand(store, input) {
  const prior = store.state.branding;
  if (!hasTheme(input?.theme)) throw new HttpError(400, 'Choose a supported default theme.');
  const branding = { ...prior, theme: input.theme };
  if (input.logo === null) { delete branding.logo; delete branding.logoVersion; }
  else if (input.logo !== undefined) {
    const value = input.logo;
    if (typeof value !== 'string' || value.length > 175_000 || !/^[a-z0-9+/]+={0,2}$/i.test(value)) throw new HttpError(400, 'Choose a PNG logo up to 128 KB.');
    const img = Buffer.from(value, 'base64');
    const width = img.length >= 24 ? img.readUInt32BE(16) : 0, height = img.length >= 24 ? img.readUInt32BE(20) : 0;
    if (img.length > 128 * 1024 || img.length < 33 || !img.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || img.toString('ascii', 12, 16) !== 'IHDR' || !width || !height || width > 512 || height > 512) {
      throw new HttpError(400, 'Choose a PNG logo, at most 512×512 and 128 KB.');
    }
    branding.logo = img.toString('base64');
    branding.logoVersion = createHash('sha256').update(img).digest('hex').slice(0, 16);
  }
  store.state.branding = branding;
  store.save();
  return publicBrand(store);
}
