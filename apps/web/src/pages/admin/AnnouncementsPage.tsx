import { useCallback, useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { adminFetch, type AdminSessionInfo } from './api';
import { Chip, PageHead, Select, Skeleton, Toast, useToast } from './ui';

type Recommendation = {
  key: string;
  title: string;
  body: string;
  ctaLabel: string;
  action: 'ai' | 'downloads' | 'profile' | 'invite' | 'url';
  url: string;
  enabled: boolean;
  order: number;
  hideWhen: 'never' | 'twoFactor' | 'profilePhoto';
};

const ACTION_OPTIONS = [
  { value: 'ai', label: 'Open Chatgram AI' },
  { value: 'downloads', label: 'Open the downloads page' },
  { value: 'profile', label: 'Open settings / profile' },
  { value: 'invite', label: 'Share the invite link' },
  { value: 'url', label: 'Open a URL' },
];

const HIDE_OPTIONS = [
  { value: 'never', label: 'Always show' },
  { value: 'twoFactor', label: 'Hide when 2FA is on' },
  { value: 'profilePhoto', label: 'Hide when a photo is set' },
];

/**
 * Announcements (item 4 editor): the empty-screen recommendations are edited
 * here and read by GET /api/app/recommendations. In-app banners/broadcasts are
 * still to build (crossed in the report).
 */
export default function AnnouncementsPage({ session }: { session: AdminSessionInfo }) {
  const toast = useToast();
  const [rows, setRows] = useState<Recommendation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const payload = await adminFetch<{ recommendations: Recommendation[] }>('/api/admin/recommendations');
      setRows(payload.recommendations);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load recommendations.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function patch(index: number, changes: Partial<Recommendation>) {
    setRows((current) => (current ? current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...changes } : row)) : current));
  }

  function addRow() {
    setRows((current) => [
      ...(current ?? []),
      {
        key: `new-tip-${Date.now().toString(36)}`,
        title: 'New recommendation',
        body: '',
        ctaLabel: 'Open',
        action: 'url',
        url: '/web/',
        enabled: true,
        order: ((current?.length ?? 0) + 1) * 10,
        hideWhen: 'never',
      },
    ]);
  }

  function removeRow(index: number) {
    setRows((current) => (current ? current.filter((_, rowIndex) => rowIndex !== index) : current));
  }

  async function save() {
    if (!rows) return;
    setBusy(true);
    setError('');
    try {
      const payload = await adminFetch<{ recommendations: Recommendation[] }>('/api/admin/recommendations', {
        method: 'PUT',
        csrf: session.csrfToken,
        body: { recommendations: rows },
      });
      setRows(payload.recommendations);
      toast.show('Recommendations saved.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the recommendations.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHead
        title="Announcements"
        subtitle="The one card shown when no chat is selected. Completed items (2FA, profile photo) are hidden automatically."
        actions={
          <>
            <Chip tone="accent">item 4</Chip>
            <button type="button" className="admin-btn" onClick={addRow}>
              <Plus className="h-3.5 w-3.5" /> Add recommendation
            </button>
            <button type="button" className="admin-btn admin-btn-primary" onClick={() => void save()} disabled={busy || !rows}>
              <Save className="h-3.5 w-3.5" /> Save
            </button>
          </>
        }
      />
      {error ? <p role="alert" className="admin-chip admin-chip-danger mb-3">{error}</p> : null}

      <div className="admin-card admin-card-pad mb-3">
        <p className="admin-card-title">In-app banners and broadcasts</p>
        <p className="mt-1 text-[12.5px] text-[var(--ad-muted)]">
          A message from the official Chatgram account to everyone or a segment, with preview and send confirmation, is
          still to build (crossed in the report). The recommendation editor below is live.
        </p>
      </div>

      {!rows ? (
        <div className="admin-card admin-card-pad">
          <Skeleton lines={6} />
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={`${row.key}-${index}`} className="admin-card admin-card-pad">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={row.enabled ? 'success' : 'default'}>{row.enabled ? 'visible' : 'hidden'}</Chip>
                <span className="font-mono text-[11px] text-[var(--ad-faint)]">{row.key}</span>
                <label className="ml-auto flex items-center gap-2 text-[12px] font-medium">
                  <input type="checkbox" checked={row.enabled} onChange={(event) => patch(index, { enabled: event.target.checked })} /> Enabled
                </label>
                <button type="button" className="admin-btn admin-btn-sm admin-btn-danger" onClick={() => removeRow(index)} aria-label={`Remove ${row.key}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                  Title
                  <input className="admin-input mt-1" value={row.title} onChange={(event) => patch(index, { title: event.target.value })} />
                </label>
                <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                  Button label
                  <input className="admin-input mt-1" value={row.ctaLabel} onChange={(event) => patch(index, { ctaLabel: event.target.value })} />
                </label>
                <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)] md:col-span-2">
                  Body
                  <input className="admin-input mt-1" value={row.body} onChange={(event) => patch(index, { body: event.target.value })} />
                </label>
                <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                  Button action
                  <div className="mt-1">
                    <Select label={`Action for ${row.key}`} value={row.action} options={ACTION_OPTIONS} onChange={(value) => patch(index, { action: value as Recommendation['action'] })} />
                  </div>
                </label>
                <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                  When to hide it
                  <div className="mt-1">
                    <Select label={`Visibility rule for ${row.key}`} value={row.hideWhen} options={HIDE_OPTIONS} onChange={(value) => patch(index, { hideWhen: value as Recommendation['hideWhen'] })} />
                  </div>
                </label>
                {row.action === 'url' ? (
                  <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)] md:col-span-2">
                    URL
                    <input className="admin-input mt-1" value={row.url} onChange={(event) => patch(index, { url: event.target.value })} placeholder="/web/ or https://…" />
                  </label>
                ) : null}
                <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                  Order
                  <input type="number" className="admin-input mt-1" value={row.order} onChange={(event) => patch(index, { order: Number(event.target.value) })} />
                </label>
              </div>
            </div>
          ))}
          {rows.length === 0 ? <p className="admin-empty">No recommendations — the empty screen will show the plain welcome card.</p> : null}
        </div>
      )}
      <Toast message={toast.message} />
    </div>
  );
}
