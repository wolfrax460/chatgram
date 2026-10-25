import { useCallback, useEffect, useState } from 'react';
import { Ban, Check, Clock, ExternalLink, EyeOff, RefreshCw, Search, ShieldAlert, Trash2 } from 'lucide-react';
import { adminFetch, relativeTime, shortDate, type AdminSessionInfo } from './api';
import { Chip, ConfirmDialog, EmptyState, PageHead, Select, Skeleton, Toast, useToast } from './ui';

type ReportRow = {
  id: string;
  reason: string;
  details: string;
  status: string;
  resolution: string;
  createdAt: string;
  reporterId: string | null;
  targetUserId: string | null;
  targetChatId: string | null;
  targetMessageId: string | null;
  targetStatusId: string | null;
  reporter: { id: string; displayName: string } | null;
  targetUser: { id: string; displayName: string; status: string } | null;
  messageSnapshot: string;
};

type ReportQueue = { reports: ReportRow[]; total: number; page: number; pageCount: number; counts: Record<string, number> };

type ReportDetail = {
  report: ReportRow & { messageSnapshot: string };
  reporter: { id: string; displayName: string; email: string; createdAt: string } | null;
  targetUser: { id: string; displayName: string; email: string; status: string; createdAt: string; twoFactorEnabled: boolean } | null;
  message: { id: string; content: string; type: string; sentAt: string; isDeleted: boolean; mediaUrl: string | null } | null;
  status: { id: string; caption: string; mediaType: string; createdAt: string } | null;
  chat: { id: string; type: string; groupName: string } | null;
};

const REASONS = [
  { value: 'all', label: 'All reasons' },
  { value: 'spam', label: 'Spam' },
  { value: 'abuse', label: 'Abuse' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'scam', label: 'Scam' },
  { value: 'other', label: 'Other' },
];

const TARGET_TYPES = ['message', 'user', 'status', 'group'];

function targetType(row: ReportRow): string {
  if (row.targetMessageId) return 'message';
  if (row.targetStatusId) return 'status';
  if (row.targetChatId) return 'group';
  return 'user';
}

type Action = 'dismiss' | 'remove_content' | 'suspend' | 'ban' | null;

/** Reports & moderation: queue + read-only detail + one-click audited actions. */
export default function ReportsPage({ session }: { session: AdminSessionInfo }) {
  const toast = useToast();
  const [queue, setQueue] = useState<ReportQueue | null>(null);
  const [status, setStatus] = useState('open');
  const [reason, setReason] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Action>(null);
  const [suspendDays, setSuspendDays] = useState('7');
  const [moderationReason, setModerationReason] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const payload = await adminFetch<ReportQueue>(
        `/api/admin/reports?status=${status}&reason=${reason}&search=${encodeURIComponent(search)}&page=${page}&limit=20`,
      );
      setQueue(payload);
      if (payload.reports.length > 0 && !payload.reports.some((row) => row.id === selectedId)) {
        setSelectedId(payload.reports[0]!.id);
      }
      if (payload.reports.length === 0) {
        setSelectedId(null);
        setDetail(null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the reports.');
    }
  }, [page, reason, search, selectedId, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setDetail(null);
    adminFetch<ReportDetail>(`/api/admin/reports/${selectedId}`)
      .then((payload) => {
        if (!cancelled) setDetail(payload);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load the report.');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function resolve() {
    if (!pending || !selectedId) return;
    setBusy(true);
    setError('');
    try {
      const body =
        pending === 'suspend'
          ? { action: pending, days: Number(suspendDays) || 7, reason: moderationReason }
          : pending === 'ban'
            ? { action: pending, reason: moderationReason }
            : { action: pending };
      const result = await adminFetch<{ message: string }>(`/api/admin/reports/${selectedId}/resolve`, {
        method: 'POST',
        csrf: session.csrfToken,
        body,
      });
      toast.show(result.message);
      setPending(null);
      setDetail(null);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The action failed.');
    } finally {
      setBusy(false);
    }
  }

  const rows = queue?.reports ?? [];
  const target = detail ? TARGET_TYPES.find((type) => type === targetType(detail.report)) : null;

  return (
    <div>
      <PageHead
        title="Reports & moderation"
        subtitle={queue ? `${queue.total} ${status} reports · ${queue.counts.open || 0} open in total` : 'Abuse reports from messages, users, statuses and groups'}
        actions={
          <button type="button" className="admin-btn" onClick={() => void load()} disabled={busy}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        }
      />
      {error ? <p role="alert" className="admin-chip admin-chip-danger mb-3">{error}</p> : null}

      <div className="admin-card admin-card-pad mb-3">
        <div className="flex flex-wrap items-center gap-2">
          {([
            ['open', 'Open'],
            ['reviewed', 'Reviewed'],
            ['actioned', 'Actioned'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`admin-btn admin-btn-sm ${status === key ? 'admin-btn-primary' : ''}`}
              onClick={() => {
                setStatus(key as string);
                setPage(1);
                setSelectedId(null);
              }}
            >
              {label} {queue?.counts?.[key] ? <Chip tone="default">{queue.counts[key]}</Chip> : null}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-[var(--ad-border)]" />
          <div className="w-40">
            <Select label="Report reason filter" value={reason} options={REASONS} onChange={(value) => { setReason(value); setPage(1); }} />
          </div>
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ad-faint)]" />
            <input
              className="admin-input admin-input-with-icon"
              placeholder="Search details or content snapshot"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              aria-label="Search reports"
            />
          </div>
        </div>
      </div>

      {!queue ? (
        <div className="admin-card admin-card-pad"><Skeleton lines={6} /></div>
      ) : rows.length === 0 ? (
        <div className="admin-card admin-card-pad">
          <EmptyState title="Nothing in this queue" body="Reports from users (message, profile, status or group) land here for review." icon={<ShieldAlert className="h-6 w-6" />} />
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
          <div className="admin-card">
            <div className="admin-scroll max-h-[62vh] overflow-y-auto">
              <table className="admin-table">
                <thead>
                  <tr><th>Reported</th><th>Reason</th><th>Reporter</th><th>When</th></tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} onClick={() => setSelectedId(row.id)} aria-selected={selectedId === row.id} className={selectedId === row.id ? 'admin-row-active' : undefined}>
                      <td>
                        <p className="font-semibold">{targetType(row) === 'message' ? row.targetUser?.displayName || 'message' : targetType(row) === 'group' ? 'Group conversation' : targetType(row) === 'status' ? `${row.targetUser?.displayName || 'user'}'s status` : row.targetUser?.displayName || 'account'}</p>
                        <p className="mt-0.5 truncate text-[11.5px] text-[var(--ad-muted)]">{row.details || row.messageSnapshot || `${targetType(row)} report`}</p>
                      </td>
                      <td><Chip tone={row.reason === 'spam' ? 'warning' : 'danger'}>{row.reason}</Chip></td>
                      <td className="text-[12px]">{row.reporter?.displayName || 'unknown'}</td>
                      <td className="whitespace-nowrap text-[11.5px] text-[var(--ad-muted)]">{relativeTime(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {queue.pageCount > 1 ? (
              <div className="flex items-center justify-between border-t border-[var(--ad-border)] px-3 py-2">
                <p className="text-[11.5px] text-[var(--ad-muted)]">Page {queue.page} of {queue.pageCount}</p>
                <div className="flex gap-1.5">
                  <button type="button" className="admin-btn admin-btn-sm" disabled={queue.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
                  <button type="button" className="admin-btn admin-btn-sm" disabled={queue.page >= queue.pageCount} onClick={() => setPage((current) => current + 1)}>Next</button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="admin-card admin-card-pad">
            {!detail ? (
              <Skeleton lines={7} />
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="admin-card-title">Report detail</p>
                  <Chip tone={detail.report.status === 'open' ? 'warning' : 'success'}>{detail.report.status}</Chip>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
                  <div><dt className="admin-section-label">Type</dt><dd className="mt-0.5">{target}</dd></div>
                  <div><dt className="admin-section-label">Reason</dt><dd className="mt-0.5">{detail.report.reason}</dd></div>
                  <div><dt className="admin-section-label">Reporter</dt><dd className="mt-0.5">{detail.reporter ? `${detail.reporter.displayName} (${detail.reporter.email})` : 'unknown'}</dd></div>
                  <div><dt className="admin-section-label">Reported account</dt><dd className="mt-0.5">{detail.targetUser ? `${detail.targetUser.displayName} · ${detail.targetUser.status}` : '—'}</dd></div>
                  <div className="col-span-2"><dt className="admin-section-label">Details</dt><dd className="mt-0.5 whitespace-pre-wrap">{detail.report.details || '—'}</dd></div>
                </dl>

                {detail.message ? (
                  <div className="mt-3 rounded-xl border border-[var(--ad-border)] bg-[var(--ad-sunken)] p-3">
                    <p className="admin-section-label flex items-center gap-1.5"><Search className="h-3 w-3" /> Reported message (read-only)</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-[12.5px]">{detail.message.content || '[media]'}</p>
                    <p className="mt-2 text-[11px] text-[var(--ad-faint)]">{detail.message.type} · {shortDate(detail.message.sentAt)} {detail.message.isDeleted ? '· removed' : ''}</p>
                  </div>
                ) : null}
                {detail.status ? (
                  <div className="mt-3 rounded-xl border border-[var(--ad-border)] bg-[var(--ad-sunken)] p-3">
                    <p className="admin-section-label">Reported status</p>
                    <p className="mt-1 text-[12.5px]">{detail.status.caption || `[${detail.status.mediaType}]`}</p>
                    <p className="mt-2 text-[11px] text-[var(--ad-faint)]">{shortDate(detail.status.createdAt)}</p>
                  </div>
                ) : null}
                {detail.chat ? (
                  <p className="mt-3 text-[12px] text-[var(--ad-muted)]">
                    <ExternalLink className="mr-1 inline h-3.5 w-3.5" />
                    Group: {detail.chat.groupName || detail.chat.id} · {detail.chat.type}
                  </p>
                ) : null}
                {detail.report.messageSnapshot ? (
                  <p className="mt-2 text-[11.5px] text-[var(--ad-faint)]">Snapshot kept for the record: “{detail.report.messageSnapshot}”</p>
                ) : null}

                {detail.report.status !== 'actioned' ? (
                  <div className="mt-4 border-t border-[var(--ad-border)] pt-3">
                    <p className="admin-section-label mb-2">Resolve this report</p>
                    <div className="grid gap-2 sm:grid-cols-[100px_1fr]">
                      <label className="block text-[11px] font-semibold text-[var(--ad-muted)]">
                        Days
                        <input className="admin-input mt-1" type="number" min={1} max={3650} value={suspendDays} onChange={(event) => setSuspendDays(event.target.value)} />
                      </label>
                      <label className="block text-[11px] font-semibold text-[var(--ad-muted)]">
                        Reason for the action
                        <input className="admin-input mt-1" value={moderationReason} onChange={(event) => setModerationReason(event.target.value)} placeholder="recorded in the audit log" />
                      </label>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className="admin-btn admin-btn-sm" onClick={() => setPending('dismiss')}>
                        <EyeOff className="h-3.5 w-3.5" /> Dismiss
                      </button>
                      <button type="button" className="admin-btn admin-btn-sm admin-btn-danger" onClick={() => setPending('remove_content')} disabled={!detail.message && !detail.status}>
                        <Trash2 className="h-3.5 w-3.5" /> Remove content
                      </button>
                      <button type="button" className="admin-btn admin-btn-sm admin-btn-danger" onClick={() => setPending('suspend')} disabled={!detail.targetUser}>
                        <Clock className="h-3.5 w-3.5" /> Suspend user
                      </button>
                      <button type="button" className="admin-btn admin-btn-sm admin-btn-danger" onClick={() => setPending('ban')} disabled={!detail.targetUser}>
                        <Ban className="h-3.5 w-3.5" /> Ban user
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 flex items-center gap-1.5 text-[12px] text-[var(--ad-muted)]">
                    <Check className="h-3.5 w-3.5" /> Resolved with “{detail.report.resolution}”.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {pending ? (
        <ConfirmDialog
          title={pending === 'dismiss' ? 'Dismiss this report?' : pending === 'remove_content' ? 'Remove the reported content?' : pending === 'suspend' ? 'Suspend the reported account?' : 'Ban the reported account?'}
          body={
            pending === 'dismiss'
              ? 'The report is marked reviewed. No content or account changes.'
              : pending === 'remove_content'
                ? 'The reported message or status is removed for everyone. This cannot be undone and is audited.'
                : pending === 'suspend'
                  ? `The account cannot sign in or use the API for ${suspendDays} day(s). Audited.`
                  : 'The account is blocked until an admin restores it. Audited.'
          }
          confirmLabel={pending === 'dismiss' ? 'Dismiss report' : pending === 'remove_content' ? 'Remove content' : pending === 'suspend' ? 'Suspend account' : 'Ban account'}
          danger={pending !== 'dismiss'}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => void resolve()}
        />
      ) : null}
      <Toast message={toast.message} />
    </div>
  );
}
