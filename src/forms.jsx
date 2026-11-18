import { cloneElement, useId } from 'react';
import { ChevronDown, Eye, EyeOff } from 'lucide-react';

export function Field({ label, hint, children }) {
  const id = useId();
  return <div className="form-field"><label htmlFor={id}>{label}</label>{cloneElement(children, { id, 'aria-describedby': hint ? `${id}-hint` : undefined })}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
export function PasswordInput({ show, onToggle, noun = 'password', ...props }) {
  return <div className="password-field"><input type={show ? 'text' : 'password'} autoComplete="new-password" spellCheck="false" {...props}/><button type="button" className="field-icon-button" aria-label={`${show ? 'Hide' : 'Show'} ${noun}`} onClick={onToggle}>{show ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div>;
}
export function Select({ children, ...attrs }) { return <span className="select-wrap"><select {...attrs}>{children}</select><ChevronDown size={15}/></span>; }
