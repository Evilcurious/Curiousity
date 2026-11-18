import { useEffect, useState } from 'react';
import { ArrowRight, Check, Clapperboard, LockKeyhole, ScanLine, Sparkles } from 'lucide-react';
import { api, Banner, Button } from './ui.jsx';
import { Field, PasswordInput } from './forms.jsx';
import { Logo } from './brand.jsx';

const signupRoute = () => /^#\/?signup\/?$/.test(window.location.hash);

export default function Access({ session, onSignedIn, startupError, notice, retry }) {
  const [signup, setSignup] = useState(signupRoute);
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const join = signup && session?.allowSignup !== false;
  useEffect(() => {
    const handle = () => { setSignup(signupRoute()); setError(''); setConfirm(''); setPassword(''); setVisible(false); };
    window.addEventListener('hashchange', handle);
    return () => window.removeEventListener('hashchange', handle);
  }, []);
  useEffect(() => { document.title = `Curiousity — ${join ? 'Sign up' : 'Sign in'}`; }, [join]);
  async function submit(event) {
    event.preventDefault(); setError('');
    if (join && password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const body = { email, password, ...(join ? { confirmPassword: confirm } : {}) };
      const next = await api(join ? '/auth/signup' : '/auth/signin', { method: 'POST', body });
      if (/^#\/?(sign(in|up))\/?$/.test(window.location.hash)) window.history.replaceState(null, '', '#/studio');
      onSignedIn(next);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <main className="access-shell">
    <section className="access-left" aria-labelledby="access-title">
      <header className="access-kicker"><ScanLine size={17}/> CREATOR WORKSPACE</header>
      <div className="access-form-wrap">
        <div className="access-step"><span/><span>ACCOUNT ACCESS</span></div>
        <h1 id="access-title">{join ? 'Make an account.' : 'Welcome back.'}</h1>
        <p className="access-description">{join ? 'Create your account to start clipping and set up your own connections.' : 'Sign in to continue to your Curiousity workspace.'}</p>
        <div className="access-tabs" aria-label="Choose sign in or sign up">
          <a href="#/signin" aria-current={!join ? 'page' : undefined}>Sign in</a>
          {session?.allowSignup !== false && <a href="#/signup" aria-current={join ? 'page' : undefined}>Sign up</a>}
        </div>
        {!join && notice && <div role="status"><Banner tone="success" icon={Check}>{notice}</Banner></div>}
        {startupError && <Banner>{startupError} <button type="button" className="inline-action" onClick={retry}>Retry</button></Banner>}
        <form className="access-fields" onSubmit={submit}>
          <Field label="Email address"><input type="email" name="email" required autoComplete="username" spellCheck="false" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com"/></Field>
          <Field label="Password" hint={join ? 'At least 10 characters. Use a unique password.' : undefined}><PasswordInput name="password" show={visible} onToggle={() => setVisible(!visible)} required autoComplete={join ? 'new-password' : 'current-password'} minLength={join ? 10 : undefined} maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password"/></Field>
          {join && <Field label="Repeat password"><input type="password" name="confirmPassword" required autoComplete="new-password" minLength={10} maxLength={256} value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="Repeat your password"/></Field>}
          {error && <Banner>{error}</Banner>}
          <Button type="submit" busy={busy} tone="primary" className="access-submit">{join ? 'Create account' : 'Sign in'}<ArrowRight size={17}/></Button>
        </form>
      </div>
      <footer className="access-footer"><LockKeyhole size={15}/> Your keys and connections stay in your account.</footer>
    </section>
    <aside className="access-art" aria-label="Curiousity">
      <div className="access-art-image" aria-hidden="true"/>
      <div className="access-art-meta"><span><Clapperboard size={14}/> VIDEO WORKSPACE</span><span>01 / STUDIO</span></div>
      <div className="access-wordmark"><Logo branding={session?.branding}/><strong>Curiousity<span>.</span></strong><p>Find the clip worth sharing.</p></div>
      <div className="access-art-meta access-art-bottom"><span><Sparkles size={14}/> FIND · CUT · SHARE</span><span>MP4 / SRT</span></div>
    </aside>
  </main>;
}
