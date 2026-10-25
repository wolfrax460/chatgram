import { useCallback, useEffect, useState } from 'react';
import { Download, FileJson, Search, Trash2, UserRound, XCircle } from 'lucide-react';
import { adminFetch, relativeTime, type AdminSessionInfo } from './api';
import { Chip, ConfirmDialog, EmptyState, PageHead, Select, Skeleton, Toast, useToast } from './ui';

type DataRequest = {
  id: string;
  type: 'export' | 'delete';
  status: 'pending' | 'scheduled' | 'completed' | 'cancelled' | 'failed';
  user: { id: string; label: string };
  reason: string;
  scheduledFor: string | null;
  completedAt: string | null;
  error: string;
  exportBytes: number;
  createdAt: string;
};
type ListPayload = { requests: DataRequest[]; total: number; page: number; limit: number; pageCount: number };
type UserRow = { id: string; displayName: string; email: string };

const STATUS_TABS = [
  ['', 'All'],
  ['pending', 'Pending'],
  ['scheduled', 'Scheduled'],
  ['completed', 'Completed'],
  ['cancelled', 'Cancelled'],
] as const;

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'export', label: 'Exports' },
  { value: 'delete', label: 'Deletions' },
];

function statusTone(status: DataRequest['status']) {
  if (status === 'completed') return 'success' as const;
  if (status === 'scheduled') return 'warning' as const;
  if (status === 'cancelled' || status === 'failed') return 'danger' as const;
  return 'accent' as const;
}

/** Data requests: tracked export/delete flows for one user, with a grace option. */
export default function DataRequestsPage({ session }: { session: AdminSessionInfo }) {
  const toast = useToast();
  const [payload, setPayload] = useState<ListPayload | null>(null);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<UserRow[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [newType, setNewType] = useState<'export' | 'delete'>('export');
  const [reason, setReason] = useState('');
  const [graceDays, setGraceDays] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingAction, setPendingAction] = useState<{ request: DataRequest; action: 'process' | 'cancel' } | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setPayload(
        await adminFetch<ListPayload>(
          `/api/admin/data-requests?status=${status}&type=${type}&page=${page}&limit=20`,
        ),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the data requests.');
    }
  }, [page, status, type]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (search.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const data = await adminFetch<{ users: UserRow[] }>(`/api/admin/users?search=${encodeURIComponent(search)}&limit=8`);
        setResults(data.users || []);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  async function createRequest() {
    if (!selectedUser) {
      setError('Choose a user first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await adminFetch<{ message: string }>('/api/admin/data-requests', {
        method: 'POST',
        csrf: session.csrfToken,
        body: { userId: selectedUser.id, type: newType, reason, graceDays: Number(graceDays) || 0 },
      });
      toast.show(result.message);
      setSelectedUser(null);
      setSearch('');
      setReason('');
      setGraceDays('0');
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create the request.');
    } finally {
      setBusy(false);
    }
  }

  async function runAction(request: DataRequest, action: 'process' | 'cancel') {
    setBusy(true);
    setError('');
    try {
      const path = action === 'process' ? 'process' : 'cancel';
      const body = action === 'process' && request.type === 'delete' ? { confirm: true } : {};
      const result = await adminFetch<{ message: string }>(`/api/admin/data-requests/${request.id}/${path}`, {
        method: 'POST',
        csrf: session.csrfToken,
        body,
      });
      toast.show(result.message);
      setPendingAction(null);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHead
        title="Data requests"
        subtitle={payload ? `${payload.total} request(s) · tracked exports and deletions` : 'Export or delete one user’s data on request'}
      />
      {error ? <p role="alert" className="admin-chip admin-chip-danger mb-3">{error}</p> : null}

      <div className="admin-grid lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="admin-card admin-card-pad">
          <p className="admin-card-title">New request</p>
          <p className="mt-1 text-[11.5px] text-[var(--ad-muted)]">
            Exports produce a downloadable JSON file (profile, contacts, chats, messages, statuses). Deletions remove that user's data and cannot be undone.
          </p>
          <label className="mt-3 block text-[11.5px] font-semibold text-[var(--ad-muted)]">
            Find the user
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ad-faint)]" />
              <input
                className="admin-input admin-input-with-icon"
                placeholder="Search by name, email or phone"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setSelectedUser(null);
                }}
                aria-label="Search users for a data request"
              />
            </div>
          </label>
          {selectedUser ? (
            <p className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--ad-accent)]/40 bg-[var(--ad-accent)]/10 p-2 text-[12px]">
              <UserRound className="h-3.5 w-3.5" />
              <span className="min-w-0 flex-1 truncate">{selectedUser.displayName} · {selectedUser.email || selectedUser.id}</span>
              <button type="button" className="admin-btn admin-btn-sm" onClick={() => setSelectedUser(null)} aria-label="Clear selected user"><XCircle className="h-3.5 w-3.5" /></button>
            </p>
          ) : results.length > 0 ? (
            <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-[var(--ad-border)]">
              {results.map((user) => (
                <li key={user.id}>
                  <button type="button" className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-[var(--ad-sunken)]" onClick={() => { setSelectedUser(user); setResults([]); }}>
                    <span className="min-w-0 flex-1 truncate">{user.displayName}</span>
                    <span className="truncate text-[10.5px] text-[var(--ad-faint)]">{user.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
              Request type
              <div className="mt-1">
                <Select
                  label="Data request type"
                  value={newType}
                  onChange={(value) => setNewType(value as 'export' | 'delete')}
                  options={[
                    { value: 'export', label: 'Export data' },
                    { value: 'delete', label: 'Delete data' },
                  ]}
                />
              </div>
            </label>
            <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
              Grace period (days, delete only)
              <input className="admin-input mt-1" type="number" min={0} max={365} value={graceDays} onChange={(event) => setGraceDays(event.target.value)} />
            </label>
          </div>
          <label className="mt-2 block text-[11.5px] font-semibold text-[var(--ad-muted)]">
            Reason / ticket reference
            <input className="admin-input mt-1" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. GDPR request #123" />
          </label>
          <button type="button" className={`admin-btn mt-3 ${newType === 'delete' ? 'admin-btn-danger' : 'admin-btn-primary'}`} onClick={() => void createRequest()} disabled={busy || !selectedUser}>
            {newType === 'export' ? <FileJson className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />} Create {newType === 'export' ? 'export' : 'deletion'} request
          </button>
        </div>

        <div className="admin-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ad-border)] p-3">
            {STATUS_TABS.map(([key, label]) => (
              <button key={key} type="button" className={`admin-btn admin-btn-sm ${status === key ? 'admin-btn-primary' : ''}`} onClick={() => { setStatus(key); setPage(1); }}>
                {label}
              </button>
            ))}
            <div className="ml-auto w-40">
              <Select label="Request type filter" value={type} options={TYPE_OPTIONS} onChange={(value) => { setType(value); setPage(1); }} />
            </div>
          </div>
          <div className="admin-scroll max-h-[60vh] overflow-y-auto">
            {!payload ? (
              <div className="p-4"><Skeleton lines={5} /></div>
            ) : payload.requests.length === 0 ? (
              <div className="p-3"><EmptyState title="No data requests" body="Create an export or deletion request for a user on the left." icon={<FileJson className="h-6 w-6" />} /></div>
            ) : (
              <table className="admin-table">
                <thead><tr><th>User</th><th>Type</th><th>Status</th><th>Created</th><th /></tr></thead>
                <tbody>
                  {payload.requests.map((request) => (
                    <tr key={request.id} style={{ cursor: 'default' }}>
                      <td>
                        <p className="truncate text-[12.5px] font-semibold">{request.user.label || request.user.id}</p>
                        {request.reason ? <p className="mt-0.5 truncate text-[11px] text-[var(--ad-faint)]">{request.reason}</p> : null}
                      </td>
                      <td><Chip tone={request.type === 'delete' ? 'danger' : 'accent'}>{request.type}</Chip></td>
                      <td>
                        <Chip tone={statusTone(request.status)}>{request.status}</Chip>
                        {request.scheduledFor ? <p className="mt-0.5 text-[10.5px] text-[var(--ad-muted)]">for {relativeTime(request.scheduledFor)}</p> : null}
                        {request.exportBytes ? <p className="mt-0.5 text-[10.5px] text-[var(--ad-faint)]">{Math.max(1, Math.round(request.exportBytes / 1024))} KB</p> : null}
                      </td>
                      <td className="whitespace-nowrap text-[11.5px] text-[var(--ad-muted)]">{relativeTime(request.createdAt)}</td>
                      <td>
                        <span className="flex flex-wrap justify-end gap-1">
                          {request.status === 'pending' || request.status === 'scheduled' ? (
                            <>
                              <button type="button" className={`admin-btn admin-btn-sm ${request.type === 'delete' ? 'admin-btn-danger' : 'admin-btn-primary'}`} onClick={() => setPendingAction({ request, action: 'process' })} disabled={busy}>
                                {request.type === 'export' ? 'Build export' : 'Delete now'}
                              </button>
                              <button type="button" className="admin-btn admin-btn-sm" onClick={() => setPendingAction({ request, action: 'cancel' })} disabled={busy}>Cancel</button>
                            </>
                          ) : null}
                          {request.type === 'export' && request.status === 'completed' ? (
                            <a className="admin-btn admin-btn-sm no-underline" href={`/api/admin/data-requests/${request.id}/download`}>
                              <Download className="h-3.5 w-3.5" /> Download
                            </a>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {payload && payload.pageCount > 1 ? (
            <div className="flex items-center justify-between border-t border-[var(--ad-border)] px-3 py-2">
              <p className="text-[11.5px] text-[var(--ad-muted)]">Page {payload.page} of {payload.pageCount}</p>
              <div className="flex gap-1.5">
                <button type="button" className="admin-btn admin-btn-sm" disabled={payload.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
                <button type="button" className="admin-btn admin-btn-sm" disabled={payload.page >= payload.pageCount} onClick={() => setPage((current) => current + 1)}>Next</button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {pendingAction ? (
        <ConfirmDialog
          title={
            pendingAction.action === 'cancel'
              ? 'Cancel this data request?'
              : pendingAction.request.type === 'delete'
                ? 'Delete this user’s data now?'
                : 'Build this export now?'
          }
          body={
            pendingAction.action === 'cancel'
              ? 'The request is marked cancelled and nothing else happens.'
              : pendingAction.request.type === 'delete'
                ? 'The profile, messages, statuses, contacts and chat memberships are permanently deleted. This cannot be undone and is audited.'
                : 'A JSON export of the profile, contacts, chats, messages and statuses is built for download. This is audited.'
          }
          confirmLabel={
            pendingAction.action === 'cancel'
              ? 'Cancel request'
              : pendingAction.request.type === 'delete'
                ? 'Delete data now'
                : 'Build export'
          }
          danger={pendingAction.action === 'process' && pendingAction.request.type === 'delete'}
          busy={busy}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void runAction(pendingAction.request, pendingAction.action)}
        />
      ) : null}
      <Toast message={toast.message} />
    </div>
  );
}
