import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download, Search, ShieldCheck, UserRound } from 'lucide-react';
import { adminFetch, formatNumber, initials, relativeTime, shortDate, type AdminUsersPayload, type AdminUserRow } from './api';
import { Chip, EmptyState, PageHead, Select, Skeleton } from './ui';

const PAGE_SIZE = 20;

function StatusChips({ user }: { user: AdminUserRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {user.online ? <Chip tone="success">online</Chip> : <Chip>offline</Chip>}
      {user.status === 'suspended' ? <Chip tone="warning">suspended</Chip> : null}
      {user.status === 'banned' ? <Chip tone="danger">banned</Chip> : null}
      {user.twoFactorEnabled ? <Chip tone="accent">2FA</Chip> : null}
      {user.mustChangePassword ? <Chip tone="warning">must change password</Chip> : null}
      {user.isSupportAccount ? <Chip tone="accent">official support</Chip> : null}
      {user.isAiAccount ? <Chip tone="accent">Chatgram AI</Chip> : null}
      {user.reportCount > 0 ? <Chip tone="danger">{user.reportCount} report{user.reportCount === 1 ? '' : 's'}</Chip> : null}
    </span>
  );
}

/** Users: server-side search + pagination, safety chips, CSV export, row -> detail. */
export default function UsersPage() {
  const navigate = useNavigate();
  const [payload, setPayload] = useState<AdminUsersPayload | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<'newest' | 'oldest' | 'name'>('newest');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPayload(
        await adminFetch<AdminUsersPayload>(
          `/api/admin/users?search=${encodeURIComponent(search)}&page=${page}&limit=${PAGE_SIZE}`,
        ),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load users.');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  const rows = useMemo(() => {
    const list = [...(payload?.users ?? [])];
    if (sort === 'oldest') list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    else if (sort === 'name') list.sort((a, b) => a.displayName.localeCompare(b.displayName));
    else list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return list;
  }, [payload?.users, sort]);

  function exportCsv() {
    const header = ['id', 'displayName', 'email', 'phone', 'createdAt', 'lastSeen', 'online', 'twoFactorEnabled', 'reportCount', 'status'];
    const lines = [header.join(',')].concat(
      rows.map((row) =>
        [
          row.id,
          `"${row.displayName.replace(/"/g, '""')}"`,
          row.email,
          row.phone,
          row.createdAt,
          row.lastSeen || '',
          row.online ? 'yes' : 'no',
          row.twoFactorEnabled ? 'yes' : 'no',
          row.reportCount,
        ].join(','),
      ),
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chatgram-users-page-${payload?.page ?? 1}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHead
        title="Users"
        subtitle={payload ? `${formatNumber(payload.total)} accounts · page ${payload.page} of ${payload.pageCount}` : 'Search people by name, email or phone'}
        actions={
          <>
            <Select
              label="Sort users"
              value={sort}
              onChange={(value) => setSort(value as typeof sort)}
              options={[
                { value: 'newest', label: 'Newest first' },
                { value: 'oldest', label: 'Oldest first' },
                { value: 'name', label: 'Name A→Z' },
              ]}
            />
            <button type="button" className="admin-btn" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </button>
          </>
        }
      />
      <div className="admin-card admin-card-pad">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ad-faint)]" />
            <input
              className="admin-input admin-input-with-icon"
              placeholder="Search users by name, email or phone"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              aria-label="Search users"
            />
          </div>
          <button type="button" className="admin-btn" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        </div>

        {error ? <p role="alert" className="mt-3 admin-chip admin-chip-danger">{error}</p> : null}

        <div className="admin-scroll mt-3 max-h-[62vh] overflow-y-auto rounded-xl border border-[var(--ad-border)]">
          {!payload ? (
            <div className="p-4">
              <Skeleton lines={6} />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-3">
              <EmptyState title="No users match" body="Try a different name, email or phone number." icon={<UserRound className="h-6 w-6" />} />
            </div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th>Last seen</th>
                  <th>Reports</th>
                  <th>Security</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((user) => (
                  <tr key={user.id} onClick={() => navigate(`/admin/users/${user.id}`)}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--ad-sunken)] text-[10.5px] font-bold text-[var(--ad-muted)]">
                          {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" /> : initials(user.displayName)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-semibold">{user.displayName}</p>
                          <p className="truncate text-[11px] text-[var(--ad-faint)]">{user.email || user.phone || 'no email'}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <StatusChips user={user} />
                    </td>
                    <td className="whitespace-nowrap text-[12px] text-[var(--ad-muted)]">{shortDate(user.createdAt)}</td>
                    <td className="whitespace-nowrap text-[12px] text-[var(--ad-muted)]">{relativeTime(user.lastSeen)}</td>
                    <td className="text-[12px] tabular-nums text-[var(--ad-muted)]">{user.reportCount > 0 ? <Chip tone="danger">{user.reportCount} reports</Chip> : '—'}</td>
                    <td>
                      {user.twoFactorEnabled ? (
                        <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--ad-success)]">
                          <ShieldCheck className="h-3.5 w-3.5" /> 2FA on
                        </span>
                      ) : (
                        <span className="text-[11.5px] text-[var(--ad-faint)]">2FA off</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {payload && payload.pageCount > 1 ? (
          <div className="mt-3 flex items-center justify-between">
            <p className="text-[11.5px] text-[var(--ad-muted)]">
              Showing {(payload.page - 1) * payload.limit + 1}–{Math.min(payload.page * payload.limit, payload.total)} of {formatNumber(payload.total)}
            </p>
            <div className="flex gap-1.5">
              <button type="button" className="admin-btn admin-btn-sm" disabled={payload.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} aria-label="Previous page">
                <ChevronLeft className="h-3.5 w-3.5" /> Previous
              </button>
              <button type="button" className="admin-btn admin-btn-sm" disabled={payload.page >= payload.pageCount} onClick={() => setPage((current) => current + 1)} aria-label="Next page">
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
