import { useEffect, useState } from 'react';
import { ArrowLeft, KeyRound, Loader2, LogOut, ShieldCheck } from 'lucide-react';

/**
 * /web/admin access gate (item 9a).
 *
 * The admin panel has its own password — no Chatgram user account involved.
 * Calls use same-origin `/api/admin/*` (Vite proxy in dev, Vercel rewrite in
 * production) so the HttpOnly, SameSite=Strict admin cookie is actually sent.
 */
type SessionInfo = {
  authenticated: boolean;
  csrfToken: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  activeSessions: number;
  totpEnabled: boolean;
};
type SessionRow = { id: string; current: boolean; createdAt: string; lastSeenAt: string; expiresAt: string; ip: string; userAgent: string };
type AuditRow = { action: string; detail: string; ip: string; at: string };

async function adminFetch(path: string, options: { method?: string; body?: unknown; csrf?: string } = {}) {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.csrf ? { 'X-Admin-CSRF': options.csrf } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, body: json };
}

export default function AdminGate() {
  const [loading, setLoading] = useState(true);
  const [unconfigured, setUnconfigured] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  async function refreshSession() {
    const result = await adminFetch('/api/admin/auth/session');
    if (result.status === 503) {
      setUnconfigured(true);
      setSession(null);
    } else if (result.status === 200 && result.body?.authenticated) {
      setSession(result.body as SessionInfo);
      setUnconfigured(false);
    } else {
      setSession(null);
    }
  }

  async function refreshLists(csrf: string) {
    const [sessionList, auditList] = await Promise.all([
      adminFetch('/api/admin/auth/sessions', { csrf }),
      adminFetch('/api/admin/auth/audit', { csrf }),
    ]);
    if (sessionList.status === 200) setSessions(sessionList.body.sessions ?? []);
    if (auditList.status === 200) setAudit(auditList.body.entries ?? []);
  }

  useEffect(() => {
    refreshSession().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (session?.csrfToken) void refreshLists(session.csrfToken);
  }, [session?.csrfToken]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await adminFetch('/api/admin/auth/login', { method: 'POST', body: { password } });
      if (result.status === 503) {
        setUnconfigured(true);
        return;
      }
      if (result.status !== 200) {
        setError(result.body?.message ?? 'Could not sign in.');
        return;
      }
      setPassword('');
      await refreshSession();
      setNotice('Signed in.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut(all = false) {
    if (!session) return;
    setBusy(true);
    try {
      const result = await adminFetch(all ? '/api/admin/auth/logout-all' : '/api/admin/auth/logout', {
        method: 'POST',
        csrf: session.csrfToken,
      });
      if (result.status === 200) {
        setSession(null);
        setSessions([]);
        setAudit([]);
        setNotice(all ? 'All admin sessions signed out.' : 'Signed out.');
      } else {
        setError(result.body?.message ?? 'Could not sign out.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      const result = await adminFetch('/api/admin/auth/change-password', {
        method: 'POST',
        csrf: session.csrfToken,
        body: { currentPassword, newPassword },
      });
      if (result.status === 200) {
        setCurrentPassword('');
        setNewPassword('');
        setNotice('Admin password changed.');
      } else {
        setError(result.body?.message ?? 'Could not change the password.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-full place-items-center bg-ink-50 dark:bg-ink-900">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="auth-page grid min-h-full place-items-center bg-ink-50 p-4 dark:bg-ink-900">
        <div className="w-full max-w-sm rounded-2xl border border-ink-200 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-ink-800">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-600/10 text-brand-600 dark:text-brand-300">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="mt-3 text-center text-lg font-bold">Admin access</h1>
          <p className="mt-1 text-center text-[13px] text-ink-500 dark:text-ink-300">
            This panel has its own password. Chatgram accounts cannot open it.
          </p>

          {unconfigured ? (
            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              <p className="font-semibold">Admin access is not configured yet.</p>
              <p className="mt-1">On the server, run:</p>
              <code className="mt-1 block rounded bg-black/10 px-2 py-1 font-mono text-[12px] dark:bg-black/30">
                cd ~/chatgram &amp;&amp; node scripts/set-admin-password.js
              </code>
            </div>
          ) : (
            <form onSubmit={signIn} className="mt-4">
              <label htmlFor="admin-password" className="label">Admin password</label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-ink-500" />
                <input
                  id="admin-password"
                  type="password"
                  autoComplete="current-password"
                  className="field h-11 pl-9"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
              {error ? <p role="alert" className="mt-2 text-[12.5px] font-medium text-rose-600 dark:text-rose-400">{error}</p> : null}
              <button type="submit" className="btn-primary mt-3 h-11 w-full" disabled={busy || !password}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Sign in
              </button>
            </form>
          )}

          <a href="/web/" className="btn-ghost mt-2 flex h-10 w-full items-center justify-center gap-2">
            <ArrowLeft className="h-4 w-4" /> Back to Chatgram
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Admin access</h1>
          <p className="text-[12.5px] text-ink-500 dark:text-ink-300">
            Session expires {new Date(session.expiresAt).toLocaleString()} · {session.activeSessions} active session(s)
            {session.totpEnabled ? ' · TOTP enabled' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost h-9 px-3 text-[13px]" onClick={() => void signOut(false)} disabled={busy}>
            <LogOut className="h-4 w-4" /> Sign out
          </button>
          <button type="button" className="btn-ghost h-9 px-3 text-[13px] text-rose-600" onClick={() => void signOut(true)} disabled={busy}>
            Sign out all
          </button>
        </div>
      </header>

      {notice ? <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">{notice}</p> : null}
      {error ? <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p> : null}

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-500">Change admin password</h2>
        <form onSubmit={changePassword} className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Current password</span>
            <input type="password" className="field h-10" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
          </label>
          <label className="block">
            <span className="label">New password (14+ characters)</span>
            <input type="password" className="field h-10" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={14} required />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary h-10 px-4" disabled={busy}>Change password</button>
          </div>
        </form>
      </section>

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-500">Sessions</h2>
        <ul className="divide-y divide-ink-200 dark:divide-white/10">
          {sessions.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
              <span>
                {row.ip || 'unknown IP'} · {row.userAgent ? row.userAgent.slice(0, 40) : 'unknown device'}
                {row.current ? <span className="ml-2 rounded bg-brand-600/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700 dark:text-brand-300">this session</span> : null}
              </span>
              <span className="text-ink-500 dark:text-ink-300">last seen {new Date(row.lastSeenAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-500">Recent admin audit</h2>
        <ul className="max-h-72 divide-y divide-ink-200 overflow-y-auto dark:divide-white/10">
          {audit.map((row, index) => (
            <li key={`${row.at}-${index}`} className="py-1.5 text-[12.5px]">
              <span className="font-mono text-[11.5px]">{new Date(row.at).toLocaleString()}</span> · <strong>{row.action}</strong>
              {row.detail ? ` — ${row.detail}` : ''} {row.ip ? ` (${row.ip})` : ''}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
