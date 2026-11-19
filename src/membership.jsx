import { ArrowUpRight, Captions, Clapperboard, Cpu, Crown, MessageSquare } from 'lucide-react';
import { limitLabels, plans, planPrice, planPurchase } from '../shared/membership.mjs';
import { ActionLink, Modal, TikTokIcon } from './ui.jsx';

const meters = { projects: Clapperboard, aiProjects: Cpu, messages: MessageSquare, tiktokAccounts: TikTokIcon };
const amount = (n) => n === null ? 'Unlimited' : n.toLocaleString();

export function PlanUsage({ plan, accounts = 0 }) {
  return <dl className="plan-usage">{Object.entries(limitLabels).map(([key, label]) => {
    const limit = plan.limits[key], used = key === 'tiktokAccounts' ? accounts : plan.used[key], Icon = meters[key];
    return <div key={key}><dt><Icon size={15}/>{label}</dt><dd>{limit === null ? 'Unlimited' : <>{used} <span>/ {amount(limit)}</span></>}</dd></div>;
  })}</dl>;
}

export function PlanPicker({ current, onClose }) {
  return <Modal title="Choose a Curiousity plan" subtitle="Paid plans last one month. Continue on WhatsApp to arrange payment and activation with the administrator." onClose={onClose} wide>
    <div className="plan-grid">{Object.entries(plans).map(([id, plan]) => {
      const url = planPurchase(id);
      return <article className={`plan-card ${id === 'premium' ? 'plan-highlight' : ''}`} key={id} aria-label={`${plan.label} plan`}>
        <div className="plan-card-heading"><h3>{id === 'premium' && <Crown size={17}/>} {plan.label}</h3>{id === current && <span className="badge badge-green">Current</span>}</div>
        <p className="plan-price">{planPrice(plan.price)}</p>
        <dl>{Object.entries(limitLabels).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{amount(plan.limits[key])}</dd></div>)}</dl>
        {url ? <ActionLink icon={ArrowUpRight} tone={id === 'premium' ? 'primary' : 'neutral'} href={url} target="_blank" rel="noopener noreferrer">{id === 'elite' ? 'Ask about Elite' : `Buy ${plan.label}`} on WhatsApp</ActionLink> : <p className="plan-no-expiry">No expiration</p>}
      </article>;
    })}</div>
    <p className="privacy-note"><Captions size={15}/><span>Only shared models use the AI allowance. Your own keys don’t count toward it. The project limit includes Studio, Captions, and saved shared clips. Usage windows reset in UTC.</span></p>
  </Modal>;
}
