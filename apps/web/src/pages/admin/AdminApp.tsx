import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, Bell, BookOpen, Bot, ClipboardList, Command, Database, Download, Flag, Gauge,
  Globe, Inbox, LayoutDashboard, LifeBuoy, LogOut, Megaphone, MessageSquare, Search, Settings,
  ShieldCheck, Sparkles, Users, Workflow, X,
} from 'lucide-react';
import { AdminError, adminFetch, type AdminSessionInfo } from './api';
import { Select, Skeleton, Toast, useToast, ConfirmDialog } from './ui';
import './admin.css';

const OverviewPage = lazy(() => import('./OverviewPage'));
const UsersPage = lazy(() => import('./UsersPage'));
const UserDetailPage = lazy(() => import('./UserDetailPage'));
const InboxPage = lazy(() => import('./InboxPage'));
const ProvidersPage = lazy(() => import('./ProvidersPage'));
const AnnouncementsPage = lazy(() => import('./AnnouncementsPage'));
const LegacyPanels = lazy(() => import('../AdminGate'));

/* ------------------------------------------------------------------- routes */

type NavEntry = { path: string; label: string; icon: typeof LayoutDashboard; group: string; built?: boolean; badge?: 'inbox' };

const NAV: NavEntry[] = [
  { path: '/admin', label: 'Overview', icon: LayoutDashboard, group: 'Monitor', built: true },
  { path: '/admin/health', label: 'System health', icon: Gauge, group: 'Monitor' },
  { path: '/admin/audit', label: 'Audit log', icon: ClipboardList, group: 'Monitor' },
  { path: '/admin/users', label: 'Users', icon: Users, group: 'People', built: true },
  { path: '/admin/reports', label: 'Reports', icon: AlertTriangle, group: 'People' },
  { path: '/admin/groups', label: 'Groups', icon: Globe, group: 'People' },
  { path: '/admin/content', label: 'Statuses & media', icon: MessageSquare, group: 'Content' },
  { path: '/admin/support', label: 'Support', icon: LifeBuoy, group: 'Content' },
  { path: '/admin/inbox', label: 'Inbox', icon: Inbox, group: 'Chatgram AI', built: true, badge: 'inbox' },
  { path: '/admin/providers', label: 'Model providers', icon: Workflow, group: 'Chatgram AI', built: true },
  { path: '/admin/knowledge', label: 'Knowledge base', icon: BookOpen, group: 'Chatgram AI' },
  { path: '/admin/ai-usage', label: 'AI usage', icon: Sparkles, group: 'Chatgram AI' },
  { path: '/admin/safety', label: 'AI safety', icon: ShieldCheck, group: 'Chatgram AI' },
  { path: '/admin/announcements', label: 'Announcements', icon: Megaphone, group: 'Operations', built: true },
  { path: '/admin/releases', label: 'App releases', icon: Download, group: 'Operations' },
  { path: '/admin/flags', label: 'Feature flags', icon: Flag, group: 'Operations' },
  { path: '/admin/settings', label: 'Settings', icon: Settings, group: 'Operations' },
  { path: '/admin/data-requests', label: 'Data requests', icon: Database, group: 'Operations' },
  { path: '/admin/security', label: 'Admin security', icon: ShieldCheck, group: 'Operations', built: true },
  { path: '/admin/legacy', label: 'Legacy panels', icon: ClipboardList, group: 'Operations', built: true },
];

const NAV_GROUPS = ['Monitor', 'People', 'Content', 'Chatgram AI', 'Operations'];

const PLACEHOLDERS: Record<string, { title: string; blurb: string; bullets: string[] }> = {
  '/admin/health': { title: 'System health', blurb: 'Gauges for the API, MongoDB, sockets, PM2, Cloudinary, SMTP and AI providers.', bullets: ['API / DB / socket status', 'Memory, CPU, disk and PM2 info', 'AI provider health + degraded banner', 'Run smoke test button', 'Deployed version and git commit'] },
  '/admin/audit': { title: 'Audit log', blurb: 'Every admin action with who/what/when/IP, searchable and append-only.', bullets: ['Filter by action and date', 'Before/after values (never secrets)', 'CSV export', 'Retention setting'] },
  '/admin/reports': { title: 'Reports & moderation', blurb: 'The moderation queue for reported users, groups, statuses and messages.', bullets: ['Side-by-side content preview', 'Dismiss / warn / remove / suspend', 'Status history'] },
  '/admin/groups': { title: 'Groups', blurb: 'Every group with owner, members and safety actions.', bullets: ['Members and invites', 'Freeze or delete a group', 'Change owner'] },
  '/admin/content': { title: 'Statuses & media', blurb: 'Recent statuses, uploaded media, storage per user and orphaned files.', bullets: ['Remove content', 'Largest files', 'Orphaned Cloudinary files'] },
  '/admin/support': { title: 'Support', blurb: 'Tickets, canned replies, assignment and response-time stats.', bullets: ['Priority and internal notes', 'Response-time statistics', 'Telegram link status'] },
  '/admin/knowledge': { title: 'Knowledge base', blurb: 'The answers Chatgram AI uses for Chatgram-specific questions.', bullets: ['Search and edit entries', 'Version history with rollback', 'Suggestions from the Inbox'] },
  '/admin/ai-usage': { title: 'AI usage', blurb: 'Requests and tokens per day and per provider, top questions and caps.', bullets: ['Usage per provider (7/30 days)', 'Top questions', 'Per-user caps'] },
  '/admin/safety': { title: 'AI safety', blurb: 'Blocked topics, limits and the system prompt.', bullets: ['Blocked topics and caps', 'System prompt editor with history', 'Live effect without a restart'] },
  '/admin/announcements': { title: 'Announcements', blurb: 'In-app banners, broadcasts and the empty-screen recommendations.', bullets: ['Message from the official account', 'Preview + send confirmation', 'Recommendations editor (item 4)'] },
  '/admin/releases': { title: 'App releases', blurb: 'Windows and Android versions, checksums and minimum supported version.', bullets: ['Release notes and file URLs', 'SHA-256 checksums', 'Force-update flag'] },
  '/admin/flags': { title: 'Feature flags & maintenance', blurb: 'Toggles for registration, status, groups, uploads, Chatgram AI and support.', bullets: ['Maintenance mode with a custom message', 'Read-only mode', 'Upload size and type limits'] },
  '/admin/settings': { title: 'Settings', blurb: 'Site name, URLs, SMTP, Telegram, retention and backups.', bullets: ['Telegram token is write-only', 'Backup status + back up now', 'Legal page links'] },
  '/admin/data-requests': { title: 'Data requests', blurb: 'Export or delete a user’s data on request, with a tracked status.', bullets: ['Export a user', 'Delete with a tracked request', 'Audit every action'] },
};

/* --------------------------------------------------------------- error edge */

class PageBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="admin-card admin-card-pad">
          <p className="text-[14px] font-semibold">This page hit an error.</p>
          <p className="mt-1 text-[12.5px] text-[var(--ad-muted)]">{String(this.state.error.message).slice(0, 240)}</p>
          <button type="button" className="admin-btn mt-3" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ------------------------------------------------------------------- shell */

function Shell({
  session,
  onSignOut,
  inboxBadge,
}: {
  session: AdminSessionInfo;
  onSignOut: () => void;
  inboxBadge: number;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [days, setDays] = useState('14');
  const [health, setHealth] = useState<{ api: boolean; db: boolean; ai: boolean; aiRaw?: string } | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const response = await fetch('/api/status/health');
        const body = await response.json();
        let ai = false;
        let aiRaw = '';
        try {
          const aiHealth = await adminFetch<{ ai: { degraded: boolean; failuresLast10Min: number } }>('/api/admin/ai/health');
          ai = !aiHealth.ai.degraded;
          aiRaw = aiHealth.ai.degraded ? `${aiHealth.ai.failuresLast10Min} recent failures` : 'all providers healthy';
        } catch {
          aiRaw = 'unknown';
        }
        if (!cancelled) setHealth({ api: response.ok, db: body?.database === 'connected', ai, aiRaw });
      } catch {
        if (!cancelled) setHealth({ api: false, db: false, ai: false });
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const remaining = Math.max(0, new Date(session.expiresAt).getTime() - now);
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const active = NAV.find((entry) => entry.path === location.pathname) ?? NAV[0]!;

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--ad-accent)] text-[#06231b]">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[13.5px] font-bold leading-tight">Chatgram Admin</p>
            <p className="text-[10.5px] text-[var(--ad-faint)]">Operations dashboard</p>
          </div>
        </div>
        <nav className="admin-nav" aria-label="Admin sections">
          {NAV_GROUPS.map((group) => (
            <div key={group}>
              <p className="admin-nav-label">{group}</p>
              {NAV.filter((entry) => entry.group === group).map((entry) => (
                <NavLink key={entry.path} to={entry.path} end={entry.path === '/admin'} className="admin-nav-item">
                  <entry.icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{entry.label}</span>
                  {entry.badge === 'inbox' && inboxBadge > 0 ? (
                    <span className="admin-nav-badge">{inboxBadge > 99 ? '99+' : inboxBadge}</span>
                  ) : null}
                  {!entry.built ? <span className="ml-auto text-[9.5px] text-[var(--ad-faint)]">soon</span> : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-[var(--ad-border)] p-3">
          <div className="rounded-xl border border-[var(--ad-border)] p-2.5">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--ad-muted)]">
              <ShieldCheck className="h-3.5 w-3.5" /> Admin session
            </p>
            <p className="mt-1 text-[11px] text-[var(--ad-faint)]">
              expires in {hours}h {String(minutes).padStart(2, '0')}m
            </p>
            <div className="mt-2 flex gap-1.5">
              <button type="button" className="admin-btn admin-btn-sm flex-1" onClick={() => navigate('/admin/security')}>
                Security
              </button>
              <button type="button" className="admin-btn admin-btn-sm" onClick={onSignOut} aria-label="Sign out">
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
                    <div className="admin-mobile-nav">
            <Select
              label="Admin section"
              value={active.path}
              options={NAV.map((entry) => ({ value: entry.path, label: entry.label }))}
              onChange={(value) => navigate(value)}
            />
          </div>
          <button type="button" className="admin-btn min-w-0" onClick={() => setPaletteOpen(true)} aria-label="Search admin">
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="text-[12px] text-[var(--ad-muted)]">Search users, pages…</span>
            <span className="admin-kbd shrink-0">Ctrl K</span>
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select
              label="Date range"
              value={days}
              onChange={setDays}
              options={[
                { value: '14', label: 'Last 14 days' },
                { value: '30', label: 'Last 30 days' },
                { value: '90', label: 'Last 90 days' },
              ]}
            />
            <span className="admin-chip admin-chip-success" title={health?.aiRaw || 'checking'}>
              <Activity className="h-3 w-3" /> API {health ? (health.api ? 'up' : 'down') : '…'}
            </span>
            <span className="admin-chip admin-chip-success">
              <Database className="h-3 w-3" /> DB {health ? (health.db ? 'connected' : 'down') : '…'}
            </span>
            <span className={`admin-chip ${health?.ai === false ? 'admin-chip-warning' : 'admin-chip-success'}`} title={health?.aiRaw || ''}>
              <Bot className="h-3 w-3" /> AI {health?.ai === false ? 'degraded' : health ? 'healthy' : '…'}
            </span>
            {inboxBadge > 0 ? (
              <span className="admin-chip admin-chip-accent">
                <Bell className="h-3 w-3" /> {inboxBadge} inbox
              </span>
            ) : null}
          </div>
        </header>
        <div className="admin-content">
          <p className="admin-breadcrumb">
            Chatgram Admin / {active.group} / <span className="text-[var(--ad-muted)]">{active.label}</span>
          </p>
          <PageBoundary>
            <Suspense
              fallback={
                <div className="admin-card admin-card-pad space-y-3">
                  <Skeleton lines={4} />
                  <Skeleton lines={3} />
                </div>
              }
            >
              <PageForPath pathname={location.pathname} session={session} days={Number(days)} onSignOut={onSignOut} />
            </Suspense>
          </PageBoundary>
        </div>
      </main>

      {paletteOpen ? <CommandPalette onClose={() => setPaletteOpen(false)} inboxBadge={inboxBadge} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------- pages */

/** Route switch for the dashboard (one lazy page per section, browser back works). */
function PageForPath({
  pathname,
  session,
  days,
  onSignOut,
}: {
  pathname: string;
  session: AdminSessionInfo;
  days: number;
  onSignOut: () => void;
}) {
  const normalized = pathname.replace(/\/+$/, '') || '/admin';
  const userMatch = normalized.match(/\/admin\/users\/([^/]+)$/);
  if (userMatch) return <UserDetailPage session={session} id={decodeURIComponent(userMatch[1]!)} />;
  if (normalized === '/admin') return <OverviewPage session={session} days={days} />;
  if (normalized === '/admin/users') return <UsersPage />;
  if (normalized === '/admin/inbox') return <InboxPage session={session} />;
  if (normalized === '/admin/providers') return <ProvidersPage session={session} />;
  if (normalized === '/admin/security') return <SecurityPage session={session} onSignOut={onSignOut} />;
  if (normalized === '/admin/announcements') return <AnnouncementsPage session={session} />;
  if (normalized === '/admin/legacy') return <LegacyPanels />;
  const entry = NAV.find((item) => item.path === normalized) ?? NAV[0]!;
  return <PlaceholderPage entry={entry} />;
}

function PlaceholderPage({ entry }: { entry: NavEntry }) {
  const placeholder = PLACEHOLDERS[entry.path];
  return (
    <div>
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">{placeholder?.title || entry.label}</h1>
          <p className="admin-page-sub">{placeholder?.blurb || 'Planned for the next dashboard chunk.'}</p>
        </div>
        <span className="admin-chip admin-chip-warning">not built yet</span>
      </div>
      <div className="admin-card admin-card-pad">
        <p className="admin-section-label">Planned</p>
        <ul className="mt-2 space-y-2 text-[13px] text-[var(--ad-muted)]">
          {(placeholder?.bullets || []).map((bullet) => (
            <li key={bullet} className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ad-accent)]" />
              {bullet}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function SecurityPage({ session, onSignOut }: { session: AdminSessionInfo; onSignOut: () => void }) {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sessions, setSessions] = useState<{ id: string; current: boolean; createdAt: string; lastSeenAt: string; expiresAt: string; ip: string; userAgent: string }[]>([]);
  const [audit, setAudit] = useState<{ action: string; detail: string; ip: string; at: string }[]>([]);
  const [confirmSignOutAll, setConfirmSignOutAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const sessionPayload = await adminFetch<{ sessions: typeof sessions }>('/api/admin/auth/sessions');
      const auditPayload = await adminFetch<{ entries: typeof audit }>('/api/admin/auth/audit');
      setSessions(sessionPayload.sessions ?? []);
      setAudit(auditPayload.entries ?? []);
    } catch (loadError) {
      setError(loadError instanceof AdminError ? loadError.message : 'Could not load the security data.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await adminFetch('/api/admin/auth/change-password', {
        method: 'POST',
        csrf: session.csrfToken,
        body: { currentPassword, newPassword },
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.show('Admin password changed.');
    } catch (changeError) {
      setError(changeError instanceof AdminError ? changeError.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  }

  async function signOutAll() {
    setBusy(true);
    try {
      await adminFetch('/api/admin/auth/logout-all', { method: 'POST', csrf: session.csrfToken, body: {} });
      onSignOut();
    } catch (logoutError) {
      setError(logoutError instanceof AdminError ? logoutError.message : 'Could not sign out every session.');
    } finally {
      setBusy(false);
      setConfirmSignOutAll(false);
    }
  }

  return (
    <div>
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Admin security</h1>
          <p className="admin-page-sub">One password, short sessions, every action audited.</p>
        </div>
      </div>
      {error ? <p role="alert" className="admin-chip admin-chip-danger mb-3">{error}</p> : null}
      <div className="admin-grid md:grid-cols-2">
        <form onSubmit={changePassword} className="admin-card admin-card-pad space-y-2">
          <p className="admin-card-title">Change the admin password</p>
          <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
            Current password
            <input type="password" className="admin-input mt-1" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required />
          </label>
          <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
            New password (14+ characters)
            <input type="password" className="admin-input mt-1" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" required />
          </label>
          <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
            Repeat the new password
            <input type="password" className="admin-input mt-1" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required />
          </label>
          <button type="submit" className="admin-btn admin-btn-primary" disabled={busy}>
            Save new password
          </button>
        </form>
        <div className="admin-card admin-card-pad">
          <p className="admin-card-title">Sessions</p>
          <p className="mt-1 text-[11.5px] text-[var(--ad-muted)]">Sliding 30 minutes idle, 8 hours absolute.</p>
          <ul className="mt-2 space-y-1.5">
            {sessions.map((row) => (
              <li key={row.id} className="rounded-lg border border-[var(--ad-border)] p-2 text-[11.5px]">
                <p className="flex items-center gap-2 font-semibold">
                  {row.current ? <span className="admin-chip admin-chip-accent">this session</span> : null}
                  {row.ip || 'unknown IP'}
                </p>
                <p className="mt-0.5 truncate text-[var(--ad-faint)]">{row.userAgent || 'unknown device'}</p>
              </li>
            ))}
          </ul>
          <button type="button" className="admin-btn admin-btn-danger mt-2" onClick={() => setConfirmSignOutAll(true)} disabled={busy}>
            Sign out every admin session
          </button>
          <p className="admin-card-title mt-4">Recent admin actions</p>
          <ul className="mt-1.5 space-y-1 text-[11.5px] text-[var(--ad-muted)]">
            {audit.slice(0, 12).map((row, index) => (
              <li key={`${row.at}-${index}`} className="flex gap-2">
                <span className="font-mono text-[10.5px] text-[var(--ad-faint)]">{new Date(row.at).toLocaleTimeString()}</span>
                <span className="font-semibold">{row.action}</span>
                <span className="truncate">{row.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {confirmSignOutAll ? (
        <ConfirmDialog
          title="Sign out every admin session?"
          body="You will be signed out of this browser too and must enter the admin password again."
          confirmLabel="Sign out all"
          danger
          busy={busy}
          onCancel={() => setConfirmSignOutAll(false)}
          onConfirm={() => void signOutAll()}
        />
      ) : null}
      <Toast message={toast.message} />
    </div>
  );
}

/* ----------------------------------------------------------------- palette */

function CommandPalette({ onClose, inboxBadge }: { onClose: () => void; inboxBadge: number }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<{ id: string; displayName: string; email: string }[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setUsers([]);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const result = await adminFetch<{ users: { id: string; displayName: string; email: string }[] }>(
          `/api/admin/users?search=${encodeURIComponent(needle)}&limit=5`,
        );
        if (!cancelled) setUsers(result.users);
      } catch {
        if (!cancelled) setUsers([]);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pages = NAV.filter((entry) => !needle || entry.label.toLowerCase().includes(needle)).map((entry) => ({
      key: `page:${entry.path}`,
      label: entry.label,
      hint: entry.group,
      icon: entry.icon,
      run: () => {
        navigate(entry.path);
        onClose();
      },
    }));
    const userRows = users.map((user) => ({
      key: `user:${user.id}`,
      label: user.displayName,
      hint: user.email,
      icon: Users,
      run: () => {
        navigate(`/admin/users/${user.id}`);
        onClose();
      },
    }));
    return [...userRows, ...pages].slice(0, 12);
  }, [navigate, onClose, query, users]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(results.length - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      results[active]?.run();
    }
  }

  return (
    <div className="admin-palette-backdrop" onClick={onClose}>
      <div className="admin-palette" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-[var(--ad-border)] px-3 py-2.5">
          <Command className="h-4 w-4 text-[var(--ad-faint)]" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-[var(--ad-faint)]"
            placeholder="Find a user, group, ticket, setting or page…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Command palette search"
          />
          {inboxBadge > 0 ? <span className="admin-chip admin-chip-accent">{inboxBadge} inbox</span> : null}
          <button type="button" className="admin-btn admin-btn-sm" onClick={onClose} aria-label="Close palette">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-1.5">
          {results.map((result, index) => (
            <button
              key={result.key}
              type="button"
              className="admin-palette-item"
              data-active={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={result.run}
            >
              <result.icon className="h-4 w-4 shrink-0 opacity-80" />
              <span className="min-w-0 flex-1 truncate">{result.label}</span>
              <span className="truncate text-[10.5px] text-[var(--ad-faint)]">{result.hint}</span>
            </button>
          ))}
          {results.length === 0 ? <p className="px-3 py-3 text-[12.5px] text-[var(--ad-muted)]">No matches.</p> : null}
        </div>
        <div className="flex items-center gap-2 border-t border-[var(--ad-border)] px-3 py-1.5 text-[10.5px] text-[var(--ad-faint)]">
          <span className="admin-kbd">↑↓</span> move <span className="admin-kbd">Enter</span> open <span className="admin-kbd">Esc</span> close
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- app root */

export default function AdminApp() {
  const [session, setSession] = useState<AdminSessionInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [unconfigured, setUnconfigured] = useState(false);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [inboxBadge, setInboxBadge] = useState(0);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    adminFetch<AdminSessionInfo>('/api/admin/auth/session')
      .then((info) => {
        if (!cancelled) setSession(info);
      })
      .catch((sessionError) => {
        if (cancelled) return;
        if (sessionError instanceof AdminError && sessionError.status === 503) setUnconfigured(true);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session) return undefined;
    let cancelled = false;
    async function poll() {
      try {
        const counts = await adminFetch<{ new: number }>('/api/admin/ai/inbox/unread');
        if (!cancelled) setInboxBadge(counts.new || 0);
      } catch {
        /* badge is best effort */
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session]);

  const signIn = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setError('');
      try {
        await adminFetch('/api/admin/auth/login', { method: 'POST', body: { password } });
        const info = await adminFetch<AdminSessionInfo>('/api/admin/auth/session');
        setSession(info);
        setPassword('');
      } catch (loginError) {
        if (loginError instanceof AdminError && loginError.status === 503) setUnconfigured(true);
        else setError(loginError instanceof AdminError ? loginError.message : 'Could not sign in.');
      } finally {
        setBusy(false);
      }
    },
    [password],
  );

  const signOut = useCallback(async () => {
    if (session) {
      try {
        await adminFetch('/api/admin/auth/logout', { method: 'POST', csrf: session.csrfToken, body: {} });
      } catch {
        /* signing out locally is enough */
      }
    }
    setSession(null);
  }, [session]);

  if (checking) {
    return (
      <div className="admin-root grid min-h-screen place-items-center">
        <div className="w-full max-w-sm space-y-3 px-4">
          <Skeleton lines={4} />
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="admin-root grid min-h-screen place-items-center px-4">
        <div className="admin-card w-full max-w-sm p-6">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[var(--ad-accent-soft)] text-[var(--ad-accent)]">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <h1 className="mt-3 text-center text-[18px] font-bold">Chatgram Admin</h1>
          <p className="mt-1 text-center text-[12.5px] text-[var(--ad-muted)]">
            This dashboard has its own password. Chatgram accounts cannot open it.
          </p>
          {unconfigured ? (
            <div className="mt-4 rounded-xl border border-[var(--ad-warning)]/40 bg-[var(--ad-warning)]/10 p-3 text-[12px] text-[var(--ad-warning)]">
              <p className="font-semibold">Admin access is not configured yet.</p>
              <p className="mt-1">On the server run: <code className="font-mono">cd ~/chatgram && node scripts/set-admin-password.js</code></p>
            </div>
          ) : (
            <form onSubmit={signIn} className="mt-4">
              <label htmlFor="admin-password" className="admin-section-label">
                Admin password
              </label>
              <input
                id="admin-password"
                type="password"
                className="admin-input mt-1"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                autoFocus
              />
              {error ? <p role="alert" className="mt-2 text-[12px] font-medium text-[var(--ad-danger)]">{error}</p> : null}
              <button type="submit" className="admin-btn admin-btn-primary mt-3 w-full" disabled={busy || !password}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}
          <a href="/web/" className="admin-btn mt-2 w-full no-underline">
            Back to Chatgram
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-root">
      <Shell session={session} onSignOut={() => void signOut()} inboxBadge={inboxBadge} />
      {confirming ? (
        <ConfirmDialog
          title="Sign out?"
          body="You will need the admin password to open the dashboard again."
          confirmLabel="Sign out"
          onCancel={() => setConfirming(false)}
          onConfirm={() => void signOut()}
        />
      ) : null}
    </div>
  );
}

