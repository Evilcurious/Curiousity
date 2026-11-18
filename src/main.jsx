import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertCircle, BookOpen, Check, ChevronRight, CircleHelp, Clapperboard, Cpu, FolderOpen, Menu, PanelTop, Plug, Scissors, Server, X } from 'lucide-react';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/manrope/latin-800.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './styles.css';
import Studio, { initialFields } from './studio.jsx';
import { Library, Project } from './projects.jsx';
import { Integrations, Providers, Setup } from './settings.jsx';
import { ACTIVE, api } from './ui.jsx';
import { clipUploading } from './delivery.jsx';

const navigation = [
  { id: 'studio', label: 'Clip Studio', icon: Clapperboard }, { id: 'library', label: 'Clip Library', icon: FolderOpen },
  { id: 'providers', label: 'AI Providers', icon: Cpu }, { id: 'integrations', label: 'Integrations', icon: Plug },
];
function readRoute() {
  const [raw, query = ''] = window.location.hash.replace(/^#\/?/, '').split('?');
  const [page, id] = raw.split('/');
  if (page === 'project' && id) return { page, id };
  if (page === 'integrations') return { page, notice: new URLSearchParams(query).get('notice') };
  return { page: ['studio', 'library', 'providers', 'setup'].includes(page) ? page : 'studio' };
}

function App() {
  const [route, setRoute] = useState(readRoute);
  const [menu, setMenu] = useState(false);
  const [workspace, setWorkspace] = useState(null);
  const [online, setOnline] = useState('checking');
  const [projects, setProjects] = useState([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projectsError, setProjectsError] = useState('');
  const [fields, setFields] = useState(initialFields);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const currentProjects = useRef([]), requestVersion = useRef(0);
  const notify = useCallback((message, tone = 'success') => {
    setToast({ message, tone });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4600);
  }, []);
  const refresh = useCallback(async (announce) => {
    try { setWorkspace(await api('/workspace')); setOnline('online'); return true; }
    catch (error) { setOnline('offline'); if (announce === true) notify(error.message, 'error'); return false; }
  }, [notify]);
  useEffect(() => {
    const onRoute = () => { setRoute(readRoute()); setMenu(false); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onRoute);
    return () => { window.removeEventListener('hashchange', onRoute); clearTimeout(toastTimer.current); };
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 22_000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const ctrl = new AbortController();
    let timer;
    async function load() {
      const version = ++requestVersion.current;
      try {
        const next = await api('/projects', { signal: ctrl.signal });
        if (requestVersion.current === version) {
          currentProjects.current = next;
          setProjects(next);
          setProjectsLoaded(true);
          setProjectsError('');
        }
      } catch (error) {
        if (ctrl.signal.aborted) return;
        setProjectsLoaded(true);
        setProjectsError(error.message);
      }
      if (!ctrl.signal.aborted) timer = setTimeout(load, currentProjects.current.some((p) => ACTIVE.has(p.status) || p.clips.some(clipUploading)) ? 1100 : 5000);
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
  useEffect(() => { document.title = `Clipforge — ${label}`; }, [label]);
  const current = projects.find((project) => project.id === route.id);
  const updateProject = (updated) => {
    ++requestVersion.current;
    setProjects((previous) => {
      const next = previous.some((p) => p.id === updated.id) ? previous.map((p) => p.id === updated.id ? updated : p) : [updated, ...previous];
      currentProjects.current = next;
      return next;
    });
  };
  async function createProject(options) {
    const project = await api('/projects', { method: 'POST', body: options });
    updateProject(project);
    window.location.hash = `#/project/${project.id}`;
  }
  async function removeProject(id) {
    await api(`/projects/${id}`, { method: 'DELETE' });
    ++requestVersion.current;
    currentProjects.current = currentProjects.current.filter((p) => p.id !== id);
    setProjects(currentProjects.current);
    window.location.hash = '#/library';
    notify('Project deleted.');
  }
  const navItem = ({ id, label: title, icon: Icon }) => <a className={`nav-item ${activePage === id ? 'active' : ''}`} href={`#/${id}`} key={id} onClick={() => setMenu(false)} aria-current={activePage === id ? 'page' : undefined}><Icon size={18} strokeWidth={1.7}/><span>{title}</span>{activePage === id && <span className="nav-active-dot"/>}</a>;
  return <div className="app-shell">
    <a href="#main-content" className="skip-link" onClick={(event) => { event.preventDefault(); document.getElementById('main-content').focus(); }}>Skip to content</a>
    {menu && <button type="button" className="nav-overlay" onClick={() => setMenu(false)} aria-label="Close navigation"/>}
    <aside className={`sidebar ${menu ? 'sidebar-open' : ''}`} id="workspace-nav" aria-label="Workspace menu">
      <a className="brand" href="#/studio" onClick={() => setMenu(false)} aria-label="Clipforge studio"><span className="brand-mark"><Scissors size={22} strokeWidth={2.15}/></span><span>Clipforge<span className="brand-dot">.</span></span></a>
      <nav className="sidebar-nav" aria-label="Main navigation">
        <div className="nav-group"><p className="nav-label">WORKSPACE</p>{navigation.map(navItem)}</div>
        <div className="nav-group resources"><p className="nav-label">RESOURCES</p>{navItem({ id: 'setup', label: 'Setup Guide', icon: BookOpen })}</div>
      </nav>
      <div className="sidebar-bottom"><div className="instance"><span className="instance-icon"><Server size={17} strokeWidth={1.65}/></span><div><strong>Local workspace</strong><span><i/> Self-hosted</span></div><span className="instance-version">v1.0</span></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="topbar-inner">
        <div className="breadcrumbs"><button type="button" className="icon-button mobile-menu" aria-label={menu ? 'Close navigation' : 'Open navigation'} aria-expanded={menu} aria-controls="workspace-nav" onClick={() => setMenu(!menu)}>{menu ? <X size={20}/> : <Menu size={20}/>}</button><PanelTop className="breadcrumb-icon" size={17} strokeWidth={1.7}/><a href="#/studio" className="breadcrumb-root">Workspace</a><ChevronRight className="breadcrumb-divider" size={13}/><span>{label}</span></div>
        <div className="top-actions"><button type="button" className={`engine-pill engine-${online}`} onClick={() => refresh(true)} title="Refresh engine status"><span className="engine-dot"/>{online === 'online' ? 'Engine online' : online === 'checking' ? 'Checking engine' : 'Engine offline'}</button><a href="#/setup" className="icon-button help-button" aria-label="Setup help" title="Setup help"><CircleHelp size={18} strokeWidth={1.7}/></a></div>
      </div></header>
      <main id="main-content" className="workspace-content" tabIndex={-1}>
        {route.page === 'studio' && <Studio workspace={workspace} projects={projects} projectsError={projectsError} createProject={createProject} notify={notify} fields={fields} setFields={setFields}/>}
        {route.page === 'library' && <Library projects={projects} error={projectsError} createProject={createProject} notify={notify}/>}
        {route.page === 'project' && <Project job={current} loading={!projectsLoaded} loadError={projectsError} workspace={workspace} createProject={createProject} updateProject={updateProject} removeProject={removeProject} notify={notify}/>}
        {route.page === 'providers' && <Providers workspace={workspace} refresh={refresh} notify={notify}/>}
        {route.page === 'integrations' && <Integrations workspace={workspace} refresh={refresh} notice={route.notice} notify={notify}/>}
        {route.page === 'setup' && <Setup workspace={workspace} refresh={refresh} notify={notify}/>}
      </main>
    </div>
    {toast && <div className={`toast toast-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>{toast.tone === 'error' ? <AlertCircle size={17}/> : <Check size={17}/>}<span>{toast.message}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={15}/></button></div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
