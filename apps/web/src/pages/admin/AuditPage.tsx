import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { adminFetch } from './api';
import { Chip, EmptyState, PageHead, Select, Skeleton } from './ui';

type AuditEntry = { action: string; detail: string; ip: string; at: string };
type AuditPayload = { entries: AuditEntry[]; total: number; page: number; limit: number; pageCount: number; days: number };

/** Audit log: append-only admin actions with filters, pagination and CSV export. */
export default function AuditPage() {
  const [data, setData] = useState<AuditPayload | null>(null);
  const [search, setSearch] = useState('');
  const [days, setDays] = useState('30');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(
        await adminFetch<AuditPayload>(
          `/api/admin/audit?search=${encodeURIComponent(search)}&days=${days}&page=${page}&limit=50`,
        ),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not read the audit log.');
    } finally {
      setLoading(false);
    }
  }, [days, page, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  const entries = useMemo(() => data?.entries ?? [], [data?.entries]);

  function exportCsv() {
    const lines = ['time,action,detail,ip'].concat(
      entries.map((row) => [new Date(row.at).toISOString(), row.action, `"${String(row.detail).replace(/"/g, '""')}"`, row.ip].join(',')),
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chatgram-admin-audit-page-${data?.page ?? 1}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHead
        title="Audit log"
        subtitle={data ? `${data.total} admin actions in the last ${data.days} days · append-only` : 'Every admin action, in order.'}
        actions={
          <>
            <Select
              label="Audit date range"
              value={days}
              onChange={(value) => {
                setDays(value);
                setPage(1);
              }}
              options={[
                { value: '7', label: 'Last 7 days' },
                { value: '30', label: 'Last 30 days' },
                { value: '90', label: 'Last 90 days' },
                { value: '365', label: 'Last year' },
              ]}
            />
            <button type="button" className="admin-btn" onClick={exportCsv} disabled={entries.length === 0}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </button>
            <button type="button" className="admin-btn" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </>
        }
      />
      {error ? <p role="alert" className="admin-chip admin-chip-danger mb-3">{error}</p> : null}

      <div className="admin-card admin-card-pad">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ad-faint)]" />
          <input
            className="admin-input admin-input-with-icon"
            placeholder="Filter by action or detail (e.g. recommendations_update)"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            aria-label="Search the audit log"
          />
        </div>

        <div className="admin-scroll mt-3 max-h-[60vh] overflow-y-auto rounded-xl border border-[var(--ad-border)]">
          {!data ? (
            <div className="p-4"><Skeleton lines={6} /></div>
          ) : entries.length === 0 ? (
            <div className="p-3">
              <EmptyState title="No admin actions in this window" body="Actions like logins, provider changes, inbox answers and recommendation edits appear here." icon={<ShieldCheck className="h-6 w-6" />} />
            </div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr><th>When</th><th>Action</th><th>Detail</th><th>IP</th></tr>
              </thead>
              <tbody>
                {entries.map((row, index) => {
                  const key = `${row.at}-${index}`;
                  const expanded = openRow === key;
                  return (
                    <tr key={key} onClick={() => setOpenRow(expanded ? null : key)}>
                      <td className="whitespace-nowrap text-[11.5px] text-[var(--ad-muted)]">{new Date(row.at).toLocaleString()}</td>
                      <td><Chip tone={row.action.includes('failure') || row.action.includes('lock') ? 'danger' : 'accent'}>{row.action}</Chip></td>
                      <td className="max-w-[420px]">
                        <p className={expanded ? 'break-words text-[12px]' : 'truncate text-[12px] text-[var(--ad-muted)]'}>{row.detail || '—'}</p>
                      </td>
                      <td className="whitespace-nowrap font-mono text-[11px] text-[var(--ad-faint)]">{row.ip || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {data && data.pageCount > 1 ? (
          <div className="mt-3 flex items-center justify-between">
            <p className="text-[11.5px] text-[var(--ad-muted)]">
              Page {data.page} of {data.pageCount} · {data.total} actions
            </p>
            <div className="flex gap-1.5">
              <button type="button" className="admin-btn admin-btn-sm" disabled={data.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                <ChevronLeft className="h-3.5 w-3.5" /> Previous
              </button>
              <button type="button" className="admin-btn admin-btn-sm" disabled={data.page >= data.pageCount} onClick={() => setPage((current) => current + 1)}>
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : null}
        <p className="mt-3 text-[11px] text-[var(--ad-faint)]">
          The log is append-only: there is no edit or delete action, and secrets are never written to it.
        </p>
      </div>
    </div>
  );
}
