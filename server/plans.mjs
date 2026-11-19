import { plans, overrideMax } from '../shared/membership.mjs';
import { HttpError } from './validation.mjs';

// Paid plans run for one calendar month. January 31, for example, renews to
// the last day of February rather than overflowing into March.
export function oneMonthLater(now) {
  const date = new Date(now);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const end = new Date(date);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, end.getUTCDate()));
  return date.getTime();
}

export function planId(account, now = Date.now()) {
  if (account.role === 'admin') return 'admin';
  return Object.hasOwn(plans, account.plan) && account.plan !== 'free' && account.planExpiresAt > now ? account.plan : 'free';
}

export function migrateMembership(account, now = Date.now()) {
  let changed = false;
  if (!Object.hasOwn(plans, account.plan)) {
    account.plan = account.premium ? 'premium' : 'free';
    if (account.premium) account.planExpiresAt = oneMonthLater(now);
    changed = true;
  }
  if (Object.hasOwn(account, 'theme')) { delete account.theme; changed = true; }
  if (Object.hasOwn(account, 'premium')) { delete account.premium; changed = true; }
  if (account.premiumMeter) {
    const day = new Date(now).toISOString().slice(0, 10);
    if (!account.planUsage?.daily && account.premiumMeter.day === day) {
      account.planUsage = { ...account.planUsage, daily: { day, messages: 0, aiProjects: account.premiumMeter.jobs || 0 } };
    }
    delete account.premiumMeter;
    changed = true;
  }
  return changed;
}

export function planLimits(account, now = Date.now()) {
  const id = planId(account, now);
  if (id === 'admin') return { projects: null, aiProjects: null, messages: null, tiktokAccounts: null };
  return Object.fromEntries(Object.entries(plans[id].limits).map(([key, amount]) => [key,
    amount === null ? null : Math.max(amount, account.planOverrides?.[key] || 0),
  ]));
}

const getUsage = (account, now) => {
  const day = new Date(now).toISOString().slice(0, 10), month = day.slice(0, 7);
  return {
    monthly: account.planUsage?.monthly?.month === month ? account.planUsage.monthly : { month, projects: 0 },
    daily: account.planUsage?.daily?.day === day ? account.planUsage.daily : { day, aiProjects: 0, messages: 0 },
  };
};

export function membership(account, now = Date.now()) {
  const id = planId(account, now);
  const { monthly, daily } = getUsage(account, now);
  return { id, expiresAt: id !== 'admin' && id !== 'free' ? new Date(account.planExpiresAt).toISOString() : null,
    limits: planLimits(account, now), used: { projects: monthly.projects, messages: daily.messages, aiProjects: daily.aiProjects } };
}

const exhausted = {
  projects: 'You reached this month’s project limit. View plans in Settings to request more projects.',
  aiProjects: 'You reached today’s shared AI project limit. Use your own key or Local analysis.',
  messages: 'You reached today’s shared AI message limit. Switch to a personal AI profile or try tomorrow.',
};

// Check all related quotas before incrementing any. Callers reserve only after
// validation and before an await, so parallel submissions cannot spend a slot twice.
export function reserveUsage(account, { project = false, aiProject = false, message = false, checkOnly = false }, now = Date.now()) {
  if (account.role === 'admin') return;
  const { monthly, daily } = getUsage(account, now);
  const limits = planLimits(account, now);
  const needed = [[project, 'projects', monthly], [aiProject, 'aiProjects', daily], [message, 'messages', daily]];
  for (const [enabled, key, counter] of needed) {
    if (enabled && limits[key] !== null && counter[key] >= limits[key]) throw new HttpError(429, exhausted[key]);
  }
  if (checkOnly) return;
  for (const [enabled, key, counter] of needed) if (enabled) counter[key]++;
  account.planUsage = { monthly, daily };
}

export function updateMembership(account, body, now = Date.now()) {
  if (account.role !== 'member' || !body || !Object.hasOwn(plans, body.plan) || (body.renew !== undefined && typeof body.renew !== 'boolean')) {
    throw new HttpError(400, 'Choose a member and a valid membership plan.');
  }
  const { plan, renew, overrides = account.planOverrides || {} } = body;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) || Object.entries(overrides).some(([key, val]) =>
    !Object.hasOwn(overrideMax, key) || !Number.isInteger(val) || val < 1 || val > overrideMax[key])) throw new HttpError(400, 'Enter valid whole-number limit overrides or leave them blank.');
  // Preserve counters when a plan changes. A same-plan limits edit doesn't
  // extend the subscription unless the administrator explicitly renews it.
  const active = planId(account, now);
  if (plan === 'free') delete account.planExpiresAt;
  else if (active !== plan || renew) account.planExpiresAt = oneMonthLater(active === plan && renew ? account.planExpiresAt : now);
  account.plan = plan;
  account.planOverrides = { ...overrides };
  account.premiumRequested = false;
  return membership(account, now);
}
