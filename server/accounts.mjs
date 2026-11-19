import { createHash, randomBytes, randomUUID, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { promisify } from 'node:util';
import { HttpError } from './validation.mjs';
import { membership, planId } from './plans.mjs';

const scrypt = promisify(derive);
const day = 24 * 60 * 60_000;
const sessionAge = 7 * day;
const cookie = 'curiousity_session';
const digest = (token) => createHash('sha256').update(token).digest('hex');
const kdf = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
let hashing = 0;

export const emptyWorkspace = () => ({ providers: [], activeProviderId: null, captions: { providerId: null, model: '' }, google: {}, tiktok: {}, mcps: [] });
export const mustChangePassword = (user) => Number.isFinite(user?.temporaryPasswordExpiresAt);
const expiredPassword = (user) => mustChangePassword(user) && user.temporaryPasswordExpiresAt <= Date.now();
export const publicAccount = (user) => user ? { id: user.id, email: user.email, role: user.role, premium: canUsePremium(user), premiumRequested: Boolean(user.premiumRequested), mustChangePassword: mustChangePassword(user), plan: membership(user), createdAt: user.createdAt } : null;
export const canUsePremium = (user) => Boolean(user && planId(user) !== 'free');
export const adminAccount = (user) => ({ ...publicAccount(user), lastSignIn: user.lastSignIn || null, planOverrides: user.planOverrides || {} });

function emailOf(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  return email;
}

function validPassword(value, minimum = 10) {
  return typeof value === 'string' && value.length >= minimum && value.trim().length >= minimum && Buffer.byteLength(value) <= 256;
}

async function hashPassword(password, salt) {
  if (hashing >= 4) throw new HttpError(429, 'Too many password requests. Try again shortly.');
  hashing++;
  try { return await scrypt(password, salt, 32, kdf); }
  finally { hashing--; }
}

async function passwordRecord(password) {
  const salt = randomBytes(16);
  const hash = await hashPassword(password, salt);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

async function matchesPassword(password, record) {
  const actual = await hashPassword(password, Buffer.from(record?.salt || '0'.repeat(32), 'hex'));
  const expected = Buffer.from(record?.hash || '0'.repeat(64), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function markPassword(user, temporary) {
  if (temporary) user.temporaryPasswordExpiresAt = Date.now() + day;
  else delete user.temporaryPasswordExpiresAt;
}

function revokeSessions(store, user) {
  store.state.sessions = store.state.sessions.filter((session) => session.userId !== user.id);
}

async function newAccount(email, password, role) {
  const account = { id: randomUUID(), email, role, plan: 'free', premiumRequested: false, workspace: emptyWorkspace(), createdAt: new Date().toISOString() };
  account.password = await passwordRecord(password);
  return account;
}

// This function is only called by the server bootstrap and the host CLI, never
// by a signup or an admin HTTP route. No account can grant itself this role.
export async function initializeAdmin(store, { email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD, reset = false, temporary = false } = {}) {
  const existing = store.state.users.find((user) => user.role === 'admin');
  if (existing && !reset) return existing;
  if (!email && !password && !reset) return null;
  const normalized = emailOf(email);
  if (!password && !reset) return null; // Reserve this address until the operator provisions it.
  if (!validPassword(password, 14)) throw new Error('Set ADMIN_PASSWORD to a new, unique password of at least 14 characters (at most 256 bytes).');
  if (reset) {
    if (!existing || existing.email !== normalized) throw new Error('ADMIN_EMAIL must match the existing administrator.');
    existing.password = await passwordRecord(password);
    markPassword(existing, temporary);
    revokeSessions(store, existing);
    store.save();
    return existing;
  }
  if (store.state.users.some((user) => user.email === normalized)) throw new Error('That email already belongs to a member. Choose an unused email to provision the administrator.');
  const admin = await newAccount(normalized, password, 'admin');
  markPassword(admin, temporary);
  // Pre-account installations had a single global workspace. Adopt it privately.
  for (const key of ['providers', 'activeProviderId', 'captions', 'google', 'tiktok']) {
    if (store.state[key] !== undefined) { admin.workspace[key] = store.state[key]; delete store.state[key]; }
  }
  for (const job of store.state.jobs) if (!job.ownerId) job.ownerId = admin.id;
  store.state.users.push(admin);
  store.save();
  return admin;
}

export function limiter(windowMs, maxKeys = 4096) {
  const attempts = new Map();
  return (key, limit) => {
    const now = Date.now();
    let entry = attempts.get(key);
    if (!entry || entry.until <= now) {
      if (attempts.size >= maxKeys) for (const [k, value] of attempts) if (value.until <= now) attempts.delete(k);
      if (!attempts.has(key) && attempts.size >= maxKeys) throw new HttpError(429, 'Too many requests. Try again in a few minutes.');
      attempts.set(key, entry = { count: 0, until: now + windowMs });
    }
    if (entry.count >= limit) throw new HttpError(429, 'Too many requests. Try again in a few minutes.');
    entry.count++;
  };
}

export function createAuth(store, { secure, embedded = () => false, reserved = process.env.ADMIN_EMAIL, allowSignup = process.env.ALLOW_SIGNUP !== 'false' }) {
  const throttle = limiter(15 * 60_000);
  const reservedEmail = reserved ? emailOf(reserved) : '';
  const find = (email) => store.state.users.find((user) => user.email === email);
  const tokenOf = (req) => {
    const raw = req.get('cookie')?.split(/;\s*/).find((value) => value.startsWith(`${cookie}=`))?.slice(cookie.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(raw || '') ? digest(raw) : null;
  };
  const options = (req) => secure(req) && embedded(req)
    ? { path: '/', httpOnly: true, sameSite: 'none', secure: true, partitioned: true }
    : { path: '/', httpOnly: true, sameSite: 'lax', secure: secure(req) };
  function identify(req) {
    const token = tokenOf(req);
    if (!token) return null;
    const session = store.state.sessions.find((row) => row.token === token && row.expiresAt > Date.now());
    const user = session && store.state.users.find((account) => account.id === session.userId);
    return user && !expiredPassword(user) ? user : null;
  }
  const issue = (req, res, user) => {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const expiresAt = mustChangePassword(user) ? user.temporaryPasswordExpiresAt : now + sessionAge;
    let retained = 0;
    store.state.sessions = store.state.sessions.filter((session) => session.expiresAt > now && (session.userId !== user.id || retained++ < 9));
    store.state.sessions.unshift({ token: digest(token), userId: user.id, expiresAt });
    const address = req.ip?.replace(/^::ffff:(?=\d)/i, '');
    user.lastSignIn = { at: new Date(now).toISOString(), ip: isIP(address || '') ? address : null };
    store.save();
    res.cookie(cookie, token, { ...options(req), maxAge: Math.max(0, expiresAt - now) });
    return user;
  };
  return {
    allowSignup,
    identify,
    async signup(req, res) {
      if (!allowSignup) throw new HttpError(403, 'Registration is closed on this instance.');
      throttle(`signup:${req.ip}`, 8);
      const email = emailOf(req.body?.email), password = req.body?.password;
      if (!validPassword(password)) throw new HttpError(400, 'Use at least 10 characters for your password (at most 256 bytes).');
      if (password !== req.body?.confirmPassword) throw new HttpError(400, 'Passwords do not match.');
      const taken = () => email === reservedEmail || find(email);
      if (taken()) throw new HttpError(409, 'That email is unavailable. If you already have an account, sign in.');
      const user = await newAccount(email, password, 'member');
      if (taken()) throw new HttpError(409, 'That email is unavailable. If you already have an account, sign in.');
      store.state.users.push(user);
      return issue(req, res, user);
    },
    async login(req, res) {
      throttle(`login:${req.ip}`, 36);
      const email = emailOf(req.body?.email), password = req.body?.password;
      throttle(`login-email:${req.ip}:${email}`, 12);
      if (!validPassword(password)) throw new HttpError(401, 'Email or password is incorrect.');
      const user = find(email), record = user?.password;
      if (!(await matchesPassword(password, record)) || !user || user.password !== record || user.email !== email) throw new HttpError(401, 'Email or password is incorrect.');
      if (expiredPassword(user)) throw new HttpError(401, 'This temporary password expired. Ask the host administrator to replace it.');
      return issue(req, res, user);
    },
    async changePassword(req, res, user) {
      throttle(`password:${user.id}`, 8);
      const { currentPassword, newPassword, confirmPassword } = req.body || {};
      const minimum = user.role === 'admin' ? 14 : 10;
      if (!validPassword(newPassword, minimum)) throw new HttpError(400, `Use at least ${minimum} characters for your new password (at most 256 bytes).`);
      if (newPassword !== confirmPassword) throw new HttpError(400, 'New passwords do not match.');
      const record = user.password;
      if (!validPassword(currentPassword) || !(await matchesPassword(currentPassword, record))) throw new HttpError(403, 'Current password is incorrect.');
      if (currentPassword === newPassword) throw new HttpError(400, 'Choose a different password from your current one.');
      const replacement = await passwordRecord(newPassword);
      // A concurrent change or sign-out must not let a stale request replace the credential.
      if (user.password !== record || identify(req) !== user) throw new HttpError(409, 'Your session changed. Sign in again before changing your password.');
      user.password = replacement;
      markPassword(user, false);
      revokeSessions(store, user);
      store.save();
      res.clearCookie(cookie, options(req));
    },
    async changeMember(req, operator, member) {
      if (operator.role !== 'admin' || member.role !== 'member') throw new HttpError(403, 'Only member credentials can be edited here.');
      throttle(`member-credentials:${operator.id}`, 8);
      const { email, adminPassword, temporaryPassword, confirmPassword } = req.body || {};
      const nextEmail = email === undefined ? member.email : emailOf(email);
      const resetting = temporaryPassword !== undefined;
      if (nextEmail === member.email && !resetting) throw new HttpError(400, 'Enter a different email or a temporary password.');
      if (resetting && (!validPassword(temporaryPassword, 14) || temporaryPassword !== confirmPassword)) throw new HttpError(400, 'Enter and confirm a temporary password of at least 14 characters.');
      if (resetting && temporaryPassword === adminPassword) throw new HttpError(400, 'Do not reuse your administrator password.');
      const operatorRecord = operator.password, memberRecord = member.password, originalEmail = member.email;
      if (!validPassword(adminPassword, 14) || !(await matchesPassword(adminPassword, operatorRecord))) throw new HttpError(403, 'Administrator password is incorrect.');
      const taken = () => nextEmail !== originalEmail && (nextEmail === reservedEmail || store.state.users.some((row) => row !== member && row.email === nextEmail));
      if (taken()) throw new HttpError(409, 'That email is already in use.');
      const replacement = resetting ? await passwordRecord(temporaryPassword) : null;
      if (operatorRecord !== operator.password || identify(req) !== operator || memberRecord !== member.password || member.email !== originalEmail) throw new HttpError(409, 'Account credentials changed. Refresh and try again.');
      if (taken()) throw new HttpError(409, 'That email is already in use.');
      member.email = nextEmail;
      if (replacement) { member.password = replacement; markPassword(member, true); }
      revokeSessions(store, member);
      store.save();
    },
    logout(req, res) {
      const token = tokenOf(req);
      if (token) { store.state.sessions = store.state.sessions.filter((session) => session.token !== token); store.save(); }
      res.clearCookie(cookie, options(req));
    },
  };
}
