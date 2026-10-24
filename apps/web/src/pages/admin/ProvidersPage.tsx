import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, Check, PlugZap, Plus, RotateCcw, Save, Trash2, Undo2 } from 'lucide-react';
import {
  adminFetch, relativeTime, type AdminSessionInfo, type AiPolicy, type ProviderRow, type ProvidersPayload,
} from './api';
import { Chip, ConfirmDialog, Drawer, PageHead, Select, Skeleton, Toast, useToast } from './ui';

type ProviderForm = {
  key: string;
  label: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  dailyTokenBudget: number;
  enabled: boolean;
};

const EMPTY_FORM: ProviderForm = {
  key: '',
  label: '',
  provider: 'groq',
  model: '',
  baseUrl: '',
  apiKey: '',
  timeoutMs: 20000,
  dailyTokenBudget: 200000,
  enabled: true,
};

/**
 * Model providers + feature routing (9c) and AI safety limits — moved out of the
 * old stacked admin page into cards/drawers, with the shared dark Select instead
 * of native popups.
 */
export default function ProvidersPage({ session }: { session: AdminSessionInfo }) {
  const toast = useToast();
  const [data, setData] = useState<ProvidersPayload | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<ProviderForm>(EMPTY_FORM);
  const [editing, setEditing] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [routing, setRouting] = useState<Record<string, { primary: string; fallback: string }>>({});
  const [policy, setPolicy] = useState<AiPolicy | null>(null);
  const [policyDraft, setPolicyDraft] = useState({ blockedTopics: '', hourlyLimit: 30, dailyLimit: 200, maxInputChars: 4000, alertsEnabled: false });

  const load = useCallback(async () => {
    setError('');
    try {
      const payload = await adminFetch<ProvidersPayload>('/api/admin/providers');
      setData(payload);
      const next: Record<string, { primary: string; fallback: string }> = {};
      for (const [feature, assignment] of Object.entries(payload.features || {})) {
        next[feature] = { primary: assignment.primary ?? '', fallback: assignment.fallbacks?.[0] ?? '' };
      }
      setRouting(next);
      const policyResult = await adminFetch<{ policy: AiPolicy }>('/api/admin/ai/policy');
      setPolicy(policyResult.policy);
      setPolicyDraft({
        blockedTopics: (policyResult.policy.blockedTopics || []).join(', '),
        hourlyLimit: policyResult.policy.hourlyLimit,
        dailyLimit: policyResult.policy.dailyLimit,
        maxInputChars: policyResult.policy.maxInputChars,
        alertsEnabled: policyResult.policy.alertsEnabled === true,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the providers.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const providerOptions = useMemo(
    () => [
      { value: '', label: '(not set)' },
      ...(data?.providers ?? []).map((row) => ({ value: row.key, label: row.label, hint: row.model })),
    ],
    [data?.providers],
  );

  const availableOptions = useMemo(
    () => (data?.availableProviders ?? []).map((row) => ({ value: row.id, label: row.label, hint: row.needsKey ? 'needs key' : 'key optional' })),
    [data?.availableProviders],
  );

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDrawerOpen(true);
  }

  function openEdit(row: ProviderRow) {
    setEditing(row.key);
    setForm({
      key: row.key,
      label: row.label,
      provider: row.provider,
      model: row.model,
      baseUrl: row.baseUrl,
      apiKey: '',
      timeoutMs: row.timeoutMs,
      dailyTokenBudget: row.dailyTokenBudget,
      enabled: row.enabled,
    });
    setDrawerOpen(true);
  }

  async function saveProvider(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const key = editing || form.key.trim() || form.label.trim() || form.provider;
      await adminFetch(`/api/admin/providers/${encodeURIComponent(key)}`, {
        method: 'PUT',
        csrf: session.csrfToken,
        body: { ...form, key },
      });
      toast.show(editing ? 'Provider updated.' : 'Provider added.');
      setDrawerOpen(false);
      setForm(EMPTY_FORM);
      setEditing(null);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the provider.');
    } finally {
      setBusy(false);
    }
  }

  async function testProvider(key: string) {
    setBusy(true);
    setError('');
    try {
      const result = await adminFetch<{ ok: boolean; latencyMs?: number; message?: string; sample?: string }>(
        `/api/admin/providers/${encodeURIComponent(key)}/test`,
        { method: 'POST', csrf: session.csrfToken, body: {} },
      );
      toast.show(result.ok ? `Provider answered in ${result.latencyMs ?? '?'} ms.` : `Test failed: ${result.message || 'unknown error'}`);
      await load();
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : 'The test failed.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteProvider(key: string) {
    setBusy(true);
    try {
      await adminFetch(`/api/admin/providers/${encodeURIComponent(key)}`, { method: 'DELETE', csrf: session.csrfToken });
      toast.show('Provider removed.');
      setDeleteTarget(null);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not remove the provider.');
    } finally {
      setBusy(false);
    }
  }

  async function applyRouting() {
    setBusy(true);
    setError('');
    try {
      const features: Record<string, { primary: string; fallbacks: string[] }> = {};
      for (const [feature, draft] of Object.entries(routing)) {
        features[feature] = { primary: draft.primary || '', fallbacks: draft.fallback ? [draft.fallback] : [] };
      }
      await adminFetch('/api/admin/providers/features', { method: 'PUT', csrf: session.csrfToken, body: { features } });
      toast.show('Feature routing saved — takes effect immediately.');
      await load();
    } catch (routingError) {
      setError(routingError instanceof Error ? routingError.message : 'Could not save the routing.');
    } finally {
      setBusy(false);
    }
  }

  async function undoRouting() {
    setBusy(true);
    try {
      await adminFetch('/api/admin/providers/undo', { method: 'POST', csrf: session.csrfToken, body: {} });
      toast.show('Last routing change undone.');
      await load();
    } catch (undoError) {
      setError(undoError instanceof Error ? undoError.message : 'Could not undo.');
    } finally {
      setBusy(false);
    }
  }

  async function savePolicy(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await adminFetch('/api/admin/ai/policy', {
        method: 'PUT',
        csrf: session.csrfToken,
        body: {
          blockedTopics: policyDraft.blockedTopics,
          hourlyLimit: Number(policyDraft.hourlyLimit),
          dailyLimit: Number(policyDraft.dailyLimit),
          maxInputChars: Number(policyDraft.maxInputChars),
          alertsEnabled: policyDraft.alertsEnabled,
        },
      });
      toast.show('AI policy saved.');
      await load();
    } catch (policyError) {
      setError(policyError instanceof Error ? policyError.message : 'Could not save the AI policy.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHead
        title="Model providers"
        subtitle="Encrypted, write-only API keys. Chatgram AI, Support and the help widget can each use a different provider."
        actions={
          <button type="button" className="admin-btn admin-btn-primary" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5" /> Add provider
          </button>
        }
      />
      {error ? <p role="alert" className="admin-chip admin-chip-danger mb-3">{error}</p> : null}
      {!data ? (
        <div className="admin-card admin-card-pad">
          <Skeleton lines={5} />
        </div>
      ) : (
        <>
          {data.providers.length === 0 ? (
            <div className="admin-card admin-card-pad">
              <p className="admin-card-title">
                <AlertTriangle className="h-4 w-4 text-[var(--ad-warning)]" /> No provider configured
              </p>
              <p className="mt-1 text-[12.5px] text-[var(--ad-muted)]">
                Chatgram AI keeps working through the server environment key (if set). Add a provider here to manage keys,
                health, budgets and routing from the dashboard.
              </p>
            </div>
          ) : (
            <div className="admin-grid md:grid-cols-2 xl:grid-cols-3">
              {data.providers.map((row) => (
                <div key={row.key} className="admin-card admin-card-pad">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-[13.5px] font-bold">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${row.enabled ? 'bg-[var(--ad-success)]' : 'bg-[var(--ad-faint)]'}`} />
                        {row.label}
                      </p>
                      <p className="truncate text-[11.5px] text-[var(--ad-faint)]">
                        {row.provider} · {row.model}
                      </p>
                    </div>
                    <button type="button" className="admin-btn admin-btn-sm" onClick={() => openEdit(row)} aria-label={`Edit ${row.label}`}>
                      Edit
                    </button>
                  </div>
                  <p className="mt-2 truncate text-[11px] text-[var(--ad-muted)]" title={row.baseUrl}>{row.baseUrl || 'default endpoint'}</p>
                  <p className="mt-1 font-mono text-[11px] text-[var(--ad-faint)]">{row.hasKey ? `key ••••${row.keyLast4}` : 'no key saved'}</p>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="admin-section-label">Requests</p>
                      <p className="text-[13px] font-semibold tabular-nums">{row.health?.requests ?? 0}</p>
                    </div>
                    <div>
                      <p className="admin-section-label">Latency</p>
                      <p className="text-[13px] font-semibold tabular-nums">{row.health?.averageLatencyMs ? `${row.health.averageLatencyMs} ms` : '—'}</p>
                    </div>
                    <div>
                      <p className="admin-section-label">Errors</p>
                      <p className={`text-[13px] font-semibold tabular-nums ${(row.health?.errorRate ?? 0) > 0 ? 'text-[var(--ad-danger)]' : ''}`}>
                        {Math.round((row.health?.errorRate ?? 0) * 100)}%
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--ad-sunken)]">
                    <div
                      className="h-full rounded-full bg-[var(--ad-accent)]"
                      style={{ width: `${Math.min(100, ((row.health?.tokens ?? 0) / Math.max(1, row.dailyTokenBudget)) * 100)}%` }}
                      title={`${row.health?.tokens ?? 0} / ${row.dailyTokenBudget} tokens today`}
                    />
                  </div>
                  <p className="mt-1 text-[10.5px] text-[var(--ad-faint)]">
                    {row.health?.lastErrorCode ? `last error: ${row.health.lastErrorCode}` : row.health?.lastSuccessAt ? `healthy ${relativeTime(row.health.lastSuccessAt)}` : 'not used yet'}
                  </p>
                  <div className="mt-3 flex gap-1.5">
                    <button type="button" className="admin-btn admin-btn-sm" onClick={() => void testProvider(row.key)} disabled={busy}>
                      <PlugZap className="h-3.5 w-3.5" /> Test
                    </button>
                    <button type="button" className="admin-btn admin-btn-sm admin-btn-danger" onClick={() => setDeleteTarget(row.key)} disabled={busy} aria-label={`Delete ${row.label}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="admin-card admin-card-pad mt-3">
            <p className="admin-card-title">
              <Bot className="h-4 w-4" /> Feature routing
            </p>
            <p className="mt-1 text-[12px] text-[var(--ad-muted)]">Primary provider per feature, with one fallback when it fails.</p>
            <div className="mt-3 space-y-2">
              {Object.entries(data.features).map(([feature, assignment]) => (
                <div key={feature} className="grid items-center gap-2 sm:grid-cols-[1fr_180px_180px]">
                  <p className="text-[12.5px] font-medium">{assignment.label}</p>
                  <Select
                    label={`${assignment.label} primary provider`}
                    value={routing[feature]?.primary ?? ''}
                    options={providerOptions}
                    onChange={(value) => setRouting((current) => ({ ...current, [feature]: { primary: value, fallback: current[feature]?.fallback ?? '' } }))}
                  />
                  <Select
                    label={`${assignment.label} fallback provider`}
                    value={routing[feature]?.fallback ?? ''}
                    options={providerOptions}
                    onChange={(value) => setRouting((current) => ({ ...current, [feature]: { primary: current[feature]?.primary ?? '', fallback: value } }))}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="admin-btn admin-btn-primary" onClick={() => void applyRouting()} disabled={busy}>
                <Save className="h-3.5 w-3.5" /> Apply routing
              </button>
              <button type="button" className="admin-btn" onClick={() => void undoRouting()} disabled={busy || !data.canUndo}>
                <Undo2 className="h-3.5 w-3.5" /> Undo last change
              </button>
              {data.canUndo ? <Chip tone="accent">undo available</Chip> : null}
            </div>
          </div>

          <form onSubmit={savePolicy} className="admin-card admin-card-pad mt-3">
            <p className="admin-card-title">
              <RotateCcw className="h-4 w-4" /> AI safety & limits
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)] sm:col-span-2">
                Blocked topics (comma separated)
                <input className="admin-input mt-1" value={policyDraft.blockedTopics} onChange={(event) => setPolicyDraft({ ...policyDraft, blockedTopics: event.target.value })} placeholder="weapons, hacking" />
              </label>
              <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                Hourly limit per user
                <input type="number" className="admin-input mt-1" value={policyDraft.hourlyLimit} onChange={(event) => setPolicyDraft({ ...policyDraft, hourlyLimit: Number(event.target.value) })} />
              </label>
              <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                Daily limit per user
                <input type="number" className="admin-input mt-1" value={policyDraft.dailyLimit} onChange={(event) => setPolicyDraft({ ...policyDraft, dailyLimit: Number(event.target.value) })} />
              </label>
              <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                Max input characters
                <input type="number" className="admin-input mt-1" value={policyDraft.maxInputChars} onChange={(event) => setPolicyDraft({ ...policyDraft, maxInputChars: Number(event.target.value) })} />
              </label>
              <label className="mt-5 flex items-center gap-2 text-[12px] font-medium">
                <input type="checkbox" checked={policyDraft.alertsEnabled} onChange={(event) => setPolicyDraft({ ...policyDraft, alertsEnabled: event.target.checked })} />
                Email/Telegram alerts for AI failures
              </label>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button type="submit" className="admin-btn admin-btn-primary" disabled={busy}>
                <Check className="h-3.5 w-3.5" /> Save AI policy
              </button>
              {policy ? <span className="text-[11px] text-[var(--ad-faint)]">stored policy · {policy.source || 'database'}</span> : null}
            </div>
          </form>
        </>
      )}

      {drawerOpen ? (
        <Drawer title={editing ? `Edit ${editing}` : 'Add a provider'} onClose={() => setDrawerOpen(false)}>
          <form onSubmit={saveProvider} className="space-y-2.5">
            <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
              Provider
              <div className="mt-1">
                <Select
                  label="Provider type"
                  value={form.provider}
                  options={availableOptions}
                  onChange={(value) => {
                    const found = data?.availableProviders.find((row) => row.id === value);
                    setForm((current) => ({ ...current, provider: value, baseUrl: found?.defaultBaseUrl || '' }));
                  }}
                />
              </div>
            </label>
            <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
              Label / key
              <input className="admin-input mt-1" value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value, key: event.target.value })} placeholder="groq-primary" />
            </label>
            <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
              Model
              <input className="admin-input mt-1" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder="openai/gpt-oss-20b" />
            </label>
            <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
              Base URL
              <input className="admin-input mt-1" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://api.groq.com/openai/v1" />
            </label>
            <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
              API key (write-only; leave blank to keep the saved key)
              <input type="password" className="admin-input mt-1" autoComplete="off" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                Timeout (ms)
                <input type="number" className="admin-input mt-1" value={form.timeoutMs} onChange={(event) => setForm({ ...form, timeoutMs: Number(event.target.value) })} />
              </label>
              <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                Daily token budget
                <input type="number" className="admin-input mt-1" value={form.dailyTokenBudget} onChange={(event) => setForm({ ...form, dailyTokenBudget: Number(event.target.value) })} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-[12px] font-medium">
              <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /> Enabled
            </label>
            <button type="submit" className="admin-btn admin-btn-primary w-full" disabled={busy}>
              {editing ? 'Save provider' : 'Add provider'}
            </button>
          </form>
        </Drawer>
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title={`Remove ${deleteTarget}?`}
          body="The provider and its saved key are deleted and any feature routed to it falls back."
          confirmLabel="Remove provider"
          danger
          busy={busy}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void deleteProvider(deleteTarget)}
        />
      ) : null}
      <Toast message={toast.message} />
    </div>
  );
}
