export const plans = Object.freeze({
  free: { label: 'Free', price: 0, limits: { projects: 1, aiProjects: 1, messages: 3, tiktokAccounts: 1 } },
  basic: { label: 'Basic', price: 3000, limits: { projects: 20, aiProjects: 3, messages: 5, tiktokAccounts: 3 } },
  premium: { label: 'Premium', price: 5000, limits: { projects: null, aiProjects: 5, messages: 10, tiktokAccounts: 5 } },
  elite: { label: 'Elite', price: null, limits: { projects: null, aiProjects: null, messages: 30, tiktokAccounts: 10 } },
});
export const limitLabels = { projects: 'Projects / month', aiProjects: 'Shared AI projects / day', messages: 'Shared AI messages / day', tiktokAccounts: 'Legacy TikTok accounts' };
export const overrideMax = { projects: 10_000, aiProjects: 500, messages: 2000, tiktokAccounts: 50 };
export const planLabel = (id) => id === 'admin' ? 'Administrator' : plans[id]?.label || 'Free';
export const planPrice = (price) => price === null ? 'Contact for price' : price === 0 ? 'Free' : `PKR ${price.toLocaleString('en-PK')} / month`;
export function planPurchase(id) {
  if (!Object.hasOwn(plans, id) || id === 'free') return null;
  const message = `Hi, I would like to buy the Curiousity ${plans[id].label} monthly plan.`;
  return `https://wa.me/923174541414?text=${encodeURIComponent(message)}`;
}
