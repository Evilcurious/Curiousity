import { useId, useState } from 'react';
import { Check, ChevronDown, RotateCcw, Type } from 'lucide-react';
import { captionAnimations, captionBottom, captionEffects, captionExitAnimations, captionFontFamily, captionFonts, captionPresets, captionScriptFont, captionSizes, highlightColor, highlightRestColor, matchingPreset, resolveCaptionStyle } from '../shared/captions.mjs';
import { romanUrdu } from '../shared/exports.mjs';
import { Banner, Button, Modal } from './ui.jsx';
import './caption-styles.css';

const samples = {
  [romanUrdu]: 'Yahan se kahani shuru hoti hai.', ur: 'یہیں سے کہانی شروع ہوتی ہے۔', ar: 'هنا تبدأ القصة.', hi: 'कहानी यहीं से शुरू होती है।',
  bn: 'গল্প এখান থেকেই শুরু।', es: 'Aquí empieza la historia.', fr: 'Tout commence ici.', zh: '故事从这里开始。', ko: '여기서 이야기가 시작돼요.', ja: 'ここから物語が始まる。',
};

function StyleSelect({ label, options, value, onChange, disabled }) {
  const id = useId();
  return <div className="form-field"><label htmlFor={id}>{label}</label><span className="select-wrap"><select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{Object.entries(options).map(([key, choice]) => <option key={key} value={key}>{choice.label}</option>)}</select><ChevronDown size={14}/></span></div>;
}

export function CaptionStyleTiles({ value, onChange, disabled }) {
  const active = matchingPreset(value);
  return <div className="caption-preset-grid" role="group" aria-label="Caption presets">
    {Object.entries(captionPresets).map(([id, preset]) => {
      const effect = captionEffects[preset.style.effect];
      return <button key={id} type="button" className="caption-preset" aria-pressed={active === id} disabled={disabled} onClick={() => onChange(preset.style)}
        style={{ '--tile-ink': effect.highlight || effect.color, '--tile-halo': effect.glow || effect.highlight || effect.color, '--tile-face': `"Curiousity ${captionFontFamily(preset.style)}", sans-serif`, '--tile-edge': effect.edge }}>
        <span className="caption-tile-art" aria-hidden="true" data-box={effect.box || undefined} data-preset={id}>
          {preset.sample.map((line, index) => <span key={line} className={index === preset.sample.length - 1 ? 'tile-accent' : ''}>{line}</span>)}
        </span>
        <span className="caption-tile-label">{preset.label}</span>
        {active === id && <span className="caption-tile-check" aria-hidden="true"><Check size={10} strokeWidth={3}/></span>}
      </button>;
    })}
  </div>;
}

// This browser sample approximates the burn-in. The finished MP4 is the exact
// preview; its subtitles are generated from the same validated style values.
export function CaptionSample({ value, frame, language, play = 0, sample }) {
  const style = resolveCaptionStyle(value);
  const effect = captionEffects[style.effect];
  const highlighting = style.animation === 'highlight';
  const phrase = sample || samples[language] || 'This is where the story starts.';
  const previewVars = {
    '--sample-bottom': `${captionBottom(frame.width, frame.height) * 100}%`,
    '--sample-font': `"Curiousity ${captionFontFamily(style, language)}", sans-serif`,
    '--sample-size': `${Math.min(1, frame.height / frame.width) * captionSizes[style.size].scale * 135}cqw`,
    '--sample-color': highlighting ? effect.rest || highlightRestColor : effect.color, '--sample-highlight': effect.highlight || highlightColor,
    '--sample-edge': effect.edge, '--sample-stroke': `${effect.box ? 0 : effect.outline / 2.5}px`,
    '--sample-shadow': effect.glow ? `0 0 8px ${effect.glow}, 0 2px 3px ${effect.edge}` : `0 ${effect.shadow / 2}px ${effect.shadow / 2}px ${effect.edge}`,
  };
  return <div className="caption-sample" style={previewVars} data-animation={style.animation} data-exit={style.exitAnimation} data-box={effect.box || undefined} key={`${play}:${Object.values(style).join(':')}`} dir="auto" aria-hidden="true">
    <div className="caption-sample-entry"><span className="caption-sample-text">{highlighting ? phrase.split(/(\s+)/).map((word, index, parts) => index % 2 ? word : <span className="caption-sample-word" key={index} style={{ animationDelay: `${index / (parts.length + 1) * 1850}ms` }}>{word}</span>) : phrase}</span></div>
  </div>;
}

export default function CaptionAppearance({ value, frame, language, canBurn, onClose, onApply }) {
  const [style, setStyle] = useState(() => resolveCaptionStyle(value));
  const [play, setPlay] = useState(0);
  const set = (key, choice) => setStyle((previous) => ({ ...previous, [key]: choice }));
  const ratio = frame.width / frame.height;
  const maxWidth = Math.min(400, 225 * ratio);
  const bundled = captionScriptFont(language);
  const highlighting = style.animation === 'highlight';
  return <Modal title="Caption style" subtitle="Preview the type, effects and motion that will appear in the MP4. The SRT stays plain text." onClose={onClose}>
    <div className="caption-design">
      <div className="caption-design-head"><span><Type size={15}/> Style preview <small>{frame.ratio || `${frame.width} × ${frame.height}`}</small></span><Button icon={RotateCcw} onClick={() => setPlay((n) => n + 1)}>Replay</Button></div>
      <div className="caption-design-stage" style={{ '--sample-ratio': ratio, '--sample-width': `${maxWidth}px` }}>
        <div className="caption-design-frame"><CaptionSample value={style} frame={frame} language={language} play={play}/></div>
      </div>
      <details className="caption-preset-picker"><summary>Browse {Object.keys(captionPresets).length} presets</summary><CaptionStyleTiles value={style} onChange={setStyle}/></details>
      <div className="form-pair caption-design-options">
        <StyleSelect label="Font style" value={bundled ? 'auto' : style.font} options={captionFonts} onChange={(choice) => set('font', choice)} disabled={Boolean(bundled)}/>
        <StyleSelect label="Font effect" value={style.effect} options={captionEffects} onChange={(choice) => set('effect', choice)}/>
        <StyleSelect label="Font size" value={style.size} options={captionSizes} onChange={(choice) => set('size', choice)}/>
        <StyleSelect label="In / cue animation" value={style.animation} options={captionAnimations} onChange={(choice) => set('animation', choice)}/>
        <StyleSelect label="Out animation" value={style.exitAnimation} options={captionExitAnimations} onChange={(choice) => set('exitAnimation', choice)}/>
      </div>
      {(bundled || highlighting) && <p className="caption-design-note">{bundled && `This script uses ${bundled}. `}{highlighting && 'Word timing is estimated from each cue, not aligned to speech.'}</p>}
      {canBurn === false && <Banner tone="warning">This server’s FFmpeg has no libass filter. Styles are preview-only until libass is installed; you can still export SRT.</Banner>}
    </div>
    <div className="modal-actions"><Button onClick={onClose}>Cancel</Button><Button tone="primary" icon={Check} onClick={() => onApply(style)}>Apply style</Button></div>
  </Modal>;
}
