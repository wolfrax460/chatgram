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
type InboxRow = { id: string; type: string; question: string; count: number; status: string; providerKey: string | null; errorReason: string | null; answer: string; canAnswerUser?: boolean; lastSeenAt: string };
type ProviderRow = {
  key: string;
  label: string;
  provider: string;
  model: string;
  baseUrl: string;
  enabled: boolean;
  timeoutMs: number;
  dailyTokenBudget: number;
  hasKey: boolean;
  keyLast4: string;
  health: { requests: number; successes: number; failures: number; tokens: number; averageLatencyMs: number | null; lastErrorCode: string | null; errorRate: number; lastSuccessAt: string | null } | null;
};
type FeatureAssignment = { label: string; primary: string | null; fallbacks: string[] };
type ProvidersPayload = {
  providers: ProviderRow[];
  features: Record<string, FeatureAssignment>;
  availableProviders: { id: string; label: string; needsKey: boolean; defaultBaseUrl: string }[];
  canUndo: boolean;
};

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

const FEATURE_FALLBACK: Record<string, FeatureAssignment> = {
  chatgramAI: { label: 'Chatgram AI assistant', primary: null, fallbacks: [] },
  support: { label: 'Chatgram Support replies', primary: null, fallbacks: [] },
  help: { label: 'Help widget assistant', primary: null, fallbacks: [] },
};

function featuresPreview(data: ProvidersPayload | null): Record<string, FeatureAssignment> {
  return data?.features ?? FEATURE_FALLBACK;
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
  const [providersData, setProvidersData] = useState<ProvidersPayload | null>(null);
  const [providerForm, setProviderForm] = useState<Record<string, any>>({ provider: 'groq', label: '', model: '', baseUrl: '', apiKey: '', timeoutMs: 20000, dailyTokenBudget: 200000, enabled: true });
  const [providerNotice, setProviderNotice] = useState('');
  const [featureDraft, setFeatureDraft] = useState<Record<string, { primary: string; fallback: string }>>({});
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [inboxTotal, setInboxTotal] = useState(0);
  const [inboxUnread, setInboxUnread] = useState({ new: 0, supportTimeout: 0, lowConfidence: 0, unknown: 0, negativeFeedback: 0 });
  const [inboxDraft, setInboxDraft] = useState<Record<string, string>>({});
  const [inboxStatus, setInboxStatus] = useState('new');
  const [aiHealth, setAiHealth] = useState<{ degraded: boolean; failuresLast10Min: number } | null>(null);
  const [policyDraft, setPolicyDraft] = useState<{ blockedTopics: string; hourlyLimit: number; dailyLimit: number; maxInputChars: number; alertsEnabled: boolean } | null>(null);
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

  async function refreshAiHealth() {
    const result = await adminFetch('/api/admin/ai/health');
    if (result.status === 200) setAiHealth(result.body.ai);
    const policyResult = await adminFetch('/api/admin/ai/policy');
    if (policyResult.status === 200 && policyResult.body?.policy) {
      const policy = policyResult.body.policy;
      setPolicyDraft({
        blockedTopics: (policy.blockedTopics || []).join(', '),
        hourlyLimit: policy.hourlyLimit,
        dailyLimit: policy.dailyLimit,
        maxInputChars: policy.maxInputChars,
        alertsEnabled: policy.alertsEnabled === true,
      });
    }
  }

  async function savePolicy(event: React.FormEvent) {
    event.preventDefault();
    if (!session || !policyDraft) return;
    setBusy(true);
    setError('');
    try {
      const result = await adminFetch('/api/admin/ai/policy', {
        method: 'PUT',
        csrf: session.csrfToken,
        body: {
          blockedTopics: policyDraft.blockedTopics,
          hourlyLimit: policyDraft.hourlyLimit,
          dailyLimit: policyDraft.dailyLimit,
          maxInputChars: policyDraft.maxInputChars,
          alertsEnabled: policyDraft.alertsEnabled,
        },
      });
      if (result.status === 200) setProviderNotice('AI safety and limits saved — effective immediately.');
      else setError(result.body?.message ?? 'Could not save the AI policy.');
    } finally {
      setBusy(false);
    }
  }

  async function refreshInbox() {
    const result = await adminFetch('/api/admin/ai/inbox?status=' + encodeURIComponent(inboxStatus));
    if (result.status === 200) {
      setInbox(result.body.items ?? []);
      setInboxTotal(result.body.total ?? 0);
    }
  }

  async function refreshInboxUnread() {
    const result = await adminFetch('/api/admin/ai/inbox/unread');
    if (result.status === 200) {
      setInboxUnread({
        new: Number(result.body?.new) || 0,
        supportTimeout: Number(result.body?.supportTimeout) || 0,
        lowConfidence: Number(result.body?.lowConfidence) || 0,
        unknown: Number(result.body?.unknown) || 0,
        negativeFeedback: Number(result.body?.negativeFeedback) || 0,
      });
    }
  }

  async function answerInbox(id: string) {
    if (!session) return;
    const answer = String(inboxDraft[id] || '').trim();
    if (!answer) return;
    setBusy(true);
    try {
      const result = await adminFetch('/api/admin/ai/inbox/' + encodeURIComponent(id) + '/answer', {
        method: 'POST',
        csrf: session.csrfToken,
        body: { answer },
      });
      if (result.status === 200) {
        setProviderNotice('Answer saved to the knowledge base.');
        await refreshInbox();
      } else {
        setError(result.body?.message ?? 'Could not save the answer.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function ignoreInbox(id: string) {
    if (!session) return;
    setBusy(true);
    try {
      await adminFetch('/api/admin/ai/inbox/' + encodeURIComponent(id) + '/ignore', { method: 'POST', csrf: session.csrfToken, body: {} });
      await refreshInbox();
    } finally {
      setBusy(false);
    }
  }

  async function refreshProviders(csrf: string) {
    const result = await adminFetch('/api/admin/providers', { csrf });
    if (result.status === 200) {
      setProvidersData(result.body as ProvidersPayload);
      const draft: Record<string, { primary: string; fallback: string }> = {};
      for (const [feature, assignment] of Object.entries((result.body as ProvidersPayload).features || {}) as [string, FeatureAssignment][]) {
        draft[feature] = { primary: assignment.primary ?? '', fallback: assignment.fallbacks?.[0] ?? '' };
      }
      setFeatureDraft(draft);
    }
  }

  useEffect(() => {
    if (!session?.csrfToken) return;
    void refreshLists(session.csrfToken);
    void refreshProviders(session.csrfToken);
    void refreshInbox();
    void refreshInboxUnread();
    void refreshAiHealth();
    // 9e live push fallback: poll the inbox + badge counters every 15 s.
    const timer = window.setInterval(() => {
      void refreshInbox();
      void refreshInboxUnread();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [session?.csrfToken, inboxStatus]);

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

  async function saveProvider(event: React.FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      const key = String(providerForm.key || providerForm.label || providerForm.provider || '').trim();
      const result = await adminFetch('/api/admin/providers/' + encodeURIComponent(key), {
        method: 'PUT',
        csrf: session.csrfToken,
        body: { ...providerForm, key },
      });
      if (result.status === 200) {
        setProviderNotice('Provider saved.');
        setProviderForm({ ...providerForm, apiKey: '', key: '' });
        await refreshProviders(session.csrfToken);
      } else {
        setError(result.body?.message ?? 'Could not save the provider.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function testProvider(key: string) {
    if (!session) return;
    setBusy(true);
    setProviderNotice('');
    try {
      const result = await adminFetch('/api/admin/providers/' + encodeURIComponent(key) + '/test', {
        method: 'POST',
        csrf: session.csrfToken,
        body: {},
      });
      if (result.status === 200) {
        setProviderNotice(result.body?.ok ? `${key}: connection OK in ${result.body.latencyMs} ms` : `${key}: ${result.body?.code || 'failed'} — ${result.body?.message || 'no answer'}`);
      } else {
        setProviderNotice(`${key}: ${result.body?.message || 'test failed'}`);
      }
      await refreshProviders(session.csrfToken);
    } finally {
      setBusy(false);
    }
  }

  async function applyFeatures(event: React.FormEvent) {
    event.preventDefault();
    if (!session || !providersData) return;
    setBusy(true);
    setError('');
    try {
      const features: Record<string, { primary: string; fallbacks: string[] }> = {};
      for (const [feature, draft] of Object.entries(featureDraft)) {
        features[feature] = { primary: draft.primary || '', fallbacks: draft.fallback ? [draft.fallback] : [] };
      }
      const result = await adminFetch('/api/admin/providers/features', {
        method: 'PUT',
        csrf: session.csrfToken,
        body: { features },
      });
      if (result.status === 200) {
        setProviderNotice('Feature routing saved — takes effect immediately.');
        setProvidersData(result.body as ProvidersPayload);
      } else {
        setError(result.body?.message ?? 'Could not save feature routing.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function undoFeatures() {
    if (!session) return;
    setBusy(true);
    try {
      const result = await adminFetch('/api/admin/providers/undo', { method: 'POST', csrf: session.csrfToken, body: {} });
      if (result.status === 200) {
        setProvidersData(result.body as ProvidersPayload);
        setProviderNotice('Restored the previous provider routing.');
      } else {
        setError(result.body?.message ?? 'Nothing to undo.');
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

      {aiHealth?.degraded ? (
        <p role="alert" data-testid="ai-degraded-banner" className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-medium text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
          AI degraded: {aiHealth.failuresLast10Min} “all providers failed” events in the last 10 minutes. Check Model providers and the API keys.
        </p>
      ) : null}

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

      <section className="card p-4" data-testid="ai-policy">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-500">AI safety &amp; limits</h2>
        <p className="mb-3 text-[12.5px] text-ink-500 dark:text-ink-300">
          Effective immediately for Chatgram AI. Blocked topics are comma separated and case-insensitive; matches are refused politely without calling the provider.
        </p>
        {policyDraft ? (
          <form onSubmit={savePolicy} className="grid gap-2 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="label">Blocked topics (comma separated)</span>
              <input className="field h-9" value={policyDraft.blockedTopics} onChange={(event) => setPolicyDraft({ ...policyDraft, blockedTopics: event.target.value })} placeholder="e.g. weapons, hacking" />
            </label>
            <label className="block">
              <span className="label">Messages per hour / user</span>
              <input type="number" min={1} className="field h-9" value={policyDraft.hourlyLimit} onChange={(event) => setPolicyDraft({ ...policyDraft, hourlyLimit: Number(event.target.value) })} />
            </label>
            <label className="block">
              <span className="label">Messages per day / user</span>
              <input type="number" min={1} className="field h-9" value={policyDraft.dailyLimit} onChange={(event) => setPolicyDraft({ ...policyDraft, dailyLimit: Number(event.target.value) })} />
            </label>
            <label className="block">
              <span className="label">Max input characters</span>
              <input type="number" min={100} className="field h-9" value={policyDraft.maxInputChars} onChange={(event) => setPolicyDraft({ ...policyDraft, maxInputChars: Number(event.target.value) })} />
            </label>
            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 text-[12.5px]">
                <input type="checkbox" checked={policyDraft.alertsEnabled} onChange={(event) => setPolicyDraft({ ...policyDraft, alertsEnabled: event.target.checked })} />
                Alert notifications (digest, off by default)
              </label>
              <button type="submit" className="btn-primary h-9 px-3 text-[12.5px]" disabled={busy}>Save AI policy</button>
            </div>
          </form>
        ) : (
          <p className="text-[12.5px] text-ink-500">Loading AI policy…</p>
        )}
      </section>

      <section className="card p-4" data-testid="model-providers">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-500">Model providers</h2>
        <p className="mb-3 text-[12.5px] text-ink-500 dark:text-ink-300">
          Switch providers without a redeploy. Keys are encrypted, write-only and shown only as their last 4 characters.
        </p>
        {providersData && providersData.providers.length === 0 ? (
          <p role="alert" data-testid="no-provider-banner" className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] font-medium text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            No AI provider is configured yet. Add a Groq provider below, paste its key in the write-only key field and press Save + Test — AI features stay unavailable until a provider works.
          </p>
        ) : null}
        {providerNotice ? <p className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">{providerNotice}</p> : null}
        {providersData?.providers?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="text-[11px] uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="py-1 pr-2">Provider</th>
                  <th className="py-1 pr-2">Model</th>
                  <th className="py-1 pr-2">Key</th>
                  <th className="py-1 pr-2">Health</th>
                  <th className="py-1">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200 dark:divide-white/10">
                {providersData.providers.map((row) => (
                  <tr key={row.key}>
                    <td className="py-1.5 pr-2">
                      <strong>{row.label}</strong>
                      <span className="block text-[11px] text-ink-500">{row.provider}{row.enabled ? '' : ' · disabled'}</span>
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-[11.5px]">{row.model}</td>
                    <td className="py-1.5 pr-2">{row.hasKey ? `••••${row.keyLast4}` : 'not set'}</td>
                    <td className="py-1.5 pr-2">
                      {row.health
                        ? `${row.health.successes}/${row.health.requests} ok · ${row.health.averageLatencyMs ?? '–'} ms · ${row.health.tokens} tok${row.health.lastErrorCode ? ` · last error ${row.health.lastErrorCode}` : ''}`
                        : 'no requests yet'}
                    </td>
                    <td className="py-1.5">
                      <button type="button" className="btn-ghost !px-2 !py-1 text-[11.5px]" disabled={busy} onClick={() => void testProvider(row.key)}>
                        Test
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[12.5px] text-ink-500">No providers configured yet. Add one below.</p>
        )}

        <form onSubmit={saveProvider} className="mt-3 grid gap-2 rounded-xl border border-ink-200 p-3 dark:border-white/10 sm:grid-cols-2">
          <label className="block">
            <span className="label">Provider</span>
            <select
              className="field h-9"
              value={providerForm.provider}
              onChange={(event) => {
                const found = providersData?.availableProviders.find((row) => row.id === event.target.value);
                setProviderForm((prev) => ({ ...prev, provider: event.target.value, baseUrl: found?.defaultBaseUrl || '' }));
              }}
            >
              {(providersData?.availableProviders ?? [{ id: 'groq', label: 'Groq', defaultBaseUrl: '' }]).map((row) => (
                <option key={row.id} value={row.id}>{row.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Label / key</span>
            <input className="field h-9" value={providerForm.label ?? ''} onChange={(event) => setProviderForm((prev) => ({ ...prev, label: event.target.value, key: event.target.value }))} placeholder="e.g. groq-primary" />
          </label>
          <label className="block">
            <span className="label">Model</span>
            <input className="field h-9" value={providerForm.model ?? ''} onChange={(event) => setProviderForm((prev) => ({ ...prev, model: event.target.value }))} placeholder="model id" />
          </label>
          <label className="block">
            <span className="label">Base URL</span>
            <input className="field h-9" value={providerForm.baseUrl ?? ''} onChange={(event) => setProviderForm((prev) => ({ ...prev, baseUrl: event.target.value }))} placeholder="https://…" />
          </label>
          <label className="block sm:col-span-2">
            <span className="label">API key (write-only; leave blank to keep the saved key)</span>
            <input type="password" className="field h-9" value={providerForm.apiKey ?? ''} onChange={(event) => setProviderForm((prev) => ({ ...prev, apiKey: event.target.value }))} autoComplete="off" />
          </label>
          <label className="block">
            <span className="label">Timeout (ms)</span>
            <input type="number" className="field h-9" value={providerForm.timeoutMs ?? 20000} onChange={(event) => setProviderForm((prev) => ({ ...prev, timeoutMs: Number(event.target.value) }))} />
          </label>
          <label className="block">
            <span className="label">Daily token budget</span>
            <input type="number" className="field h-9" value={providerForm.dailyTokenBudget ?? 200000} onChange={(event) => setProviderForm((prev) => ({ ...prev, dailyTokenBudget: Number(event.target.value) }))} />
          </label>
          <div className="flex items-center gap-3 sm:col-span-2">
            <label className="flex items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={Boolean(providerForm.enabled)} onChange={(event) => setProviderForm((prev) => ({ ...prev, enabled: event.target.checked }))} /> Enabled
            </label>
            <button type="submit" className="btn-primary h-9 px-3 text-[12.5px]" disabled={busy}>Save provider</button>
          </div>
        </form>

        <form onSubmit={applyFeatures} className="mt-3 rounded-xl border border-ink-200 p-3 dark:border-white/10">
          <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-500">Feature routing</p>
          {(Object.entries(featuresPreview(providersData)) as [string, FeatureAssignment][]).map(([feature, assignment]) => (
            <div key={feature} className="mb-2 grid gap-2 sm:grid-cols-3">
              <span className="text-[12.5px] font-medium">{assignment.label}</span>
              <select
                className="field h-9"
                value={featureDraft[feature]?.primary ?? ''}
                onChange={(event) => setFeatureDraft((prev) => ({ ...prev, [feature]: { primary: event.target.value, fallback: prev[feature]?.fallback ?? '' } }))}
                aria-label={`${assignment.label} primary provider`}
              >
                <option value="">(not set)</option>
                {(providersData?.providers ?? []).map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
              </select>
              <select
                className="field h-9"
                value={featureDraft[feature]?.fallback ?? ''}
                onChange={(event) => setFeatureDraft((prev) => ({ ...prev, [feature]: { primary: prev[feature]?.primary ?? '', fallback: event.target.value } }))}
                aria-label={`${assignment.label} fallback provider`}
              >
                <option value="">(no fallback)</option>
                {(providersData?.providers ?? []).map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
              </select>
            </div>
          ))}
          <div className="mt-1 flex flex-wrap gap-2">
            <button type="submit" className="btn-primary h-9 px-3 text-[12.5px]" disabled={busy}>Apply routing</button>
            <button type="button" className="btn-ghost h-9 px-3 text-[12.5px]" disabled={busy || !providersData?.canUndo} onClick={() => void undoFeatures()}>Undo last change</button>
          </div>
        </form>
      </section>

      <section className="card p-4" data-testid="ai-inbox">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">
            Chatgram AI inbox ({inboxTotal})
            {inboxUnread.new > 0 ? (
              <span
                className="ml-2 inline-flex items-center gap-1 rounded-full bg-brand-600 px-2 py-0.5 text-[10.5px] font-bold normal-case tracking-normal text-white"
                data-testid="inbox-unread-badge"
                title={`${inboxUnread.unknown} unknown, ${inboxUnread.lowConfidence} low confidence, ${inboxUnread.supportTimeout} support timeouts, ${inboxUnread.negativeFeedback} thumbs down`}
              >
                {inboxUnread.new} new
              </span>
            ) : null}
          </h2>
          <select className="field h-8 w-[130px] text-[12px]" value={inboxStatus} onChange={(event) => setInboxStatus(event.target.value)} aria-label="Inbox filter">
            <option value="new">New</option>
            <option value="answered">Answered</option>
            <option value="ignored">Ignored</option>
            <option value="all">All</option>
          </select>
        </div>
        <p className="mb-2 text-[12px] text-ink-500 dark:text-ink-300">
          Questions the AI could not answer. Saving an answer adds it to the knowledge base so the next user is answered automatically.
        </p>
        {inbox.length === 0 ? <p className="text-[12.5px] text-ink-500">Nothing here.</p> : null}
        <ul className="space-y-2">
          {inbox.map((item) => (
            <li key={item.id} className="rounded-xl border border-ink-200 p-2 dark:border-white/10">
              <p className="text-[13px] font-medium">{item.question}</p>
              <p className="text-[11px] text-ink-500">
                {item.count}× · {item.providerKey || 'no provider'} · {new Date(item.lastSeenAt).toLocaleString()} · {item.status}
                {item.canAnswerUser ? ' · the answer is also sent to the user in-app' : ' · no signed-in asker to notify'}
              </p>
              {item.status === 'answered' ? (
                <p className="mt-1 rounded bg-emerald-50 px-2 py-1 text-[12px] text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">{item.answer}</p>
              ) : (
                <div className="mt-1 flex flex-col gap-1 sm:flex-row">
                  <input
                    className="field h-8 flex-1 text-[12.5px]"
                    placeholder="Approved answer (saved to the knowledge base)…"
                    value={inboxDraft[item.id] ?? ''}
                    onChange={(event) => setInboxDraft((prev) => ({ ...prev, [item.id]: event.target.value }))}
                    aria-label="Inbox answer"
                  />
                  <button type="button" className="btn-primary h-8 px-3 text-[12px]" disabled={busy} onClick={() => void answerInbox(item.id)}>Answer</button>
                  <button type="button" className="btn-ghost h-8 px-3 text-[12px]" disabled={busy} onClick={() => void ignoreInbox(item.id)}>Ignore</button>
                </div>
              )}
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
