import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Zap, RefreshCw, LifeBuoy, ArrowLeft, BookOpen, Inbox, Settings2, Send, RotateCcw, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '@chatgram/core';

/**
 * Support control dashboard (/web/admin).
 *
 * Tabs: Overview (AI + channels), Tickets (inbox + reply), Knowledge base.
 * Only the built-in support account can use it — the API returns 403 otherwise.
 */

type Preset = { id: string; label: string; provider: string; baseUrl: string; model: string };
type TicketRow = { ticketId: string; status: string; contact: string; summary: string; createdAt: string; replyCount: number; lastReply: string; hasChat: boolean };
type TicketDetail = { ticketId: string; status: string; contact: string; summary: string; createdAt: string; hasChat: boolean; transcript: { role: string; text: string }[]; replies: { text: string; at: string }[] };
type KbEntry = { id: string; title: string; keywords: string[]; answer: string };

const TABS = [
  { id: 'overview', label: 'Overview', icon: Settings2 },
  { id: 'tickets', label: 'Tickets', icon: Inbox },
  { id: 'kb', label: 'Knowledge base', icon: BookOpen },
] as const;

export default function Admin() {
  const user = useSession((s) => s.user);
  const [tab, setTab] = useState<'overview' | 'tickets' | 'kb'>('overview');

  const settingsQuery = useQuery({ queryKey: ['admin-settings'], queryFn: () => api.request<any>('/api/support/admin/settings'), retry: false });

  if (settingsQuery.isError) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <LifeBuoy className="mx-auto mb-3 h-10 w-10 text-ink-400" />
        <h1 className="text-lg font-bold">Support account required</h1>
        <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">Sign in as the Chatgram Support account to open this dashboard.</p>
        <a href="/web/" className="btn-primary mt-5 inline-flex h-10 items-center gap-2 px-4"><ArrowLeft className="h-4 w-4" /> Back to Chatgram</a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Support control</h1>
          <p className="text-[13px] text-ink-600 dark:text-ink-300">Everything your support account can manage.</p>
        </div>
        <a href="/web/" className="btn-ghost inline-flex h-9 items-center gap-1.5 px-3 text-[13px]"><ArrowLeft className="h-4 w-4" /> Chatgram</a>
      </header>

      <nav className="flex gap-1 rounded-xl bg-ink-100 p-1 dark:bg-white/5">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${
                tab === t.id ? 'bg-white text-brand-700 shadow-sm dark:bg-ink-700 dark:text-brand-300' : 'text-ink-600 hover:text-ink-800 dark:text-ink-300'
              }`}
            >
              <Icon className="h-4 w-4" /> <span className="hidden sm:inline">{t.label}</span>
            </button>
          );
        })}
      </nav>

      {tab === 'overview' ? <Overview settingsQuery={settingsQuery} /> : null}
      {tab === 'tickets' ? <Tickets /> : null}
      {tab === 'kb' ? <KbEditor /> : null}

      <p className="pb-6 text-center text-[11.5px] text-ink-500">Signed in as {user?.displayName ?? 'support'}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- overview */

function Overview({ settingsQuery }: { settingsQuery: any }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, any>>({});
  const [notice, setNotice] = useState('');
  const [testResult, setTestResult] = useState('');
  const [testOk, setTestOk] = useState(true);

  useEffect(() => {
    if (settingsQuery.data?.settings) setForm(settingsQuery.data.settings);
  }, [settingsQuery.data]);

  const save = useMutation({
    mutationFn: (patch: any) => api.request<any>('/api/support/admin/settings', { method: 'PUT', body: patch }),
    onSuccess: (d) => { setNotice(d?.message ?? 'Saved.'); qc.invalidateQueries({ queryKey: ['admin-settings'] }); },
    onError: (e: any) => setNotice(e?.message ?? 'Could not save.'),
  });
  function explainAiError(code?: string, fallback?: string): string {
    switch (code) {
      case 'invalid_key':
        return 'The API key was rejected (invalid, revoked or expired). Paste a new Groq key in the field below and save.';
      case 'stored_key_invalid':
        return 'The saved key was rejected; the server environment key is being used. Paste a fresh key below.';
      case 'quota':
        return 'Quota or rate limit exceeded for this provider. Wait, or upgrade the plan / raise the budget.';
      case 'model_not_found':
        return 'The model id does not exist for this account. Pick a model your provider lists.';
      case 'empty_answer':
        return 'The model returned an empty answer (reasoning models can do this). Try a different model or raise max tokens.';
      case 'timeout':
        return 'The provider timed out. Check the base URL and network.';
      case 'bad_request':
        return 'The provider rejected the request. Check the model id and provider settings.';
      default:
        return fallback ? `AI test failed: ${fallback}` : 'AI test failed. Check the provider settings.';
    }
  }

  const testAi = useMutation({
    mutationFn: () => api.request<any>('/api/support/admin/test-ai', { method: 'POST' }),
    onSuccess: (d) => {
      setTestOk(Boolean(d?.ok));
      setTestResult(d?.ok ? `AI replied: ${String(d.answer).slice(0, 100)}` : explainAiError(d?.code, d?.error));
    },
    onError: (e: any) => {
      setTestOk(false);
      setTestResult(e?.message ?? 'Test failed');
    },
  });

  const lastAiError = settingsQuery.data?.status?.aiError as { code?: string; message?: string; at?: string } | undefined;

  const status = settingsQuery.data?.status;
  const presets: Preset[] = settingsQuery.data?.presets ?? [];

  return (
    <div className="space-y-4">
      {notice ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">{notice}</p> : null}

      {lastAiError && ['invalid_key', 'stored_key_invalid', 'quota', 'model_not_found', 'empty_answer'].includes(String(lastAiError.code)) ? (
        <p role="alert" data-testid="admin-ai-error" className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-medium text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
          AI provider problem: {explainAiError(lastAiError.code, lastAiError.message)}
          {lastAiError.at ? ` (last attempt ${new Date(lastAiError.at).toLocaleString()})` : ''}
        </p>
      ) : null}

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-500">Live status</h2>
        <div className="grid gap-2 text-[13px] sm:grid-cols-2">
          <p>AI: <strong>{status?.ai?.enabled ? 'enabled' : 'disabled'}</strong> {status?.ai?.model ? `· ${status.ai.model}` : ''}</p>
          <p>Telegram: <strong>{status?.channels?.telegram ? 'connected' : 'off'}</strong></p>
          <p>Email: <strong>{status?.channels?.email ? 'connected' : 'off'}</strong></p>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-500">AI model</h2>
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => {
            const active = form.aiBaseUrl === p.baseUrl && form.aiModel === p.model;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setForm((f) => ({ ...f, aiProvider: p.provider, aiBaseUrl: p.baseUrl, aiModel: p.model, aiEnabled: true }))}
                className={`rounded-xl border px-3 py-2 text-[13px] font-semibold ${active ? 'border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-200' : 'border-ink-200 text-ink-700 hover:border-brand-500 dark:border-white/15 dark:text-ink-200'}`}
              >
                {p.label}<span className="ml-1.5 font-normal text-ink-500">{p.model}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">Model id</span><input className="field h-10" value={form.aiModel ?? ''} onChange={(e) => setForm((f) => ({ ...f, aiModel: e.target.value }))} /></label>
          <label className="block"><span className="label">Base URL</span><input className="field h-10" value={form.aiBaseUrl ?? ''} onChange={(e) => setForm((f) => ({ ...f, aiBaseUrl: e.target.value }))} /></label>
          <label className="block sm:col-span-2"><span className="label">API key {form.aiApiKeySet ? '(saved — leave blank to keep)' : ''}</span><input className="field h-10" type="password" value={form.aiApiKey ?? ''} onChange={(e) => setForm((f) => ({ ...f, aiApiKey: e.target.value }))} placeholder="paste to replace" /></label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-[13px]">
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-brand-600" checked={Boolean(form.aiEnabled)} onChange={(e) => setForm((f) => ({ ...f, aiEnabled: e.target.checked }))} /> AI enabled</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-brand-600" checked={Boolean(form.agentEnabled)} onChange={(e) => setForm((f) => ({ ...f, agentEnabled: e.target.checked }))} /> Agent replies in-app</label>
          <button type="button" onClick={() => testAi.mutate()} className="btn-ghost inline-flex h-9 items-center gap-1.5 px-3">{testAi.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Test AI</button>
        </div>
        {testResult ? (
          <p
            role="status"
            data-testid="admin-ai-test-result"
            className={`mt-2 rounded-lg px-3 py-2 text-[12.5px] font-medium ${testOk ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' : 'border border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300'}`}
          >
            {testResult}
          </p>
        ) : null}
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-500">Notifications</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">Telegram chat id</span><input className="field h-10" value={form.telegramChatId ?? ''} onChange={(e) => setForm((f) => ({ ...f, telegramChatId: e.target.value }))} /></label>
          <label className="block"><span className="label">Notify email</span><input className="field h-10" value={form.notifyEmail ?? ''} onChange={(e) => setForm((f) => ({ ...f, notifyEmail: e.target.value }))} /></label>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-[13px]">
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-brand-600" checked={Boolean(form.telegramEnabled)} onChange={(e) => setForm((f) => ({ ...f, telegramEnabled: e.target.checked }))} /> Telegram alerts</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-brand-600" checked={Boolean(form.emailEnabled)} onChange={(e) => setForm((f) => ({ ...f, emailEnabled: e.target.checked }))} /> Email alerts <span className="text-ink-500">(turn off to rely on this dashboard)</span></label>
        </div>
      </section>

      <AiProvidersPanel />

      <div className="sticky bottom-3 flex justify-end">
        <button type="button" onClick={() => save.mutate(form)} disabled={save.isPending} className="btn-primary inline-flex h-11 items-center gap-2 px-5 shadow-lg">
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save settings
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------- AI providers (new layer) */

/**
 * Provider-agnostic AI settings: pick any provider, model and key, set limits
 * and a fallback chain, then test the connection. The key is encrypted on the
 * server and only its last 4 characters ever come back.
 */
function AiProvidersPanel() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [apiKey, setApiKey] = useState('');
  const [notice, setNotice] = useState('');
  const [test, setTest] = useState<{ ok: boolean; latencyMs?: number; message?: string; code?: string } | null>(null);

  const query = useQuery({ queryKey: ['admin-ai'], queryFn: () => api.request<any>('/api/support/admin/ai'), retry: false });

  useEffect(() => {
    if (query.data) setDraft(query.data);
  }, [query.data]);

  const save = useMutation({
    mutationFn: () =>
      api.request<any>('/api/support/admin/ai', {
        method: 'PUT',
        body: {
          enabled: draft.enabled,
          provider: draft.provider,
          model: draft.model,
          baseUrl: draft.baseUrl,
          temperature: draft.temperature,
          maxOutputTokens: draft.maxOutputTokens,
          timeoutMs: draft.timeoutMs,
          dailyTokenBudget: draft.dailyTokenBudget,
          fallbacks: (draft.fallbacks ?? []).filter((f: any) => f.provider && f.model),
          ...(apiKey ? { apiKey } : {}),
        },
      }),
    onSuccess: (data) => {
      setNotice(data?.message ?? 'Saved.');
      setApiKey('');
      qc.invalidateQueries({ queryKey: ['admin-ai'] });
    },
    onError: (error: any) => setNotice(error?.message ?? 'Could not save.'),
  });

  const runTest = useMutation({
    mutationFn: () =>
      api.request<any>('/api/support/admin/ai/test', {
        method: 'POST',
        body: { provider: draft.provider, model: draft.model, baseUrl: draft.baseUrl, ...(apiKey ? { apiKey } : {}) },
      }),
    onSuccess: (data) => setTest(data),
    onError: (error: any) => setTest({ ok: false, message: error?.message ?? 'Test failed' }),
  });

  const providers: { id: string; label: string; needsKey: boolean; defaultBaseUrl: string; note: string | null }[] =
    draft.providers ?? [];

  return (
    <section className="card p-4" data-testid="admin-ai">
      <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-ink-500">AI providers (provider-agnostic)</h2>
      <p className="mb-3 text-[12px] text-ink-500 dark:text-ink-400">
        One interface for every provider. The key is encrypted at rest and only the last 4 characters are shown.
        {draft.source ? ` Currently configured from ${draft.source}.` : ''}
        {draft.keyLast4 ? ` Key ending ${draft.keyLast4}.` : ''}
      </p>

      {notice ? <p role="status" className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">{notice}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Provider</span>
          <select
            className="field h-10"
            value={draft.provider ?? ''}
            onChange={(e) => {
              const provider = providers.find((p) => p.id === e.target.value);
              setDraft((d) => ({ ...d, provider: e.target.value, baseUrl: provider?.defaultBaseUrl || '' }));
            }}
            aria-label="AI provider"
          >
            <option value="">(not set)</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Model</span>
          <input className="field h-10" value={draft.model ?? ''} onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))} placeholder="Model name (no default is hardcoded)" aria-label="AI model" />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">Base URL</span>
          <input className="field h-10" value={draft.baseUrl ?? ''} onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))} placeholder="https://…" aria-label="AI base URL" />
        </label>
        <label className="block">
          <span className="label">API key {draft.hasKey ? '(saved — leave blank to keep)' : ''}</span>
          <input className="field h-10" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={draft.hasKey ? '••••••••' : 'Paste the key'} autoComplete="off" aria-label="AI API key" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="label">Max output tokens</span>
            <input className="field h-10" type="number" value={draft.maxOutputTokens ?? 400} onChange={(e) => setDraft((d) => ({ ...d, maxOutputTokens: Number(e.target.value) }))} />
          </label>
          <label className="block">
            <span className="label">Daily token budget</span>
            <input className="field h-10" type="number" value={draft.dailyTokenBudget ?? 200000} onChange={(e) => setDraft((d) => ({ ...d, dailyTokenBudget: Number(e.target.value) }))} />
          </label>
          <label className="block">
            <span className="label">Temperature</span>
            <input className="field h-10" type="number" step="0.1" min="0" max="2" value={draft.temperature ?? 0.2} onChange={(e) => setDraft((d) => ({ ...d, temperature: Number(e.target.value) }))} />
          </label>
          <label className="block">
            <span className="label">Timeout (ms)</span>
            <input className="field h-10" type="number" value={draft.timeoutMs ?? 20000} onChange={(e) => setDraft((d) => ({ ...d, timeoutMs: Number(e.target.value) }))} />
          </label>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-brand-600" checked={Boolean(draft.enabled)} onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))} /> Enabled
        </label>
        <button type="button" className="btn-ghost inline-flex h-9 items-center gap-1.5 px-3" onClick={() => runTest.mutate()} disabled={runTest.isPending}>
          {runTest.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Test connection
        </button>
        <button type="button" className="btn-primary inline-flex h-9 items-center gap-1.5 px-3" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save AI provider
        </button>
      </div>

      {test ? (
        <p className={`mt-2 rounded-lg px-3 py-2 text-[12.5px] ${test.ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'}`} data-testid="admin-ai-test">
          {test.ok ? `Connection OK — ${test.latencyMs} ms` : `Failed${test.code ? ` (${test.code})` : ''}: ${test.message ?? 'no answer'}`}
        </p>
      ) : null}

      <div className="mt-3">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-bold uppercase tracking-wider text-ink-500">Fallback chain</p>
          <button
            type="button"
            className="btn-ghost !py-1 text-[12px]"
            onClick={() => setDraft((d) => ({ ...d, fallbacks: [...(d.fallbacks ?? []), { provider: 'openai', model: '' }] }))}
          >
            <Plus className="h-3.5 w-3.5" /> Add fallback
          </button>
        </div>
        {(draft.fallbacks ?? []).length === 0 ? (
          <p className="text-[12px] text-ink-500 dark:text-ink-400">No fallbacks. The chain ends with a knowledge-base-only answer.</p>
        ) : null}
        {(draft.fallbacks ?? []).map((fallback: any, index: number) => (
          <div key={index} className="mt-1 flex gap-2">
            <select
              className="field h-9 flex-1"
              value={fallback.provider}
              onChange={(e) => setDraft((d) => {
                const next = [...(d.fallbacks ?? [])];
                next[index] = { ...next[index], provider: e.target.value };
                return { ...d, fallbacks: next };
              })}
              aria-label={`Fallback ${index + 1} provider`}
            >
              {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
            </select>
            <input
              className="field h-9 flex-1"
              placeholder="model"
              value={fallback.model}
              onChange={(e) => setDraft((d) => {
                const next = [...(d.fallbacks ?? [])];
                next[index] = { ...next[index], model: e.target.value };
                return { ...d, fallbacks: next };
              })}
              aria-label={`Fallback ${index + 1} model`}
            />
            <button
              type="button"
              className="btn-ghost !px-2 text-rose-500"
              aria-label={`Remove fallback ${index + 1}`}
              onClick={() => setDraft((d) => ({ ...d, fallbacks: (d.fallbacks ?? []).filter((_: unknown, i: number) => i !== index) }))}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- tickets */

function Tickets() {
  const [filter, setFilter] = useState<'open' | 'answered' | 'closed' | 'all'>('open');
  const [selected, setSelected] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [notice, setNotice] = useState('');

  const listQuery = useQuery({
    queryKey: ['admin-tickets', filter],
    queryFn: () => api.request<{ tickets: TicketRow[] }>(`/api/support/admin/tickets${filter === 'all' ? '' : `?status=${filter}`}`),
    refetchInterval: 20_000,
  });

  const detailQuery = useQuery({
    queryKey: ['admin-ticket', selected],
    queryFn: () => api.request<{ ticket: TicketDetail }>(`/api/support/admin/tickets/${selected}`),
    enabled: Boolean(selected),
  });

  async function sendReply() {
    if (!selected || !reply.trim()) return;
    try {
      await api.request(`/api/support/admin/tickets/${selected}/reply`, { method: 'POST', body: { text: reply.trim() } });
      setReply('');
      setNotice('Reply sent to the user.');
      detailQuery.refetch();
      listQuery.refetch();
    } catch (e: any) {
      setNotice(e?.message ?? 'Could not send the reply.');
    }
  }

  const tickets = listQuery.data?.tickets ?? [];
  const detail = detailQuery.data?.ticket;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(['open', 'answered', 'closed', 'all'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setFilter(s); setSelected(null); }}
            className={`rounded-full border px-3 py-1.5 text-[12.5px] font-semibold capitalize ${filter === s ? 'border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-200' : 'border-ink-200 text-ink-600 dark:border-white/15 dark:text-ink-300'}`}
          >
            {s}
          </button>
        ))}
        <button type="button" onClick={() => listQuery.refetch()} className="btn-ghost ml-auto inline-flex h-8 items-center gap-1.5 px-2.5 text-[12px]"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
      </div>

      {notice ? <p className="rounded-xl bg-ink-100 px-3 py-2 text-[12.5px] dark:bg-white/10">{notice}</p> : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="card max-h-[60vh] overflow-y-auto p-2">
          {tickets.length === 0 ? <p className="p-3 text-[13px] text-ink-500">No tickets in this view.</p> : null}
          {tickets.map((t) => (
            <button
              key={t.ticketId}
              type="button"
              onClick={() => { setSelected(t.ticketId); setNotice(''); }}
              className={`mb-1 flex w-full flex-col gap-0.5 rounded-xl px-3 py-2 text-left transition ${selected === t.ticketId ? 'bg-brand-50 dark:bg-brand-500/15' : 'hover:bg-ink-100 dark:hover:bg-white/5'}`}
            >
              <span className="flex items-center gap-2 text-[13px]">
                <span className="font-mono font-bold">{t.ticketId}</span>
                <span className={`rounded-full px-1.5 text-[10.5px] font-bold uppercase ${t.status === 'open' ? 'bg-amber-500 text-white' : t.status === 'answered' ? 'bg-emerald-600 text-white' : 'bg-ink-400 text-white'}`}>{t.status}</span>
                {t.replyCount ? <span className="text-[11px] text-ink-500">{t.replyCount} repl{t.replyCount === 1 ? 'y' : 'ies'}</span> : null}
              </span>
              <span className="truncate text-[12px] text-ink-600 dark:text-ink-300">{t.summary || '(no summary)'}</span>
              <span className="truncate text-[11px] text-ink-500">{t.contact}</span>
            </button>
          ))}
        </section>

        <section className="card max-h-[60vh] overflow-y-auto p-3">
          {!selected ? <p className="p-2 text-[13px] text-ink-500">Pick a ticket to read it and reply.</p> : null}
          {selected && detailQuery.isLoading ? <p className="p-2 text-[13px] text-ink-500">Loading…</p> : null}
          {selected && detail ? (
            <div className="space-y-3">
              <div>
                <p className="flex flex-wrap items-center gap-2 text-[13px] font-bold"><span className="font-mono">{detail.ticketId}</span><span className="rounded-full bg-ink-200 px-1.5 text-[10.5px] uppercase dark:bg-white/15">{detail.status}</span></p>
                <p className="text-[12px] text-ink-500">{detail.contact} · {new Date(detail.createdAt).toLocaleString()}</p>
              </div>
              <p className="rounded-lg bg-ink-100 px-2.5 py-2 text-[12.5px] dark:bg-white/10">{detail.summary}</p>
              {detail.transcript?.length ? (
                <div className="space-y-1">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-ink-500">Conversation</p>
                  {detail.transcript.map((m, i) => (
                    <p key={i} className={`rounded-lg px-2 py-1 text-[12px] ${m.role === 'guest' ? 'bg-brand-50 dark:bg-brand-500/15' : 'bg-ink-100 dark:bg-white/10'}`}>
                      <span className="font-semibold">{m.role === 'guest' ? 'User' : 'Assistant'}: </span>{m.text}
                    </p>
                  ))}
                </div>
              ) : null}
              {detail.replies?.length ? (
                <div className="space-y-1">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-ink-500">Replies sent</p>
                  {detail.replies.map((r, i) => <p key={i} className="rounded-lg bg-emerald-50 px-2 py-1 text-[12px] dark:bg-emerald-500/10">{r.text}</p>)}
                </div>
              ) : null}
              {detail.hasChat ? (
                <div className="space-y-2 border-t border-ink-200 pt-2 dark:border-white/10">
                  <textarea className="field min-h-[80px]" placeholder="Write a reply — the user gets it in the app…" value={reply} onChange={(e) => setReply(e.target.value)} />
                  <button type="button" onClick={sendReply} disabled={!reply.trim()} className="btn-primary inline-flex h-10 items-center gap-2 px-4 text-[13px]"><Send className="h-4 w-4" /> Send reply</button>
                </div>
              ) : (
                <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[12px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">This ticket has no in-app conversation — reply by email to {detail.contact}.</p>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ knowledge base */

function KbEditor() {
  const qc = useQueryClient();
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [notice, setNotice] = useState('');

  const kbQuery = useQuery({ queryKey: ['admin-kb'], queryFn: () => api.request<{ entries: KbEntry[] }>('/api/support/admin/kb'), retry: false });

  useEffect(() => {
    if (kbQuery.data?.entries) setEntries(kbQuery.data.entries);
  }, [kbQuery.data]);

  const save = useMutation({
    mutationFn: (next: KbEntry[]) => api.request<any>('/api/support/admin/kb', { method: 'PUT', body: { entries: next } }),
    onSuccess: (d) => { setNotice(d?.message ?? 'Saved.'); qc.invalidateQueries({ queryKey: ['admin-kb'] }); },
    onError: (e: any) => setNotice(e?.message ?? 'Could not save.'),
  });

  const reset = useMutation({
    mutationFn: () => api.request<any>('/api/support/admin/kb/reset', { method: 'POST' }),
    onSuccess: (d) => { setEntries(d?.entries ?? []); setNotice(d?.message ?? 'Restored.'); qc.invalidateQueries({ queryKey: ['admin-kb'] }); },
  });

  function update(index: number, patch: Partial<KbEntry>) {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  const total = useMemo(() => entries.length, [entries]);

  return (
    <div className="space-y-3">
      {notice ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">{notice}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] text-ink-600 dark:text-ink-300">{total} entries — the assistant answers only from these.</p>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => { setEntries((p) => [...p, { id: `entry-${Date.now()}`, title: '', keywords: [], answer: '' }]); setOpenIndex(entries.length); }} className="btn-ghost inline-flex h-9 items-center gap-1.5 px-3 text-[12.5px]"><Plus className="h-3.5 w-3.5" /> Add entry</button>
          <button type="button" onClick={() => reset.mutate()} className="btn-ghost inline-flex h-9 items-center gap-1.5 px-3 text-[12.5px]" title="Restore the bundled knowledge base"><RotateCcw className="h-3.5 w-3.5" /> Reset</button>
        </div>
      </div>

      <div className="space-y-1.5">
        {entries.map((entry, index) => (
          <div key={entry.id} className="card p-0">
            <button type="button" onClick={() => setOpenIndex(openIndex === index ? null : index)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px]">
              <span className="font-semibold">{entry.title || '(untitled)'}</span>
              <span className="truncate text-[11.5px] text-ink-500">{entry.keywords?.slice(0, 4).join(', ')}</span>
            </button>
            {openIndex === index ? (
              <div className="space-y-2 border-t border-ink-200 p-3 dark:border-white/10">
                <label className="block"><span className="label">Title</span><input className="field h-10" value={entry.title} onChange={(e) => update(index, { title: e.target.value })} /></label>
                <label className="block"><span className="label">Keywords (comma separated)</span><input className="field h-10" value={entry.keywords?.join(', ') ?? ''} onChange={(e) => update(index, { keywords: e.target.value.split(',').map((k) => k.trim()).filter(Boolean) })} /></label>
                <label className="block"><span className="label">Answer</span><textarea className="field min-h-[110px]" value={entry.answer} onChange={(e) => update(index, { answer: e.target.value })} /></label>
                <button type="button" onClick={() => setEntries((p) => p.filter((_, i) => i !== index))} className="btn-ghost inline-flex h-9 items-center gap-1.5 px-3 text-[12.5px] text-rose-600"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="sticky bottom-3 flex justify-end">
        <button type="button" onClick={() => save.mutate(entries)} disabled={save.isPending} className="btn-primary inline-flex h-11 items-center gap-2 px-5 shadow-lg">
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save knowledge base
        </button>
      </div>
    </div>
  );
}
