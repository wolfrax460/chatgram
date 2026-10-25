import { useCallback, useEffect, useState } from 'react';
import { Crown, Search, Snowflake, Trash2, UserMinus } from 'lucide-react';
import { adminFetch, initials, relativeTime, shortDate, type AdminSessionInfo } from './api';
import { Chip, ConfirmDialog, Drawer, EmptyState, PageHead, Select, Skeleton, Toast, useToast } from './ui';

type GroupRow = {
  id: string;
  name: string;
  avatar: string;
  description: string;
  memberCount: number;
  adminCount: number;
  owner: { id: string; displayName: string; email: string } | null;
  createdAt: string;
  lastActivity: string;
  frozen: boolean;
  aiMentions: boolean;
  reported: number;
};
type GroupList = { groups: GroupRow[]; total: number; page: number; pageCount: number };
type GroupDetail = {
  group: GroupRow;
  messageCount: number;
  members: { id: string; displayName: string; email: string; avatarUrl: string; status: string; isAdmin: boolean; isOwner: boolean }[];
  reports: { id: string; reason: string; status: string; createdAt: string; details: string }[];
};

const FILTERS = [
  ['all', 'All groups'],
  ['frozen', 'Frozen'],
  ['reported', 'Reported'],
] as const;

/** Groups moderation: search, inspect members/reports, freeze, change owner, delete. */
export default function GroupsPage({ session }: { session: AdminSessionInfo }) {
  const toast = useToast();
  const [payload, setPayload] = useState<GroupList | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [newOwner, setNewOwner] = useState('');
  const [confirm, setConfirm] = useState<'freeze' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setPayload(
        await adminFetch<GroupList>(
          `/api/admin/groups?search=${encodeURIComponent(search)}&filter=${filter === 'all' ? '' : filter}&page=${page}&limit=20`,
        ),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the groups.');
    }
  }, [filter, page, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      setDetail(await adminFetch<GroupDetail>(`/api/admin/groups/${id}`));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the group.');
    }
  }, []);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    setDetail(null);
    void loadDetail(selected);
  }, [loadDetail, selected]);

  async function runAction(path: string, method: string, body: unknown, successMessage: string) {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const result = await adminFetch<{ message?: string }>(`/api/admin/groups/${selected}/${path}`, {
        method,
        csrf: session.csrfToken,
        body,
      });
      toast.show(result.message || successMessage);
      await load();
      await loadDetail(selected);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The action failed.');
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function deleteGroup() {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await adminFetch(`/api/admin/groups/${selected}`, { method: 'DELETE', csrf: session.csrfToken });
      toast.show('Group deleted.');
      setSelected(null);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not delete the group.');
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  return (
    <div>
      <PageHead
        title="Groups"
        subtitle={payload ? `${payload.total} group(s) · freeze makes a group read-only for everyone` : 'Every group, its members and moderation state'}
      />
      {error ? <p role="alert" className="admin-chip admin-chip-danger mb-3">{error}</p> : null}

      <div className="admin-card admin-card-pad">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" className={`admin-btn admin-btn-sm ${filter === key ? 'admin-btn-primary' : ''}`} onClick={() => { setFilter(key); setPage(1); }}>
              {label}
            </button>
          ))}
          <div className="relative ml-auto min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ad-faint)]" />
            <input
              className="admin-input admin-input-with-icon"
              placeholder="Search groups by name"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              aria-label="Search groups"
            />
          </div>
        </div>

        <div className="admin-scroll mt-3 max-h-[58vh] overflow-y-auto rounded-xl border border-[var(--ad-border)]">
          {!payload ? (
            <div className="p-4"><Skeleton lines={5} /></div>
          ) : payload.groups.length === 0 ? (
            <div className="p-3"><EmptyState title="No groups found" body="Groups created in Chatgram appear here with their members, owner and reports." /></div>
          ) : (
            <table className="admin-table">
              <thead><tr><th>Group</th><th>Members</th><th>Owner</th><th>State</th><th>Created</th></tr></thead>
              <tbody>
                {payload.groups.map((group) => (
                  <tr key={group.id} onClick={() => { setSelected(group.id); setNewOwner(''); }} aria-selected={selected === group.id} className={selected === group.id ? 'admin-row-active' : undefined}>
                    <td>
                      <p className="flex items-center gap-2 font-semibold">
                        {group.avatar ? <img src={group.avatar} alt="" className="h-6 w-6 rounded-full object-cover" /> : <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--ad-sunken)] text-[10px]">{initials(group.name)}</span>}
                        {group.name}
                      </p>
                      {group.description ? <p className="mt-0.5 truncate text-[11.5px] text-[var(--ad-muted)]">{group.description}</p> : null}
                    </td>
                    <td className="tabular-nums">{group.memberCount}</td>
                    <td className="text-[12px]">{group.owner?.displayName || '—'}</td>
                    <td>
                      <span className="flex flex-wrap gap-1">
                        {group.frozen ? <Chip tone="warning">frozen</Chip> : <Chip>active</Chip>}
                        {group.reported > 0 ? <Chip tone="danger">{group.reported} report(s)</Chip> : null}
                        {group.aiMentions ? <Chip tone="accent">AI mentions</Chip> : null}
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-[11.5px] text-[var(--ad-muted)]">{shortDate(group.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {payload && payload.pageCount > 1 ? (
          <div className="mt-3 flex items-center justify-between">
            <p className="text-[11.5px] text-[var(--ad-muted)]">Page {payload.page} of {payload.pageCount}</p>
            <div className="flex gap-1.5">
              <button type="button" className="admin-btn admin-btn-sm" disabled={payload.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
              <button type="button" className="admin-btn admin-btn-sm" disabled={payload.page >= payload.pageCount} onClick={() => setPage((current) => current + 1)}>Next</button>
            </div>
          </div>
        ) : null}
      </div>

      {selected ? (
        <Drawer title={detail?.group.name || 'Group'} onClose={() => setSelected(null)}>
          {!detail ? (
            <Skeleton lines={6} />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {detail.group.frozen ? <Chip tone="warning">frozen / read-only</Chip> : <Chip tone="success">active</Chip>}
                <Chip>{detail.group.memberCount} members</Chip>
                <Chip>{detail.messageCount} {detail.messageCount === 1 ? 'message' : 'messages'}</Chip>
                {detail.group.reported > 0 ? <Chip tone="danger">{detail.group.reported} open report(s)</Chip> : null}
              </div>
              <p className="text-[12px] text-[var(--ad-muted)]">
                Owner {detail.group.owner?.displayName || '—'} · created {shortDate(detail.group.createdAt)} · last activity {relativeTime(detail.group.lastActivity)}
              </p>

              <div className="rounded-xl border border-[var(--ad-border)] p-3">
                <p className="admin-card-title">Moderation</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`admin-btn admin-btn-sm ${detail.group.frozen ? '' : 'admin-btn-danger'}`}
                    onClick={() => setConfirm('freeze')}
                    disabled={busy}
                  >
                    <Snowflake className="h-3.5 w-3.5" /> {detail.group.frozen ? 'Unfreeze group' : 'Freeze group'}
                  </button>
                  <button type="button" className="admin-btn admin-btn-sm admin-btn-danger" onClick={() => setConfirm('delete')} disabled={busy}>
                    <Trash2 className="h-3.5 w-3.5" /> Delete group
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-[var(--ad-muted)]">
                  A frozen group is read-only for every member (messages are refused with GROUP_FROZEN). Deleting removes the group and its messages; this is audited.
                </p>

                <label className="mt-3 block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                  Change owner
                  <div className="mt-1 flex gap-2">
                    <div className="min-w-0 flex-1">
                      <Select
                        label="New group owner"
                        value={newOwner}
                        onChange={setNewOwner}
                        placeholder="Choose a member…"
                        options={detail.members.map((member) => ({ value: member.id, label: `${member.displayName}${member.isOwner ? ' (owner)' : ''}` }))}
                      />
                    </div>
                    <button type="button" className="admin-btn admin-btn-sm" disabled={busy || !newOwner || newOwner === detail.group.owner?.id} onClick={() => void runAction('owner', 'POST', { userId: newOwner }, 'Owner changed.')}>
                      <Crown className="h-3.5 w-3.5" /> Make owner
                    </button>
                  </div>
                </label>
              </div>

              <div>
                <p className="admin-card-title">Members</p>
                <ul className="mt-2 space-y-1.5">
                  {detail.members.map((member) => (
                    <li key={member.id} className="flex items-center gap-2 rounded-lg border border-[var(--ad-border)] p-2">
                      <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-full bg-[var(--ad-sunken)] text-[10px] font-bold">
                        {member.avatarUrl ? <img src={member.avatarUrl} alt="" className="h-full w-full object-cover" /> : initials(member.displayName)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-semibold">{member.displayName}</span>
                        <span className="block truncate text-[11px] text-[var(--ad-faint)]">{member.email || 'no email'}</span>
                      </span>
                      {member.isOwner ? <Chip tone="accent">owner</Chip> : member.isAdmin ? <Chip>admin</Chip> : null}
                      {member.status !== 'active' ? <Chip tone="danger">{member.status}</Chip> : null}
                      <button
                        type="button"
                        className="admin-btn admin-btn-sm admin-btn-danger"
                        aria-label={`Remove ${member.displayName}`}
                        disabled={busy}
                        onClick={() => void runAction(`members/${member.id}/remove`, 'POST', {}, 'Member removed.')}
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {detail.reports.length > 0 ? (
                <div>
                  <p className="admin-card-title">Related reports</p>
                  <ul className="mt-2 space-y-1.5 text-[12px]">
                    {detail.reports.map((report) => (
                      <li key={report.id} className="rounded-lg border border-[var(--ad-border)] p-2">
                        <p className="flex items-center gap-2"><Chip tone={report.status === 'open' ? 'warning' : 'success'}>{report.status}</Chip> {report.reason}</p>
                        <p className="mt-1 text-[var(--ad-muted)]">{report.details || 'No details'} · {relativeTime(report.createdAt)}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </Drawer>
      ) : null}

      {confirm === 'freeze' && detail ? (
        <ConfirmDialog
          title={detail.group.frozen ? 'Unfreeze this group?' : 'Freeze this group?'}
          body={
            detail.group.frozen
              ? 'Members can send messages again immediately. This is audited.'
              : 'Every member becomes read-only until you unfreeze it. Messages are refused with GROUP_FROZEN. This is audited.'
          }
          confirmLabel={detail.group.frozen ? 'Unfreeze' : 'Freeze group'}
          danger={!detail.group.frozen}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void runAction('freeze', 'POST', { frozen: !detail.group.frozen }, 'Group updated.')}
        />
      ) : null}
      {confirm === 'delete' && detail ? (
        <ConfirmDialog
          title={`Delete "${detail.group.name}"?`}
          body="The group and all of its messages are permanently removed and open reports are closed. This cannot be undone."
          confirmLabel="Delete group"
          danger
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void deleteGroup()}
        />
      ) : null}
      <Toast message={toast.message} />
    </div>
  );
}
