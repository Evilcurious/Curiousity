import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertCircle, BookOpen, Captions, Check, ChevronRight, Clapperboard, Crown, FolderOpen, LoaderCircle, Menu, MessageSquare, Palette, PanelTop, Settings, Shield, X } from 'lucide-react';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/manrope/latin-800.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './styles.css';
import './workspace.css';
import Studio, { initialFields } from './studio.jsx';
import { Library, Project } from './projects.jsx';
import { Integrations, Providers, Setup } from './settings.jsx';
import { ACTIVE, api } from './ui.jsx';
import { clipUploading } from './delivery.jsx';
import { AccountSettings, AdminSettings, Appearance, SettingsHome, SettingsTabs, sections } from './account-settings.jsx';
import { McpSettings } from './mcp.jsx';
import { applyBrand, Wordmark } from './brand.jsx';
import Access from './auth.jsx';
import { TemporaryPasswordSettings } from './password-settings.jsx';
import CaptionsPage from './captions-page.jsx';
import ChatPage from './chat-page.jsx';

const navigation = [
  { id: 'studio', label: 'Clip Studio', icon: Clapperboard }, { id: 'library', label: 'Clip Library', icon: FolderOpen },
  { id: 'captions', label: 'Captions', icon: Captions }, { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'settings', label: 'Settings', icon: Settings },
];
function readRoute() {
  const [raw, query = ''] = window.location.hash.replace(/^#\/?/, '').split('?');
  const [page, id] = raw.split('/');
  const params = new URLSearchParams(query);
  if (page === 'project' && id) return { page, id };
  if (page === 'settings' || page === 'providers' || page === 'integrations') return { page: 'settings', tab: page === 'settings' ? sections.find((section) => section.id === id)?.id : page, notice: params.get('notice'), preset: params.get('preset') };
  if (page === 'library') return { page, shared: id === 'shared' };
  return { page: ['setup', 'captions', 'chat'].includes(page) ? page : 'studio' };
}

function App() {
  const [session, setSession] = useState(null), [starting, setStarting] = useState(true), [startupError, setStartupError] = useState('');
  const [accessNotice, setAccessNotice] = useState('');
  const startupVersion = useRef(0);
  const check = useCallback(async (signal) => {
    const version = ++startupVersion.current;
    setStarting(true); setStartupError('');
    try { const data = await api('/auth/session', { signal }); if (version === startupVersion.current) setSession(data); }
    catch (err) { if (!signal?.aborted && version === startupVersion.current) setStartupError(err.message); }
    finally { if (!signal?.aborted && version === startupVersion.current) setStarting(false); }
  }, []);
  useEffect(() => { const ctrl = new AbortController(); check(ctrl.signal); return () => ctrl.abort(); }, [check]);
  useLayoutEffect(() => { applyBrand(session?.branding, session?.user?.theme); }, [session?.branding, session?.user?.theme]);
  if (starting) return <main className="startup-screen" role="status"><LoaderCircle size={20} className="spin"/> Loading Curiousity…</main>;
  if (!session?.user) return <Access session={session} onSignedIn={(data) => { setAccessNotice(''); setSession(data); }} startupError={startupError} notice={accessNotice} retry={() => check()}/>;
  const id = session.user.id;
  const signedOut = () => setSession((previous) => previous?.user?.id === id ? { ...previous, user: null } : previous);
  function returnToSignIn() {
    window.history.replaceState(null, '', '#/signin');
    signedOut();
  }
  function passwordChanged() {
    setAccessNotice('Password updated. Sign in with your new password.');
    returnToSignIn();
  }
  if (session.user.mustChangePassword) return <TemporaryPasswordSettings user={session.user} branding={session.branding} onChanged={passwordChanged} onSignedOut={returnToSignIn}/>;
  return <Workspace key={id} session={session} onSession={(patch) => setSession((previous) => previous?.user?.id === id ? { ...previous, ...patch } : previous)} onSignedOut={signedOut} onPasswordChanged={passwordChanged}/>;
}

function Workspace({ session, onSession, onSignedOut, onPasswordChanged }) {
  const { user, branding } = session;
  const [route, setRoute] = useState(readRoute), [menu, setMenu] = useState(false);
  const [workspace, setWorkspace] = useState(null), [online, setOnline] = useState('checking'), [signingOut, setSigningOut] = useState(false);
  const [projects, setProjects] = useState([]), [projectsLoaded, setProjectsLoaded] = useState(false), [projectsError, setProjectsError] = useState('');
  const [fields, setFields] = useState(initialFields), [toast, setToast] = useState(null);
  const toastTimer = useRef(null), currentProjects = useRef([]), requestVersion = useRef(0), workspaceVersion = useRef(0);
  const authActions = useRef({ onSession, onSignedOut });
  authActions.current = { onSession, onSignedOut };
  const notify = useCallback((message, tone = 'success') => {
    setToast({ message, tone });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4600);
  }, []);
  const refresh = useCallback(async (announce, signal) => {
    const version = ++workspaceVersion.current;
    try {
      const data = await api('/workspace', { signal });
      if (version !== workspaceVersion.current || signal?.aborted) return false;
      if (data.user?.id !== user.id) { authActions.current.onSignedOut(); return false; }
      setWorkspace(data); setOnline('online');
      authActions.current.onSession({ user: data.user, branding: data.branding });
      return true;
    } catch (err) {
      if (signal?.aborted || version !== workspaceVersion.current) return false;
      if (err.status === 401) authActions.current.onSignedOut();
      setOnline('offline'); if (announce === true) notify(err.message, 'error'); return false;
    }
  }, [notify, user.id]);
  function setSession(patch) { ++workspaceVersion.current; onSession(patch); }
  async function signOut() {
    setSigningOut(true);
    try { await api('/auth/signout', { method: 'POST' }); window.history.replaceState(null, '', '#/signin'); onSignedOut(); }
    catch (err) { notify(err.message, 'error'); }
    finally { setSigningOut(false); }
  }
  useEffect(() => {
    const onRoute = () => { setRoute(readRoute()); setMenu(false); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onRoute);
    return () => { window.removeEventListener('hashchange', onRoute); clearTimeout(toastTimer.current); };
  }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    refresh(false, ctrl.signal);
    const timer = setInterval(() => refresh(false, ctrl.signal), 16_000);
    return () => { ctrl.abort(); clearInterval(timer); ++workspaceVersion.current; };
  }, [refresh]);
  useEffect(() => {
    const ctrl = new AbortController();
    let timer;
    async function load() {
      const version = ++requestVersion.current;
      try {
        const next = await api('/projects', { signal: ctrl.signal });
        if (!ctrl.signal.aborted && requestVersion.current === version) {
          currentProjects.current = next; setProjects(next); setProjectsLoaded(true); setProjectsError('');
        }
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (err.status === 401) { authActions.current.onSignedOut(); return; }
        setProjectsLoaded(true); setProjectsError(err.message);
      }
      if (!ctrl.signal.aborted) timer = setTimeout(load, currentProjects.current.some((p) => (ACTIVE.has(p.status) && p.status !== 'waiting_replay') || p.clips.some(clipUploading)) ? 1100 : 5000);
    }
    load();
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [route.page, route.id]);
  useEffect(() => {
    const key = (event) => { if (event.key === 'Escape') setMenu(false); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const activePage = route.page === 'project' ? 'library' : route.page;
  const label = route.page === 'project' ? 'Project' : navigation.find((item) => item.id === route.page)?.label || 'Setup Guide';
  useEffect(() => { document.title = `Curiousity — ${label}`; }, [label]);
  const current = projects.find((project) => project.id === route.id);
  const updateProject = (updated) => {
    ++requestVersion.current;
    const previous = currentProjects.current;
    currentProjects.current = previous.some((p) => p.id === updated.id) ? previous.map((p) => p.id === updated.id ? updated : p) : [updated, ...previous];
    setProjects(currentProjects.current); setProjectsLoaded(true);
  };
  function openProject(project) { updateProject(project); window.location.hash = `#/project/${project.id}`; }
  async function createProject(options) { openProject(await api('/projects', { method: 'POST', body: options })); }
  function useDiscoverySource(url, live) {
    setFields((previous) => ({ ...previous, url, mode: live ? 'replay' : 'auto' }));
    window.location.hash = '#/studio';
    notify('YouTube link added. Review the settings before generating clips.');
  }
  async function removeProject(id) {
    await api(`/projects/${id}`, { method: 'DELETE' });
    ++requestVersion.current;
    currentProjects.current = currentProjects.current.filter((p) => p.id !== id);
    setProjects(currentProjects.current);
    window.location.hash = '#/library'; notify('Project deleted.');
  }
  const navItem = ({ id, label: title, icon: Icon }) => <a className={`nav-item ${activePage === id ? 'active' : ''}`} href={`#/${id}`} key={id} onClick={() => setMenu(false)} aria-current={activePage === id ? 'page' : undefined}><Icon size={18} strokeWidth={1.7}/><span>{title}</span>{activePage === id && <span className="nav-active-dot"/>}</a>;
  function settings() {
    const props = { user, workspace, refresh, notify };
    switch (route.tab) {
      case 'account': return <AccountSettings user={user} onSession={setSession} notify={notify} signOut={signOut} signingOut={signingOut} onPasswordChanged={onPasswordChanged}/>;
      case 'appearance': return <Appearance user={user} branding={branding} onSession={setSession} notify={notify}/>;
      case 'admin': return <AdminSettings user={user} branding={branding} onBrand={(next) => setSession({ branding: next })} notify={notify}/>;
      case 'providers': return <Providers {...props}/>;
      case 'integrations': return <Integrations {...props} notice={route.notice}/>;
      case 'mcp': return <McpSettings key={route.preset || 'list'} {...props} preset={route.preset}/>;
      default: return <SettingsHome user={user} workspace={workspace} branding={branding}/>;
    }
  }
  return <div className="app-shell">
    <a href="#main-content" className="skip-link" onClick={(event) => { event.preventDefault(); document.getElementById('main-content').focus(); }}>Skip to content</a>
    {menu && <button type="button" className="nav-overlay" onClick={() => setMenu(false)} aria-label="Close navigation"/>}
    <aside className={`sidebar ${menu ? 'sidebar-open' : ''}`} id="workspace-nav" aria-label="Workspace menu">
      <a className="brand" href="#/studio" onClick={() => setMenu(false)} aria-label="Curiousity studio"><Wordmark branding={branding}/></a>
      <nav className="sidebar-nav" aria-label="Main navigation">
        <div className="nav-group"><p className="nav-label">WORKSPACE</p>{navigation.map(navItem)}</div>
        <div className="nav-group resources"><p className="nav-label">RESOURCES</p>{navItem({ id: 'setup', label: 'Setup Guide', icon: BookOpen })}</div>
      </nav>
      <div className="sidebar-bottom"><a className="instance account-chip" href="#/settings/account" onClick={() => setMenu(false)} title={user.email}><span className="instance-icon">{user.email[0].toUpperCase()}</span><div><strong>{user.email}</strong><span>{user.role === 'admin' ? <><Shield size={11}/> Administrator</> : user.premium ? <><Crown size={11}/> Premium</> : 'Member account'}</span></div><ChevronRight size={14}/></a></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="topbar-inner">
        <div className="breadcrumbs"><button type="button" className="icon-button mobile-menu" aria-label={menu ? 'Close navigation' : 'Open navigation'} aria-expanded={menu} aria-controls="workspace-nav" onClick={() => setMenu(!menu)}>{menu ? <X size={20}/> : <Menu size={20}/>}</button><PanelTop className="breadcrumb-icon" size={17} strokeWidth={1.7}/><a href="#/studio" className="breadcrumb-root">Workspace</a><ChevronRight className="breadcrumb-divider" size={13}/><span>{label}</span></div>
        <div className="top-actions"><button type="button" className={`engine-pill engine-${online}`} onClick={() => refresh(true)} title="Refresh engine status"><span className="engine-dot"/>{online === 'online' ? 'Engine online' : online === 'checking' ? 'Checking engine' : 'Engine offline'}</button><a href="#/settings/appearance" className="icon-button theme-shortcut" aria-label="Switch theme" title="Switch theme"><Palette size={17}/></a></div>
      </div></header>
      <main id="main-content" className="workspace-content" tabIndex={-1}>
        {route.page === 'studio' && <Studio user={user} workspace={workspace} projects={projects} projectsError={projectsError} createProject={createProject} notify={notify} fields={fields} setFields={setFields}/>}
        {route.page === 'library' && <Library shared={route.shared} user={user} projects={projects} loading={!projectsLoaded} error={projectsError} createProject={createProject} openProject={openProject} notify={notify}/>}
        {route.page === 'project' && <Project key={route.id} job={current} loading={!projectsLoaded} loadError={projectsError} workspace={workspace} createProject={createProject} updateProject={updateProject} removeProject={removeProject} notify={notify}/>}
        {route.page === 'settings' && <><SettingsTabs tab={route.tab} user={user}/>{settings()}</>}
        {route.page === 'captions' && <CaptionsPage workspace={workspace} notify={notify}/>}
        <div hidden={route.page !== 'chat'}><ChatPage workspace={workspace} onUseSource={useDiscoverySource}/></div>
        {route.page === 'setup' && <Setup workspace={workspace} refresh={refresh} notify={notify}/>}
      </main>
    </div>
    {toast && <div className={`toast toast-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>{toast.tone === 'error' ? <AlertCircle size={17}/> : <Check size={17}/>}<span>{toast.message}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={15}/></button></div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
