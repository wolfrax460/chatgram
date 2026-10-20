import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Zap, RefreshCw, LifeBuoy, ArrowLeft } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '@chatgram/core';

/**
 * Support control dashboard (/web/admin).
 *
 * Only reachable for the built-in support account: the API rejects everyone
 * else with 403, so the page simply shows an error for other users.
 * Everything here maps to fields the server applies to the running process
 * immediately — no redeploy needed to change the model or turn the agent off.
 */

type Settings = {
  configured?: boolean;
  aiEnabled?: boolean | null;
  aiProvider?: string | null;
  aiBaseUrl?: string | null;
  aiModel?: string | null;
  aiApiKeySet?: boolean;
  aiMaxTokens?: number | null;
  agentEnabled?: boolean | null;
  telegramEnabled?: boolean | null;
  telegramChatId?: string | null;
  emailEnabled?: boolean | null;
  notifyEmail?: string | null;
};

type Preset = { id: string; label: string; provider: string; baseUrl: string; model: string };
type Stats = { counts: { open: number; answered: number; closed: number; total: number }; recent: { ticketId: string; status: string; contact: string; summary: string; createdAt: string }[] };

export default function Admin() {
  const user = useSession((s) => s.user);
  const qc = useQueryClient();
  const [form, setForm] = useState<Partial<Settings>>({});
  const [notice, setNotice] = useState('');
  const [testResult, setTestResult] = useState('');

  const settingsQuery = useQuery({ queryKey: ['admin-settings'], queryFn: () => api.request<any>('/api/support/admin/settings'), retry: false });
  const statsQuery = useQuery({ queryKey: ['admin-stats'], queryFn: () => api.request<Stats>('/api/support/admin/stats'), retry: false });

  useEffect(() => {
    if (settingsQuery.data?.settings) setForm(settingsQuery.data.settings);
  }, [settingsQuery.data]);

  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => api.request<any>('/api/support/admin/settings', { method: 'PUT', body: patch }),
    onSuccess: (data) => {
      setNotice(data?.message ?? 'Saved.');
      qc.invalidateQueries({ queryKey: ['admin-settings'] });
    },
    onError: (e: any) => setNotice(e?.message ?? 'Could not save.'),
  });

  const testAi = useMutation({
    mutationFn: () => api.request<any>('/api/support/admin/test-ai', { method: 'POST' }),
    onSuccess: (data) => setTestResult(data?.ok ? `AI replied: ${String(data.answer).slice(0, 120)}` : `AI failed: ${data?.error ?? 'no answer'}`),
    onError: (e: any) => setTestResult(e?.message ?? 'Test failed'),
  });

  const status = settingsQuery.data?.status;
  const presets: Preset[] = settingsQuery.data?.presets ?? [];
  const forbidden = settingsQuery.isError;

  if (forbidden) {
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
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Support control</h1>
          <p className="text-[13px] text-ink-600 dark:text-ink-300">Changes apply immediately — no redeploy.</p>
        </div>
        <a href="/web/" className="btn-ghost inline-flex h-9 items-center gap-1.5 px-3 text-[13px]"><ArrowLeft className="h-4 w-4" /> Chatgram</a>
      </header>

      {notice ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">{notice}</p> : null}

      {/* live status */}
      <section className="card p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-500">Live status</h2>
        <div className="grid gap-2 text-[13px] sm:grid-cols-2">
          <p>AI: <strong>{status?.ai?.enabled ? 'enabled' : 'disabled'}</strong> {status?.ai?.model ? `· ${status.ai.model}` : ''}</p>
          <p>Telegram: <strong>{status?.channels?.telegram ? 'connected' : 'off'}</strong></p>
          <p>Email: <strong>{status?.channels?.email ? 'connected' : 'off'}</strong></p>
          <p>Tickets: <strong>{statsQuery.data?.counts?.open ?? '—'} open</strong> · {statsQuery.data?.counts?.total ?? '—'} total</p>
        </div>
        <button type="button" onClick={() => { settingsQuery.refetch(); statsQuery.refetch(); }} className="btn-ghost mt-3 inline-flex h-9 items-center gap-1.5 px-3 text-[13px]">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </section>

      {/* model picker */}
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
                {p.label}
                <span className="ml-1.5 font-normal text-ink-500">{p.model}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Model id</span>
            <input className="field h-10" value={form.aiModel ?? ''} onChange={(e) => setForm((f) => ({ ...f, aiModel: e.target.value }))} placeholder="openai/gpt-oss-20b" />
          </label>
          <label className="block">
            <span className="label">Base URL</span>
            <input className="field h-10" value={form.aiBaseUrl ?? ''} onChange={(e) => setForm((f) => ({ ...f, aiBaseUrl: e.target.value }))} placeholder="https://api.groq.com/openai/v1" />
          </label>
          <label className="block sm:col-span-2">
            <span className="label">API key {form.aiApiKeySet ? '(a key is saved — leave blank to keep it)' : ''}</span>
            <input className="field h-10" type="password" value={(form as any).aiApiKey ?? ''} onChange={(e) => setForm((f) => ({ ...f, aiApiKey: e.target.value }))} placeholder="paste a new key to replace" />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4 text-[13px]">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-brand-600" checked={Boolean(form.aiEnabled)} onChange={(e) => setForm((f) => ({ ...f, aiEnabled: e.target.checked }))} />
            AI enabled
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-brand-600" checked={Boolean(form.agentEnabled)} onChange={(e) => setForm((f) => ({ ...f, agentEnabled: e.target.checked }))} />
            Agent replies in-app
          </label>
          <button type="button" onClick={() => testAi.mutate()} className="btn-ghost inline-flex h-9 items-center gap-1.5 px-3">
            {testAi.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Test AI
          </button>
        </div>
        {testResult ? <p className="mt-2 rounded-lg bg-ink-100 px-3 py-2 text-[12.5px] dark:bg-white/10">{testResult}</p> : null}
      </section>

      {/* channels */}
      <section className="card p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-500">Notifications</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Telegram chat id</span>
            <input className="field h-10" value={form.telegramChatId ?? ''} onChange={(e) => setForm((f) => ({ ...f, telegramChatId: e.target.value }))} placeholder="8304746608" />
          </label>
          <label className="block">
            <span className="label">Notify email</span>
            <input className="field h-10" value={form.notifyEmail ?? ''} onChange={(e) => setForm((f) => ({ ...f, notifyEmail: e.target.value }))} placeholder="you@gmail.com" />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-[13px]">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-brand-600" checked={Boolean(form.telegramEnabled)} onChange={(e) => setForm((f) => ({ ...f, telegramEnabled: e.target.checked }))} />
            Telegram alerts
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-brand-600" checked={Boolean(form.emailEnabled)} onChange={(e) => setForm((f) => ({ ...f, emailEnabled: e.target.checked }))} />
            Email alerts
          </label>
        </div>
      </section>

      <div className="sticky bottom-3 flex justify-end">
        <button
          type="button"
          onClick={() => save.mutate(form)}
          disabled={save.isPending}
          className="btn-primary inline-flex h-11 items-center gap-2 px-5 shadow-lg"
        >
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save settings
        </button>
      </div>

      {/* recent tickets */}
      <section className="card p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-500">Recent tickets</h2>
        <div className="space-y-1.5 text-[13px]">
          {(statsQuery.data?.recent ?? []).map((t) => (
            <div key={t.ticketId} className="flex flex-wrap items-center gap-2 border-b border-ink-100 pb-1.5 last:border-0 dark:border-white/5">
              <span className="font-mono font-bold">{t.ticketId}</span>
              <span className="rounded-full border border-ink-300 px-2 text-[11px] uppercase dark:border-white/20">{t.status}</span>
              <span className="text-ink-500">{t.contact}</span>
              <span className="truncate text-ink-600 dark:text-ink-300">{t.summary}</span>
            </div>
          ))}
          {!statsQuery.data?.recent?.length ? <p className="text-ink-500">No tickets yet.</p> : null}
        </div>
      </section>

      <p className="pb-6 text-center text-[11.5px] text-ink-500">Signed in as {user?.displayName ?? 'support'}</p>
    </div>
  );
}
