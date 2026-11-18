import { useId, useState } from 'react';
import { Check, ChevronDown, RotateCcw, Type } from 'lucide-react';
import { captionAnimations, captionBottom, captionEffects, captionExitAnimations, captionFontFamily, captionFonts, captionScriptFont, captionSizes, highlightColor, highlightRestColor, resolveCaptionStyle } from '../shared/captions.mjs';
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

export default function CaptionAppearance({ value, frame, language, canBurn, onClose, onApply }) {
  const [style, setStyle] = useState(() => resolveCaptionStyle(value));
  const [play, setPlay] = useState(0);
  const set = (key, choice) => setStyle((previous) => ({ ...previous, [key]: choice }));
  const effect = captionEffects[style.effect];
  const sample = Object.hasOwn(samples, language) ? samples[language] : 'This is where the story starts.';
  const ratio = frame.width / frame.height;
  const maxWidth = Math.min(400, 225 * ratio);
  const bundled = captionScriptFont(language);
  const highlighting = style.animation === 'highlight';
  const previewVars = {
    '--sample-ratio': ratio, '--sample-width': `${maxWidth}px`, '--sample-bottom': `${captionBottom(frame.width, frame.height) * 100}%`,
    '--sample-font': `"Clipforge ${captionFontFamily(style, language)}", sans-serif`,
    '--sample-size': `${Math.max(11, Math.min(maxWidth, maxWidth / ratio) * captionSizes[style.size].scale * 1.5)}px`,
    '--sample-color': highlighting ? highlightRestColor : effect.color, '--sample-highlight': highlightColor,
    '--sample-edge': effect.edge, '--sample-stroke': `${effect.box ? 0 : effect.outline / 2.5}px`,
    '--sample-shadow': effect.glow ? `0 0 8px ${effect.glow}, 0 2px 3px ${effect.edge}` : `0 ${effect.shadow / 2}px ${effect.shadow / 2}px ${effect.edge}`,
  };
  return <Modal title="Caption style" subtitle="Preview the type, effects and motion that will appear in the MP4. The SRT stays plain text." onClose={onClose}>
    <div className="caption-design">
      <div className="caption-design-head"><span><Type size={15}/> Style preview <small>{frame.ratio}</small></span><Button icon={RotateCcw} onClick={() => setPlay((n) => n + 1)}>Replay</Button></div>
      <div className="caption-design-stage" style={previewVars}>
        <div className="caption-design-frame">
          <div className="caption-sample" data-animation={style.animation} data-exit={style.exitAnimation} data-effect={style.effect} key={`${play}:${Object.values(style).join(':')}`} dir="auto">
            <div className="caption-sample-entry"><span className="caption-sample-text">{highlighting ? sample.split(/(\s+)/).map((word, index, parts) => index % 2 ? word : <span className="caption-sample-word" key={index} style={{ animationDelay: `${index / (parts.length + 1) * 2100}ms` }}>{word}</span>) : sample}</span></div>
          </div>
        </div>
      </div>
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
