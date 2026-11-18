import { useLayoutEffect, useState } from 'react';
import { KeyRound, LockKeyhole } from 'lucide-react';
import { api, Banner, Button, PageHeading, PanelHeading } from './ui.jsx';
import { Field } from './forms.jsx';
import { Wordmark } from './brand.jsx';

export function PasswordSettings({ user, onChanged }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const minimum = user.role === 'admin' ? 14 : 10;
  async function save(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const { currentPassword, newPassword, confirmPassword } = Object.fromEntries(new FormData(form));
    const body = { currentPassword, newPassword, confirmPassword };
    setError('');
    if (body.newPassword !== body.confirmPassword) { setError('New passwords do not match.'); return; }
    if (body.currentPassword === body.newPassword) { setError('Choose a different password from your current one.'); return; }
    setBusy(true);
    try {
      await api('/account/password', { method: 'PUT', body });
      form.reset();
      onChanged();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="panel service-panel">
    <PanelHeading icon={KeyRound} title="Change password" description="After you save, sign in again with the new password. All other devices will be signed out too."/>
    <form className="modal-form password-change-form" aria-label="Change password" onSubmit={save}>
      <input className="password-form-username" type="text" name="username" autoComplete="username" value={user.email} readOnly tabIndex={-1} aria-hidden="true"/>
      <Field label={user.mustChangePassword ? 'Temporary password' : 'Current password'}><input type="password" name="currentPassword" autoComplete="current-password" maxLength={256} required disabled={busy}/></Field>
      <Field label="New password" hint={`Use at least ${minimum} characters and choose a password you don’t use elsewhere.`}><input type="password" name="newPassword" autoComplete="new-password" minLength={minimum} maxLength={256} required disabled={busy}/></Field>
      <Field label="Repeat new password"><input type="password" name="confirmPassword" autoComplete="new-password" minLength={minimum} maxLength={256} required disabled={busy}/></Field>
      {error && <Banner>{error}</Banner>}
      <div><Button type="submit" tone="primary" icon={LockKeyhole} busy={busy}>Save new password</Button></div>
    </form>
  </section>;
}

export function TemporaryPasswordSettings({ user, branding, onSignedOut, onChanged }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useLayoutEffect(() => {
    history.replaceState(null, '', '#/settings/account');
    document.title = 'Curiousity — Account';
  }, []);
  async function signOut() {
    setBusy(true);
    try { await api('/auth/signout', { method: 'POST' }); onSignedOut(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <main className="password-setup">
    <div className="brand"><Wordmark branding={branding}/></div>
    <div className="password-setup-content">
      <PageHeading label="SETTINGS / ACCOUNT" title="Set your password" subtitle={`You’re signed in as ${user.email}. Replace your temporary password to open the workspace.`}>
        <Button onClick={signOut} busy={busy}>Sign out</Button>
      </PageHeading>
      {error && <Banner>{error}</Banner>}
      <PasswordSettings user={user} onChanged={onChanged}/>
    </div>
  </main>;
}
