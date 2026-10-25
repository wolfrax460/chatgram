import { useCallback, useEffect, useState } from 'react';
import { Download, Eye, RefreshCw, ShieldAlert, Timer } from 'lucide-react';
import {
  adminFetch,
  relativeTime,
  shortDate,
  type ReviewLogPayload,
  type ReviewRow,
  type ReviewStats,
} from './api';
import { Chip, PageHead, Skeleton, useToast } from './ui';

/** 9d: "Who viewed what" â€” the append-only log of security reviews. */
export default function ReviewsPage() {
  const toast = useToast();
  const [data, setData] = useState<ReviewLogPayload | null>(null);
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [log, counters] = await Promise.all([
        adminFetch<ReviewLogPayload>(`/api/admin/reviews?limit=25&page=${page}${status ? `&status=${status}` : ''}`),
        adminFetch<ReviewStats>('/api/admin/reviews/stats'),
      ]);
      setData(log);
      setStats(counters);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the review log.');
    }
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportCsv() {
    setExporting(true);
    try {
      const response = await fetch('/api/admin/reviews?format=csv&limit=200', { credentials: 'include' });
      if (!response.ok) throw new Error(`Export failed (${response.status}).`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'chatgram-review-log.csv';
      anchor.click();
      URL.revokeObjectURL(url);
      toast.show('Review log exported as CSV.');
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div>
      <PageHead
        title="Who viewed what"
        subtitle="Every security review of a user's conversations, with the written reason, the admin session that started it and how much content was opened."
        actions={
          <div className="flex gap-2">
            <button type="button" className="admin-btn admin-btn-sm" onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
            <button type="button" className="admin-btn admin-btn-sm admin-btn-primary" onClick={() => void exportCsv()} disabled={exporting}>
              <Download className="h-3.5 w-3.5" /> {exporting ? 'Exportingâ€¦' : 'Export CSV'}
            </button>
          </div>
        }
      />

      <div className="review-stats">
        <div className="admin-card admin-kpi">
          <span className="admin-section-label">Reviews Â· last hour</span>
          <strong className="admin-kpi-value">{stats?.lastHour ?? 'â€”'}</strong>
          <span className={`admin-chip ${stats?.burst ? 'admin-chip-danger' : 'admin-chip-success'}`}>
            {stats?.burst ? 'burst detected' : `threshold ${stats?.burstThreshold ?? 10}`}
          </span>
        </div>
        <div className="admin-card admin-kpi">
          <span className="admin-section-label">Reviews Â· last 24h</span>
          <strong className="admin-kpi-value">{stats?.lastDay ?? 'â€”'}</strong>
          <span className="admin-chip">rate limit {stats?.rateLimitPerHour ?? 20}/h</span>
        </div>
        <div className="admin-card admin-kpi">
          <span className="admin-section-label">Active now</span>
          <strong className="admin-kpi-value">{stats?.active ?? 'â€”'}</strong>
          <span className="admin-chip"><Timer className="h-3 w-3" /> 15 min idle</span>
        </div>
        <div className="admin-card admin-kpi">
          <span className="admin-section-label">Retention</span>
          <strong className="admin-kpi-value">{stats ? Math.round((stats.retentionDays / 365) * 10) / 10 : 'â€”'}y</strong>
          <span className="admin-chip">append-only audit</span>
        </div>
      </div>

      {stats?.burst ? (
        <p className="admin-chip admin-chip-danger mb-3">
          <ShieldAlert className="h-3.5 w-3.5" /> Unusually many reviews in the last hour â€” check the reasons below.
        </p>
      ) : null}
      {error ? <p className="admin-chip admin-chip-danger mb-3">{error}</p> : null}

      <div className="admin-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ad-border)] p-3">
          <div className="flex gap-2">
            {['', 'active', 'ended', 'expired'].map((value) => (
              <button
                key={value || 'all'}
                type="button"
                className={`admin-btn admin-btn-sm ${status === value ? 'admin-btn-primary' : ''}`}
                onClick={() => {
                  setStatus(value);
                  setPage(0);
                }}
              >
                {value ? value[0]!.toUpperCase() + value.slice(1) : 'All'}
              </button>
            ))}
          </div>
          <span className="text-[11.5px] text-[var(--ad-muted)]">
            {data ? `${data.total} review${data.total === 1 ? '' : 's'} Â· retention ${data.retentionDays} days` : ''}
          </span>
        </div>

        {!data ? (
          <div className="p-4">
            <Skeleton lines={5} />
          </div>
        ) : data.reviews.length === 0 ? (
          <div className="admin-empty p-6 text-center">
            <Eye className="mx-auto mb-2 h-6 w-6 text-[var(--ad-muted)]" />
            <p className="text-[13px] font-semibold">No reviews yet</p>
            <p className="text-[12px] text-[var(--ad-muted)]">
              A review is recorded whenever an administrator opens a user's conversations from the Users page.
            </p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>User reviewed</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Reads</th>
                  <th>Ended</th>
                </tr>
              </thead>
              <tbody>
                {data.reviews.map((row: ReviewRow) => (
                  <tr key={row.id}>
                    <td title={new Date(row.createdAt).toLocaleString()}>{relativeTime(row.createdAt)}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        {row.user?.avatarUrl ? (
                          <img src={row.user.avatarUrl} alt="" className="admin-avatar" />
                        ) : (
                          <span className="admin-avatar fallback">{(row.user?.displayName || '?').slice(0, 1)}</span>
                        )}
                        <span>{row.user?.displayName || 'Unknown user'}</span>
                      </div>
                    </td>
                    <td className="max-w-[340px]">
                      <span className="block truncate" title={row.reason}>{row.reason}</span>
                      {row.reference ? <span className="text-[11px] text-[var(--ad-muted)]">ref {row.reference}</span> : null}
                    </td>
                    <td>
                      <Chip tone={row.status === 'active' ? 'success' : row.status === 'expired' ? 'warning' : 'default'}>
                        {row.status}
                      </Chip>
                    </td>
                    <td>{row.views}</td>
                    <td>{row.endedAt ? shortDate(row.endedAt) : 'â€”'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 p-3">
          <button type="button" className="admin-btn admin-btn-sm" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>
            Previous
          </button>
          <span className="text-[11.5px] text-[var(--ad-muted)]">Page {page + 1} of {pageCount}</span>
          <button type="button" className="admin-btn admin-btn-sm" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
