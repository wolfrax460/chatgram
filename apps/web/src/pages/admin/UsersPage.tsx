import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download, Eye, EyeOff, LogOut, Search, ShieldAlert, ShieldCheck, UserRound } from 'lucide-react';
import { adminFetch, formatNumber, initials, relativeTime, shortDate, type AdminSessionInfo, type AdminUsersPayload, type AdminUserRow } from './api';
import { Chip, ConfirmDialog, EmptyState, PageHead, Select, Skeleton, Toast, useToast } from './ui';

const PAGE_SIZE = 20;
const COLUMNS = ['joined', 'lastSeen', 'reports', 'security'] as const;
type ColumnKey = (typeof COLUMNS)[number];
const COLUMN_LABEL: Record<ColumnKey, string> = { joined: 'Joined', lastSeen: 'Last seen', reports: 'Reports', security: 'Security' };
type SavedView = { name: string; search: string; sort: 'newest' | 'oldest' | 'name'; hidden: ColumnKey[] };
const VIEWS_KEY = 'chatgram.users.views';
const COLUMNS_KEY = 'chatgram.users.hiddenColumns';

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
export default function UsersPage({ session }: { session: AdminSessionInfo }) {
  const navigate = useNavigate();
  const [payload, setPayload] = useState<AdminUsersPayload | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<'newest' | 'oldest' | 'name'>('newest');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<ColumnKey[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(COLUMNS_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter((key) => (COLUMNS as readonly string[]).includes(key)) : [];
    } catch {
      return [];
    }
  });
  const [views, setViews] = useState<SavedView[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(VIEWS_KEY) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  });
  const [viewName, setViewName] = useState('');
  const [activeView, setActiveView] = useState('');

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

  useEffect(() => {
    localStorage.setItem(COLUMNS_KEY, JSON.stringify(hiddenColumns));
  }, [hiddenColumns]);

  useEffect(() => {
    localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
  }, [views]);

  function toggleColumn(key: ColumnKey) {
    setHiddenColumns((current) => (current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]));
  }

  function saveView() {
    const name = viewName.trim();
    if (!name) return;
    setViews((current) => [...current.filter((view) => view.name !== name), { name, search, sort, hidden: hiddenColumns }].slice(0, 10));
    setActiveView(name);
    setViewName('');
    toast.show(`Saved view “${name}”.`);
  }

  function applyView(name: string) {
    setActiveView(name);
    const view = views.find((entry) => entry.name === name);
    if (!view) return;
    setSearch(view.search);
    setSort(view.sort);
    setHiddenColumns(view.hidden);
    setPage(1);
  }

  async function bulkAction(action: 'suspend' | 'force-logout' | 'unban', extra: Record<string, unknown> = {}) {
    if (selected.size === 0) return;
    setBulkBusy(true);
    setError('');
    try {
      const result = await adminFetch<{ message: string }>('/api/admin/users/bulk', {
        method: 'POST',
        csrf: session.csrfToken,
        body: { action, ids: [...selected], ...extra },
      } as never);
      toast.show(result.message);
      setSelected(new Set());
      setConfirmSuspend(false);
      await load();
    } catch (bulkError) {
      setError(bulkError instanceof Error ? bulkError.message : 'The bulk action failed.');
    } finally {
      setBulkBusy(false);
    }
  }

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

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--ad-muted)]">
          <span className="font-semibold">Columns:</span>
          {COLUMNS.map((key) => (
            <button
              key={key}
              type="button"
              className={`admin-btn admin-btn-sm ${hiddenColumns.includes(key) ? '' : 'admin-btn-primary'}`}
              onClick={() => toggleColumn(key)}
              aria-pressed={!hiddenColumns.includes(key)}
              title={hiddenColumns.includes(key) ? `Show ${COLUMN_LABEL[key]}` : `Hide ${COLUMN_LABEL[key]}`}
            >
              {hiddenColumns.includes(key) ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />} {COLUMN_LABEL[key]}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-[var(--ad-border)]" />
          <span className="font-semibold">Saved views:</span>
          <Select
            label="Saved filter views"
            value={activeView}
            onChange={(value) => applyView(value)}
            options={[{ value: '', label: 'None' }, ...views.map((view) => ({ value: view.name, label: view.name }))]}
          />
          <input className="admin-input !py-1 !text-[11.5px]" placeholder="View name" value={viewName} maxLength={40} onChange={(event) => setViewName(event.target.value)} aria-label="Saved view name" />
          <button type="button" className="admin-btn admin-btn-sm" disabled={!viewName.trim()} onClick={saveView}>
            Save view
          </button>
          {activeView ? (
            <button type="button" className="admin-btn admin-btn-sm" onClick={() => { setViews((current) => current.filter((view) => view.name !== activeView)); setActiveView(''); }}>
              Delete view
            </button>
          ) : null}
        </div>

        {selected.size > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--ad-accent)]/40 bg-[var(--ad-accent-soft)] p-2 text-[12px]">
            <strong>{selected.size} selected</strong>
            <button type="button" className="admin-btn admin-btn-sm" disabled={bulkBusy} onClick={() => setConfirmSuspend(true)}>
              <ShieldAlert className="h-3.5 w-3.5" /> Suspend 7 days
            </button>
            <button type="button" className="admin-btn admin-btn-sm" disabled={bulkBusy} onClick={() => void bulkAction('unban')}>
              <ShieldCheck className="h-3.5 w-3.5" /> Restore access
            </button>
            <button type="button" className="admin-btn admin-btn-sm" disabled={bulkBusy} onClick={() => void bulkAction('force-logout')}>
              <LogOut className="h-3.5 w-3.5" /> Force logout
            </button>
            <button type="button" className="admin-btn admin-btn-sm" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        ) : null}

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
                  <th className="w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all users on this page"
                      checked={rows.length > 0 && rows.every((row) => selected.has(row.id))}
                      onChange={(event) => setSelected(event.target.checked ? new Set(rows.map((row) => row.id)) : new Set())}
                    />
                  </th>
                  <th>User</th>
                  <th>Status</th>
                  {hiddenColumns.includes('joined') ? null : <th>Joined</th>}
                  {hiddenColumns.includes('lastSeen') ? null : <th>Last seen</th>}
                  {hiddenColumns.includes('reports') ? null : <th>Reports</th>}
                  {hiddenColumns.includes('security') ? null : <th>Security</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((user) => (
                  <tr key={user.id} onClick={() => navigate(`/admin/users/${user.id}`)}>
                    <td className="w-8" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${user.displayName}`}
                        checked={selected.has(user.id)}
                        onChange={(event) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(user.id);
                            else next.delete(user.id);
                            return next;
                          })
                        }
                      />
                    </td>
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
                    {hiddenColumns.includes('joined') ? null : <td className="whitespace-nowrap text-[12px] text-[var(--ad-muted)]">{shortDate(user.createdAt)}</td>}
                    {hiddenColumns.includes('lastSeen') ? null : <td className="whitespace-nowrap text-[12px] text-[var(--ad-muted)]" data-testid="last-seen-cell">{relativeTime(user.lastSeen)}</td>}
                    {hiddenColumns.includes('reports') ? null : <td className="text-[12px] tabular-nums text-[var(--ad-muted)]">{user.reportCount > 0 ? <Chip tone="danger">{user.reportCount} reports</Chip> : '—'}</td>}
                    {hiddenColumns.includes('security') ? null : (
                      <td>
                        {user.twoFactorEnabled ? (
                          <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--ad-success)]">
                            <ShieldCheck className="h-3.5 w-3.5" /> 2FA on
                          </span>
                        ) : (
                          <span className="text-[11.5px] text-[var(--ad-faint)]">2FA off</span>
                        )}
                      </td>
                    )}
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

      {confirmSuspend ? (
        <ConfirmDialog
          title="Suspend the selected accounts?"
          body={`${selected.size} account${selected.size === 1 ? '' : 's'} will be blocked for 7 days and signed out everywhere. Support and AI accounts are skipped automatically. Every action is audited.`}
          confirmLabel="Suspend 7 days"
          danger
          busy={bulkBusy}
          onConfirm={() => void bulkAction('suspend', { days: 7, reason: 'Bulk suspension from the Users table' })}
          onCancel={() => setConfirmSuspend(false)}
        />
      ) : null}
      <Toast message={toast.message} />
    </div>
  );
}
