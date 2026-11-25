import { Cpu, Sparkles } from 'lucide-react';

export default function MediaModes({ label, value, onChange, disabled, localDetail, aiDetail }) {
  return <div className="media-mode-choice" role="group" aria-label={label}>
    {[['local', 'Local', Cpu, localDetail], ['ai', 'AI', Sparkles, aiDetail]].map(([id, title, Icon, detail]) =>
      <button key={id} type="button" aria-pressed={value === id} disabled={disabled} onClick={() => onChange(id)}>
        <Icon size={17}/><span><strong>{title}</strong><small>{detail}</small></span>
      </button>)}
  </div>;
}
