import { useCallback, useEffect, useState } from 'react';
import { Megaphone, RefreshCw, Send, Trash2, Eye, XCircle } from 'lucide-react';
import { adminFetch, relativeTime, type AdminSessionInfo } from './api';
import { Chip, ConfirmDialog, PageHead, Select, Skeleton, useToast } from './ui';

type Broadcast = {
  id: string;
  kind: 'banner' | 'message';
  title: string;
  body: string;
  link: string;
  segment: 'all' | 'active' | 'new' | 'selected';
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed';
  scheduledAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  lastError: string;
  createdAt: string;
  sentAt: string | null;
};

const SEGMENTS = [
  { value: 'all', label: 'Everyone', hint: 'all active + suspended accounts' },
  { value: 'active', label: 'Active in the last 30 days' },
  { value: 'new', label: 'New in the last 7 days' },
];

function statusTone(status: Broadcast['status']) {
  if (status === 'sent') return 'success' as const;
  if (status === 'scheduled') return 'accent' as const;
  if (status === 'failed') return 'danger' as const;
  if (status === 'cancelled') return 'default' as const;
  return 'warning' as const;
}

/**
 * 9b Announcements: the in-app banner and broadcasts from the official Chatgram
 * account. A message broadcast requires a preview and an explicit confirmation;
 * sent announcements are kept for the record and cannot be deleted.
 */
export default function BroadcastsPage({ session }: { session: AdminSessionInfo }) {
  const toast = useToast();
  const [rows, setRows] = useState<Broadcast[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [kind, setKind] = useState<'banner' | 'message'>('banner');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [segment, setSegment] = useState('all');
  const [scheduledAt, setScheduledAt] = useState('');

  const [confirming, setConfirming] = useState<Broadcast | null>(null);
  const [preview, setPreview] = useState<{ count: number; capped: boolean; sample: { displayName: string }[] } | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const payload = await adminFetch<{ broadcasts: Broadcast[]; total: number }>('/api/admin/broadcasts?limit=50');
      setRows(payload.broadcasts);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the announcements.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createDraft() {
    setBusy(true);
    setError('');
    try {
      const created = await adminFetch<{ broadcast: Broadcast }>('/api/admin/broadcasts', {
        method: 'POST',
        csrf: session.csrfToken,
        body: {
          kind,
          title: kind === 'banner' ? title : '',
          body,
          link: kind === 'banner' ? link : '',
          segment: kind === 'message' ? segment : 'all',
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        },
      });
      toast.show(created.broadcast.status === 'scheduled' ? 'Announcement scheduled.' : 'Draft saved.');
      setTitle('');
      setBody('');
      setLink('');
      setScheduledAt('');
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not save the announcement.');
    } finally {
      setBusy(false);
    }
  }

  async function openConfirm(row: Broadcast) {
    setError('');
    setBusy(true);
    try {
      const result = await adminFetch<{ recipientCount: number; capped: boolean; sample: { displayName: string }[] }>(`/api/admin/broadcasts/${row.id}/preview`);
      setPreview({ count: result.recipientCount, capped: result.capped, sample: result.sample });
      setConfirming(row);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Could not preview the announcement.');
    } finally {
      setBusy(false);
    }
  }

  async function sendNow(row: Broadcast) {
    setBusy(true);
    setError('');
    try {
      const result = await adminFetch<{ message: string }>(`/api/admin/broadcasts/${row.id}/send`, {
        method: 'POST',
        csrf: session.csrfToken,
        body: { confirm: true },
      });
      toast.show(result.message);
      setConfirming(null);
      setPreview(null);
      await load();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send the announcement.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelDraft(row: Broadcast) {
    setBusy(true);
    try {
      const result = await adminFetch<{ message: string }>(`/api/admin/broadcasts/${row.id}/cancel`, { method: 'POST', csrf: session.csrfToken, body: {} });
      toast.show(result.message);
      await load();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Could not cancel the announcement.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteDraft(row: Broadcast) {
    setBusy(true);
    try {
      const result = await adminFetch<{ message: string }>(`/api/admin/broadcasts/${row.id}`, { method: 'DELETE', csrf: session.csrfToken });
      toast.show(result.message);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete the announcement.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHead
        title="Announcements"
        subtitle="Publish an in-app banner or send a message from the official Chatgram account to a segment. Message sends show a preview and require confirmation; every action is audited."
        actions={
          <button type="button" className="admin-btn admin-btn-sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        }
      />

      {error ? <p className="admin-chip admin-chip-danger mb-3">{error}</p> : null}

      <div className="admin-card admin-card-pad">
        <p className="admin-card-title flex items-center gap-2"><Megaphone className="h-4 w-4" /> New announcement</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
            Type
            <Select
              value={kind}
              label="Announcement type"
              options={[
                { value: 'banner', label: 'In-app banner' },
                { value: 'message', label: 'Message from the official account' },
              ]}
              onChange={(next) => setKind(next === 'message' ? 'message' : 'banner')}
            />
          </label>
          {kind === 'banner' ? (
            <>
              <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                Title (optional)
                <input className="admin-input mt-1 w-full" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)] md:col-span-2">
                Banner text
                <textarea className="admin-input mt-1 h-20 w-full" value={body} maxLength={300} onChange={(event) => setBody(event.target.value)} placeholder="e.g. New: Chatgram AI is now in your chat list. Tap it to ask anything." />
              </label>
              <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                Link (optional /path or https URL)
                <input className="admin-input mt-1 w-full" value={link} maxLength={300} onChange={(event) => setLink(event.target.value)} placeholder="/web/#download" />
              </label>
            </>
          ) : (
            <>
              <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                Segment
                <Select value={segment} label="Broadcast segment" options={SEGMENTS} onChange={setSegment} />
              </label>
              <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)] md:col-span-2">
                Message
                <textarea className="admin-input mt-1 h-24 w-full" value={body} maxLength={2000} onChange={(event) => setBody(event.target.value)} placeholder="Write the message users will receive from the Chatgram account." />
              </label>
            </>
          )}
          <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
            Schedule (optional — empty sends only when you confirm)
            <input type="datetime-local" className="admin-input mt-1 w-full" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="admin-btn admin-btn-primary" disabled={busy || body.trim().length < 2} onClick={() => void createDraft()}>
            <Megaphone className="h-3.5 w-3.5" /> {scheduledAt ? 'Schedule' : 'Save draft'}
          </button>
          <span className="text-[11.5px] text-[var(--ad-muted)]">
            Nothing is published or sent until you confirm it from the list below.
          </span>
        </div>
      </div>

      <div className="admin-card mt-3">
        <div className="border-b border-[var(--ad-border)] p-3">
          <p className="admin-card-title">Announcements</p>
        </div>
        {!rows ? (
          <div className="p-4">
            <Skeleton lines={4} />
          </div>
        ) : rows.length === 0 ? (
          <div className="admin-empty p-6 text-center">
            <Megaphone className="mx-auto mb-2 h-6 w-6 text-[var(--ad-muted)]" />
            <p className="text-[13px] font-semibold">Nothing announced yet</p>
            <p className="text-[12px] text-[var(--ad-muted)]">Save a banner or message above, then publish it here.</p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Text</th>
                  <th>Audience</th>
                  <th>Status</th>
                  <th>Delivered</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td><Chip tone={row.kind === 'banner' ? 'accent' : 'default'}>{row.kind}</Chip></td>
                    <td className="max-w-[320px]">
                      <span className="block truncate" title={row.body}>{row.title ? `${row.title} — ` : ''}{row.body}</span>
                      {row.scheduledAt ? <span className="text-[11px] text-[var(--ad-muted)]">scheduled {new Date(row.scheduledAt).toLocaleString()}</span> : null}
                    </td>
                    <td>{row.kind === 'banner' ? 'all users (banner)' : row.segment}</td>
                    <td><Chip tone={statusTone(row.status)}>{row.status}</Chip>{row.lastError ? <span className="block text-[11px] text-[var(--ad-danger)]">{row.lastError}</span> : null}</td>
                    <td>{row.sentCount ? `${row.sentCount}/${row.recipientCount}` : row.recipientCount ? `${row.recipientCount} recipients` : '—'}</td>
                    <td>{relativeTime(row.createdAt)}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {['draft', 'scheduled', 'failed'].includes(row.status) ? (
                          <button type="button" className="admin-btn admin-btn-sm admin-btn-primary" disabled={busy} onClick={() => void openConfirm(row)}>
                            {row.kind === 'banner' ? <><Eye className="h-3.5 w-3.5" /> Publish</> : <><Send className="h-3.5 w-3.5" /> Preview &amp; send</>}
                          </button>
                        ) : null}
                        {['draft', 'scheduled'].includes(row.status) ? (
                          <button type="button" className="admin-btn admin-btn-sm" disabled={busy} onClick={() => void cancelDraft(row)}>
                            <XCircle className="h-3.5 w-3.5" /> Cancel
                          </button>
                        ) : null}
                        {['draft', 'cancelled'].includes(row.status) ? (
                          <button type="button" className="admin-btn admin-btn-sm admin-btn-danger" disabled={busy} onClick={() => void deleteDraft(row)}>
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirming ? (
        <ConfirmDialog
          title={confirming.kind === 'banner' ? 'Publish this banner?' : 'Send this message?'}
          body={
            confirming.kind === 'banner'
              ? `The banner will appear for every user in the app: “${confirming.body.slice(0, 120)}${confirming.body.length > 120 ? '…' : ''}”.`
              : `This sends a direct message from the official Chatgram account to ${preview?.count ?? 0} accounts${preview?.capped ? ` (capped; first ${preview.count} shown)` : ''}: “${confirming.body.slice(0, 120)}${confirming.body.length > 120 ? '…' : ''}”. ${preview?.sample?.length ? `Sample: ${preview.sample.map((row) => row.displayName).join(', ')}.` : ''}`
          }
          confirmLabel={confirming.kind === 'banner' ? 'Publish banner' : 'Send message'}
          busy={busy}
          onConfirm={() => void sendNow(confirming)}
          onCancel={() => {
            setConfirming(null);
            setPreview(null);
          }}
        />
      ) : null}
    </div>
  );
}
