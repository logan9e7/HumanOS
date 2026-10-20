'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, BookOpen, BrainCircuit, ChevronRight, GitBranch, LockKeyhole, LogOut, Menu, MessageCircle, PanelLeftClose, PanelLeftOpen, Sparkles, X } from 'lucide-react';
export type WorkspaceTab = 'conversation' | 'profile' | 'hypotheses' | 'notes';
const navigation = [
    { id: 'conversation', icon: MessageCircle, label: 'Conversation', description: 'A space to think out loud' },
    { id: 'profile', icon: BrainCircuit, label: 'Your patterns', description: '50 evolving parameters' },
    { id: 'hypotheses', icon: GitBranch, label: 'Hypotheses', description: 'Evidence, open to correction' },
    { id: 'notes', icon: BookOpen, label: 'Behind the model', description: 'How HumanOS works' },
] as const;
type Props = {
    tab: WorkspaceTab;
    onNavigate: (tab: WorkspaceTab) => void;
    displayName: string | null;
    signedIn: boolean;
    connected: boolean;
    observed: number;
    hypothesisCount: number;
    children: ReactNode;
};
export default function WorkspaceLayout({ tab, onNavigate, displayName, signedIn, connected, observed, hypothesisCount, children }: Props) {
    const [collapsed, setCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const drawer = useRef<HTMLDialogElement>(null);
    const menuButton = useRef<HTMLButtonElement>(null);
    const current = navigation.find(item => item.id === tab)!;
    useEffect(() => {
        try {
            setCollapsed(localStorage.getItem('humanos.sidebar.collapsed') === 'true');
        }
        catch { }
    }, []);
    useEffect(() => {
        if (!mobileOpen)
            return;
        const dialog = drawer.current;
        dialog?.showModal();
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const desktop = window.matchMedia('(min-width: 769px)');
        const closeOnDesktop = () => { if (desktop.matches)
            setMobileOpen(false); };
        desktop.addEventListener('change', closeOnDesktop);
        return () => {
            desktop.removeEventListener('change', closeOnDesktop);
            document.body.style.overflow = previousOverflow;
            dialog?.close();
            menuButton.current?.focus({ preventScroll: true });
        };
    }, [mobileOpen]);
    function toggleSidebar() {
        const next = !collapsed;
        setCollapsed(next);
        try {
            localStorage.setItem('humanos.sidebar.collapsed', String(next));
        }
        catch { }
    }
    function navigate(next: WorkspaceTab) {
        onNavigate(next);
        setMobileOpen(false);
        window.requestAnimationFrame(() => document.getElementById('page-title')?.focus({ preventScroll: true }));
    }
    function sidebarContent(mobile = false) {
        return <>
      <div className="sidebar-brand-row">
        <a className="brand" href="/" aria-label="HumanOS home" title={collapsed ? 'HumanOS' : undefined}>
          <span className="brandmark">H<span /></span>
          <span className="brand-word">HumanOS<span className="brand-subtitle">A little more understood.</span></span>
        </a>
        {mobile && <button className="chrome-button drawer-close" aria-label="Close navigation" autoFocus onClick={() => setMobileOpen(false)}><X size={20}/></button>}
      </div>
      <div className="workspace-label"><span className="workspace-dot"/><span>Personal workspace</span><span className="beta">BETA</span></div>
      <p className="nav-caption">YOUR SPACE</p>
      <nav aria-label={mobile ? 'Mobile navigation' : 'Main navigation'}>
        {navigation.map(({ id, icon: Icon, label, description }, index) => <div key={id} className={index === 3 ? 'nav-secondary' : undefined}>
          {index === 3 && <p className="nav-caption">UNDER THE SURFACE</p>}
          <button className={`nav-item ${tab === id ? 'active' : ''}`} aria-current={tab === id ? 'page' : undefined} aria-label={label} title={!mobile && collapsed ? label : undefined} onClick={() => navigate(id)}>
            <Icon size={20}/><span className="nav-copy"><b>{label}</b><small>{description}</small></span>
            {id === 'profile' && <span className="nav-count">50</span>}
            {id === 'hypotheses' && hypothesisCount > 0 && <span className="nav-count">{hypothesisCount}</span>}
          </button>
        </div>)}
      </nav>
      <div className="sidebar-bottom">
        <button className="model-progress" onClick={() => navigate('profile')} aria-label={`${observed} of 50 parameters observed. Explore your patterns.`} title={!mobile && collapsed ? `${observed}/50 parameters observed` : undefined}>
          <span className="model-progress-icon"><Sparkles size={17}/></span>
          <span className="model-progress-copy"><span><b>Your evolving model</b><small>{observed}<span>/50</span></small></span><span className="progress-track"><span style={{ width: `${Math.min(observed, 50) * 2}%` }}/></span><span className="progress-caption">Built through conversation</span></span>
        </button>
        <div className="privacy-note"><LockKeyhole size={14}/><span>Private by design. Yours to correct.</span></div>
        <div className="account">
          <span className="account-avatar" aria-hidden="true">{displayName?.slice(0, 1).toUpperCase() || 'Y'}</span>
          <div className="account-copy"><b>{displayName || 'Your workspace'}</b><small>{signedIn ? 'Connected with ChatGPT' : 'Keep your understanding with you'}</small></div>
          {signedIn ? <a className="account-action" href="/signout-with-chatgpt?return_to=%2F" target="_top" aria-label="Sign out" title="Sign out"><LogOut size={17}/></a> : <a className="account-action" href="/signin-with-chatgpt?return_to=%2F" target="_top" aria-label="Sign in with ChatGPT" title="Sign in with ChatGPT"><ArrowUpRight size={17}/></a>}
        </div>
      </div>
    </>;
    }
    return <div className={`shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <a className="skip-link" href="#workspace-main">Skip to content</a>
    <aside className="sidebar desktop-sidebar" aria-label="Workspace sidebar">{sidebarContent()}</aside>
    <dialog ref={drawer} id="mobile-navigation" className="mobile-drawer" aria-label="Workspace navigation" onCancel={() => setMobileOpen(false)} onClose={() => setMobileOpen(false)} onClick={event => { if (event.target === event.currentTarget) {
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
            setMobileOpen(false);
    } }}>
      <div className="sidebar drawer-sidebar">{sidebarContent(true)}</div>
    </dialog>
    <main id="workspace-main" tabIndex={-1}>
      <header className="topbar">
        <div className="topbar-leading">
          <button className="chrome-button desktop-sidebar-toggle" onClick={toggleSidebar} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? <PanelLeftOpen size={20}/> : <PanelLeftClose size={20}/>}</button>
          <button ref={menuButton} className="chrome-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="mobile-navigation"><Menu size={21}/></button>
          <div className="breadcrumb"><span>My workspace</span><ChevronRight size={13}/><strong>{current.label}</strong></div>
        </div>
        <div className="top-status"><span className={connected ? 'server-status good' : 'server-status'}><span className="dot"/>{connected ? 'Connected' : 'Connecting…'}</span><span className="badge"><LockKeyhole size={13}/><span>Private workspace</span></span></div>
      </header>
      {children}
    </main>
  </div>;
}
