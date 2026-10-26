import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check, Copy, Loader2, Link as LinkIcon, Pencil, Plus, Search, Settings2, Shield, ShieldOff,
  Trash2, Users, X, BellOff, Bell, LogOut, FileText, Film, Music, RefreshCw, MessageCircle, Flag,
} from 'lucide-react';
import { chatTitle, useSession, type Chat, type User } from '@chatgram/core';
import { api } from '../lib/api';
import { useProfilePanel } from '../lib/profilePanel';
import { useGroupInfo } from '../lib/groupInfo';
import { onlineNow, usePresenceView } from '../lib/presence';

/* ------------------------------------------------------------ create modal */

function CreateGroupModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();

  const contacts = useQuery({ queryKey: ['contacts'], queryFn: () => api.contacts() });

  const create = useMutation({
    mutationFn: () => api.createGroup(name.trim(), selected, description.trim() || undefined),
    onSuccess: (chat) => {
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      window.localStorage.setItem('chatgram.pendingChat', chat.id);
      onClose();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not create group'),
  });

  const canSubmit = name.trim().length > 0 && selected.length > 0 && !create.isPending;
  const filtered = (contacts.data ?? []).filter((person) =>
    person.displayName.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 animate-fade-up" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-ink-800" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">New group</h3>
          <button type="button" className="btn-ghost !px-2" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error ? (
          <p role="alert" className="mb-3 rounded-xl border border-rose-300/50 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
            {error}
          </p>
        ) : null}

        <label className="label" htmlFor="gname">Group name</label>
        <input id="gname" className="field" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Team chat" />

        <label className="label mt-3" htmlFor="gdesc">Description (optional)</label>
        <input
          id="gdesc"
          className="field"
          maxLength={1024}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this group about?"
        />

        <p className="label mt-4">Members ({selected.length})</p>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-400" />
          <input className="field pl-9" placeholder="Search contacts" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="max-h-52 overflow-y-auto rounded-xl border border-ink-200 dark:border-white/10">
          {contacts.isLoading ? <p className="p-3 text-sm text-ink-500">Loading contacts…</p> : null}
          {contacts.data?.length === 0 ? <p className="p-3 text-sm text-ink-500">No contacts yet.</p> : null}
          {filtered.map((person: User) => {
            const checked = selected.includes(person.id);
            return (
              <button
                key={person.id}
                type="button"
                onClick={() =>
                  setSelected((prev) =>
                    prev.includes(person.id) ? prev.filter((id) => id !== person.id) : [...prev, person.id],
                  )
                }
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-ink-100/70 dark:hover:bg-white/5"
              >
                <span
                  className={`grid h-5 w-5 place-items-center rounded-md border ${
                    checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300 dark:border-white/20'
                  }`}
                >
                  {checked ? <Check className="h-3.5 w-3.5" /> : null}
                </span>
                <span className="truncate text-sm">{person.displayName}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!canSubmit} onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Create group'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- add members modal */

function AddMembersModal({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const contacts = useQuery({ queryKey: ['contacts'], queryFn: () => api.contacts() });
  const members = useQuery({ queryKey: ['group-members', chat.id], queryFn: () => api.getGroupMembers(chat.id) });
  const memberIds = new Set((members.data?.members ?? []).map((m) => m._id));

  const add = useMutation({
    mutationFn: () => api.addParticipants(chat.id, selected),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['group-members', chat.id] });
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
      onClose();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not add members'),
  });

  const candidates = (contacts.data ?? []).filter((person) => !memberIds.has(person.id));

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-ink-800" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">Add members</h3>
        {error ? <p role="alert" className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
        <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-ink-200 dark:border-white/10">
          {candidates.length === 0 ? <p className="p-3 text-sm text-ink-500">Everyone in your contacts is already a member.</p> : null}
          {candidates.map((person) => {
            const checked = selected.includes(person.id);
            return (
              <button
                key={person.id}
                type="button"
                onClick={() =>
                  setSelected((prev) =>
                    prev.includes(person.id) ? prev.filter((id) => id !== person.id) : [...prev, person.id],
                  )
                }
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-ink-100/70 dark:hover:bg-white/5"
              >
                <span
                  className={`grid h-5 w-5 place-items-center rounded-md border ${
                    checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300 dark:border-white/20'
                  }`}
                >
                  {checked ? <Check className="h-3.5 w-3.5" /> : null}
                </span>
                <span className="truncate text-sm">{person.displayName}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={selected.length === 0 || add.isPending} onClick={() => add.mutate()}>
            {add.isPending ? 'Adding…' : `Add ${selected.length || ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- group info */

type GroupTab = 'members' | 'media' | 'settings';

export function GroupInfo({ chat, meId, onClose, onOpenChat }: { chat: Chat; meId: string; onClose: () => void; onOpenChat?: (chatId: string) => void }) {
  const queryClient = useQueryClient();
  const presenceView = usePresenceView();
  const profilePanel = useProfilePanel();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<GroupTab>('members');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(chat.groupName ?? '');
  const [description, setDescription] = useState(chat.description ?? '');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('abuse');
  const [reportDetails, setReportDetails] = useState('');
  const contactsQuery = useQuery({ queryKey: ['contacts'], queryFn: () => api.contacts(), retry: false });
  const photoRef = useRef<HTMLInputElement>(null);

  const changePhoto = useMutation({
    mutationFn: (file: File) => api.uploadGroupAvatar(chat.id, file),
    onSuccess: () => {
      refresh();
      setNotice('Group photo updated.');
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not update the group photo'),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['groups'] });
    void queryClient.invalidateQueries({ queryKey: ['chats'] });
    void queryClient.invalidateQueries({ queryKey: ['group-members', chat.id] });
  };

  const membersQuery = useQuery({
    queryKey: ['group-members', chat.id],
    queryFn: () => api.getGroupMembers(chat.id),
    retry: false,
  });
  const inviteQuery = useQuery({
    queryKey: ['group-invite', chat.id],
    queryFn: () => api.getInvite(chat.id),
    retry: false,
  });
  const mediaQuery = useQuery({
    queryKey: ['group-media', chat.id],
    queryFn: () => api.chatMedia(chat.id),
    enabled: tab === 'media',
  });
  const mutedQuery = useQuery({ queryKey: ['muted-chats'], queryFn: () => api.mutedChats() });

  useEffect(() => {
    setName(chat.groupName ?? '');
    setDescription(chat.description ?? '');
  }, [chat.groupName, chat.description]);

  type Member = {
    _id: string;
    displayName: string;
    avatarUrl?: string;
    isAdmin: boolean;
    isYou: boolean;
    isOnline?: boolean;
    about?: string;
  };
  const members: Member[] =
    membersQuery.data?.members ??
    (chat.participants ?? []).map((p) => ({
      _id: p.id,
      displayName: p.displayName,
      isAdmin: (chat.admins ?? []).includes(p.id),
      isYou: p.id === meId,
    }));
  const iAmAdmin = members.find((m) => m.isYou)?.isAdmin ?? (chat.admins ?? []).includes(meId);
  const group = membersQuery.data?.group;
  const ownerId = String(
    (group as { createdBy?: { _id?: string; id?: string } })?.createdBy?._id ||
      (group as { createdBy?: { _id?: string; id?: string } })?.createdBy?.id ||
      (chat as { groupCreatedBy?: string }).groupCreatedBy ||
      '',
  );
  const contactIds = useMemo(
    () => new Set((contactsQuery.data ?? []).map((person: User) => person.id)),
    [contactsQuery.data],
  );
  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      const rank = (m: Member) => (String(m._id) === ownerId ? 0 : m.isAdmin ? 1 : 2);
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
    });
  }, [members, ownerId]);
  const settings = group?.settings ?? chat.settings ?? {
    whoCanEditInfo: 'all',
    whoCanSendMessages: 'all',
    whoCanAddMembers: 'admins',
    requireApproval: false,
    aiMentions: false,
  };
  const muted = (mutedQuery.data ?? []).some((entry) => entry.chatId === chat.id);

  const remove = useMutation({
    mutationFn: (userId: string) => api.removeParticipant(chat.id, userId),
    onSuccess: refresh,
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not remove member'),
  });

  const leave = useMutation({
    mutationFn: () => api.leaveGroup(chat.id),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not leave the group'),
  });

  const toggleAdmin = useMutation({
    mutationFn: ({ userId, makeAdmin }: { userId: string; makeAdmin: boolean }) =>
      api.setGroupAdmin(chat.id, userId, makeAdmin),
    onSuccess: () => {
      refresh();
      setNotice('Admin rights updated.');
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not change admin'),
  });

  const saveGroup = useMutation({
    mutationFn: () =>
      api.updateGroup(chat.id, { groupName: name.trim(), groupDescription: description.trim() }),
    onSuccess: () => {
      refresh();
      setEditing(false);
      setNotice('Group info updated.');
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not save the group'),
  });

  const saveSettings = useMutation({
    mutationFn: (patch: Partial<typeof settings>) => api.updateGroup(chat.id, { groupSettings: patch }),
    onSuccess: () => {
      refresh();
      setNotice('Group permissions saved.');
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not save permissions'),
  });

  const joinRequestsQuery = useQuery({
    queryKey: ['join-requests', chat.id],
    queryFn: () => api.joinRequests(chat.id),
    enabled: tab === 'members',
    retry: false,
    // Always fetch when the members tab opens: a request may have arrived while
    // the admin was on another tab.
    staleTime: 0,
  });
  const respondJoin = useMutation({
    mutationFn: ({ userId, approve }: { userId: string; approve: boolean }) =>
      api.respondJoinRequest(chat.id, userId, approve),
    onSuccess: (_result, variables) => {
      setNotice(variables.approve ? 'Member approved.' : 'Join request declined.');
      void queryClient.invalidateQueries({ queryKey: ['join-requests', chat.id] });
      refresh();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not respond to the request'),
  });

  const createInvite = useMutation({
    mutationFn: () => api.createInvite(chat.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['group-invite', chat.id] });
      setNotice('Invite link ready. Copy and share it.');
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not create the invite link'),
  });

  const revokeInvite = useMutation({
    mutationFn: () => api.revokeInvite(chat.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['group-invite', chat.id] });
      setNotice('Invite link revoked.');
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not revoke the invite link'),
  });

  const toggleMute = useMutation({
    mutationFn: () => (muted ? api.unmuteChat(chat.id) : api.muteChat(chat.id)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['muted-chats'] });
      setNotice(muted ? 'Notifications unmuted.' : 'Notifications muted.');
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not change the mute setting'),
  });

  const visibleMembers = sortedMembers.filter((m) =>
    m.displayName.toLowerCase().includes(search.trim().toLowerCase()),
  );

  async function copyInvite() {
    const token = inviteQuery.data?.token;
    if (!token) return;
    const url = `${window.location.origin}/web/join/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy. Long-press the link to copy it manually.');
    }
  }

  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-l border-ink-200 bg-white shadow-2xl dark:border-white/10 dark:bg-ink-800 sm:w-[340px]" data-testid="group-info">
      <header className="flex items-center justify-between border-b border-ink-200 px-4 py-3 dark:border-white/10">
        <h3 className="font-bold">Group info</h3>
        <button type="button" className="btn-ghost !px-2" onClick={onClose} aria-label="Close group info">
          <X className="h-4 w-4" />
        </button>
      </header>

      {error ? <p role="alert" className="px-4 py-2 text-xs text-rose-500">{error}</p> : null}
      {notice ? <p role="status" className="px-4 py-2 text-xs text-emerald-600 dark:text-emerald-400">{notice}</p> : null}

      <div className="border-b border-ink-200 px-4 py-4 text-center dark:border-white/10">
        <div className="relative mx-auto h-20 w-20">
          <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-2xl font-bold text-white">
            {group?.avatarUrl || chat.groupAvatarUrl ? (
              <img src={group?.avatarUrl || chat.groupAvatarUrl} alt={chatTitle(chat, meId)} className="h-full w-full object-cover" data-testid="group-photo" />
            ) : (
              chatTitle(chat, meId).slice(0, 2).toUpperCase()
            )}
          </div>
          {iAmAdmin || settings.whoCanEditInfo === 'all' ? (
            <>
              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                className="hidden"
                data-testid="group-photo-input"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) changePhoto.mutate(file);
                }}
              />
              <button
                type="button"
                onClick={() => photoRef.current?.click()}
                disabled={changePhoto.isPending}
                title="Change group photo"
                aria-label="Change group photo"
                className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-brand-600 text-white shadow dark:border-ink-900"
              >
                {changePhoto.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
              </button>
            </>
          ) : null}
        </div>
        <h4 className="mt-2 text-lg font-bold">{group?.name ?? chatTitle(chat, meId)}</h4>
        <p className="text-[12px] text-ink-500 dark:text-ink-400">
          {members.length} member{members.length === 1 ? '' : 's'}
          {group?.createdBy ? ` · created by ${group.createdBy.displayName}` : ''}
          {group?.createdAt ? ` · ${new Date(group.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
        </p>
        {group?.description ? (
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink-600 dark:text-ink-300">{group.description}</p>
        ) : null}
        <div className="mt-3 flex justify-center gap-2">
          <button type="button" className="btn-ghost !py-1.5 text-[12px]" onClick={() => toggleMute.mutate()}>
            {muted ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />} {muted ? 'Unmute' : 'Mute'}
          </button>
          {editing ? null : (
            <button type="button" className="btn-ghost !py-1.5 text-[12px]" onClick={() => setEditing(true)}>
              <Settings2 className="h-4 w-4" /> Edit
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="border-b border-ink-200 px-4 py-3 dark:border-white/10">
          <label className="label" htmlFor="group-name">Group name</label>
          <input id="group-name" className="field" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          <label className="label mt-2" htmlFor="group-description">Description</label>
          <textarea
            id="group-description"
            className="field resize-none"
            rows={3}
            maxLength={1024}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn-primary !py-1.5 text-[12px]" disabled={!name.trim() || saveGroup.isPending} onClick={() => saveGroup.mutate()}>
              {saveGroup.isPending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn-ghost !py-1.5 text-[12px]" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : null}

      <div className="flex border-b border-ink-200 text-[12.5px] font-semibold dark:border-white/10">
        {(['members', 'media', 'settings'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 py-2 capitalize ${
              tab === key ? 'border-b-2 border-brand-600 text-brand-700 dark:text-brand-300' : 'text-ink-500 dark:text-ink-400'
            }`}
          >
            {key}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'members' ? (
          <>
            {joinRequestsQuery.data?.requests?.length ? (
              <div className="mx-3 mt-3 rounded-xl border border-amber-300/60 bg-amber-50 p-2 dark:border-amber-500/30 dark:bg-amber-500/10" data-testid="join-requests">
                <p className="px-1 pb-1 text-[12px] font-bold text-amber-800 dark:text-amber-200">
                  Join requests ({joinRequestsQuery.data.requests.length})
                </p>
                {joinRequestsQuery.data.requests.map((request) => (
                  <div key={request.user.id} className="flex items-center gap-2 px-1 py-1">
                    <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-600 text-[10px] font-bold text-white">
                      {request.user.avatarUrl ? (
                        <img src={request.user.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        request.user.displayName.slice(0, 2).toUpperCase()
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{request.user.displayName}</span>
                    <button
                      type="button"
                      className="btn-primary !px-2 !py-1 text-[11.5px]"
                      disabled={respondJoin.isPending}
                      onClick={() => respondJoin.mutate({ userId: request.user.id, approve: true })}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="btn-ghost !px-2 !py-1 text-[11.5px]"
                      disabled={respondJoin.isPending}
                      onClick={() => respondJoin.mutate({ userId: request.user.id, approve: false })}
                    >
                      Decline
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {iAmAdmin || settings.whoCanAddMembers === 'all' ? (
              <div className="px-3 pt-3">
                <button type="button" className="btn-primary w-full !py-1.5 text-[12px]" onClick={() => setAdding(true)}>
                  <Plus className="h-4 w-4" /> Add members
                </button>
              </div>
            ) : null}
            <div className="relative px-3 py-2">
              <Search className="pointer-events-none absolute left-6 top-4 h-4 w-4 text-ink-400" />
              <input className="field pl-9" placeholder="Search members" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {membersQuery.isLoading ? <p className="px-4 text-xs text-ink-500">Loading members…</p> : null}
            {visibleMembers.map((person) => {
              const personIsAdmin = person.isAdmin;
              const isMe = person.isYou;
              return (
                <div key={person._id} className="flex items-center gap-1 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => profilePanel.openProfile(person._id, chat.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-ink-100 dark:hover:bg-white/5"
                    title={`Open ${person.displayName}'s profile`}
                  >
                    <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-[11px] font-bold text-white">
                      {person.avatarUrl ? (
                        <img src={person.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        person.displayName.slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold">
                        <span className="truncate">{person.displayName}</span>
                        {isMe ? <span className="shrink-0 text-[10.5px] font-medium text-ink-500 dark:text-ink-400">You</span> : null}
                        {String(person._id) === ownerId ? (
                          <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9.5px] font-bold uppercase text-amber-700 dark:text-amber-300" data-testid="owner-badge">Owner</span>
                        ) : personIsAdmin ? (
                          <span className="shrink-0 rounded bg-brand-600/10 px-1.5 py-0.5 text-[9.5px] font-bold uppercase text-brand-700 dark:text-brand-300">Admin</span>
                        ) : null}
                        {contactIds.has(String(person._id)) && !isMe ? (
                          <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-700 dark:text-emerald-300" data-testid="member-is-contact">Contact</span>
                        ) : null}
                      </p>
                      <p className="truncate text-[11px] text-ink-500 dark:text-ink-400">
                        {person.about?.trim() || (personIsAdmin ? 'Admin' : 'Member')}
                        {onlineNow(presenceView, person._id, person.isOnline) ? ' · online' : ''}
                      </p>
                    </div>
                  </button>
                  {iAmAdmin && !isMe ? (
                    <>
                      <button
                        type="button"
                        className="btn-ghost !px-1.5"
                        title="Message"
                        aria-label={`Message ${person.displayName}`}
                        onClick={async () => {
                          try {
                            const direct = await api.createDirect(person._id);
                            onOpenChat?.(direct.id);
                            onClose();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Could not open a chat');
                          }
                        }}
                      >
                        <MessageCircle className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="btn-ghost !px-1.5"
                        title={personIsAdmin ? 'Remove admin' : 'Make admin'}
                        onClick={() => toggleAdmin.mutate({ userId: person._id, makeAdmin: !personIsAdmin })}
                      >
                        {personIsAdmin ? <ShieldOff className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost !px-1.5 text-rose-500"
                        title="Remove from group"
                        onClick={() => remove.mutate(person._id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  ) : null}
                </div>
              );
            })}
          </>
        ) : null}

        {tab === 'media' ? (
          <div className="p-3">
            {mediaQuery.isLoading ? <p className="text-xs text-ink-500">Loading shared media…</p> : null}
            {mediaQuery.data && mediaQuery.data.media.length === 0 && mediaQuery.data.links.length === 0 ? (
              <p className="text-xs text-ink-500 dark:text-ink-400">No shared media, files or links in this group yet.</p>
            ) : null}
            {mediaQuery.data && mediaQuery.data.media.length > 0 ? (
              <>
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">Media</p>
                <div className="grid grid-cols-4 gap-1">
                  {mediaQuery.data.media.map((item) => (
                    <a
                      key={item.messageId}
                      href={item.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="grid aspect-square place-items-center overflow-hidden rounded-lg bg-ink-100 text-ink-500 dark:bg-white/10 dark:text-ink-300"
                      title={item.name || item.type}
                    >
                      {item.type === 'image' ? (
                        <img src={item.url} alt="" className="h-full w-full object-cover" />
                      ) : item.type === 'video' ? (
                        <Film className="h-5 w-5" />
                      ) : item.type === 'audio' ? (
                        <Music className="h-5 w-5" />
                      ) : (
                        <FileText className="h-5 w-5" />
                      )}
                    </a>
                  ))}
                </div>
              </>
            ) : null}
            {mediaQuery.data && mediaQuery.data.links.length > 0 ? (
              <>
                <p className="mb-1 mt-3 text-[11px] font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">Links</p>
                {mediaQuery.data.links.map((link) => (
                  <a
                    key={`${link.messageId}-${link.url}`}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="block truncate py-1 text-[12.5px] text-brand-600 hover:underline dark:text-brand-300"
                  >
                    {link.url}
                  </a>
                ))}
              </>
            ) : null}
          </div>
        ) : null}

        {tab === 'settings' ? (
          <div className="px-3 py-3">
            {iAmAdmin ? (
              <>
                {([
                  ['whoCanEditInfo', 'Who can edit group info'],
                  ['whoCanSendMessages', 'Who can send messages'],
                  ['whoCanAddMembers', 'Who can add members'],
                ] as const).map(([key, label]) => (
                  <div key={key} className="mb-3">
                    <p className="mb-1 text-[12px] font-semibold">{label}</p>
                    <div className="flex gap-1">
                      {(['all', 'admins'] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          disabled={saveSettings.isPending}
                          onClick={() => saveSettings.mutate({ [key]: value } as Partial<typeof settings>)}
                          className={`flex-1 rounded-lg border px-2 py-1.5 text-[12px] font-semibold ${
                            settings[key] === value
                              ? 'border-brand-600 bg-brand-600/10 text-brand-700 dark:text-brand-300'
                              : 'border-ink-200 text-ink-600 dark:border-white/10 dark:text-ink-300'
                          }`}
                        >
                          {value === 'all' ? 'Everyone' : 'Admins only'}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-ink-200 px-3 py-2 dark:border-white/10">
                  <div>
                    <p className="text-[12px] font-semibold">New members need approval</p>
                    <p className="text-[11px] text-ink-500 dark:text-ink-400">Invite links ask an admin before anyone joins.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.requireApproval === true}
                    aria-label="New members need approval"
                    disabled={saveSettings.isPending}
                    onClick={() => saveSettings.mutate({ requireApproval: !settings.requireApproval })}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                      settings.requireApproval ? 'bg-brand-600' : 'bg-ink-300 dark:bg-white/20'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                        settings.requireApproval ? 'left-[22px]' : 'left-0.5'
                      }`}
                    />
                  </button>
                </div>

                <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-ink-200 px-3 py-2 dark:border-white/10">
                  <div>
                    <p className="text-[12px] font-semibold">Chatgram AI mentions</p>
                    <p className="text-[11px] text-ink-500 dark:text-ink-400">
                      Members can write &quot;@Chatgram AI …&quot; and the assistant answers in this group. Off by default;
                      only mentioning messages are sent to the AI provider.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.aiMentions === true}
                    aria-label="Chatgram AI mentions"
                    data-testid="ai-mentions-toggle"
                    disabled={saveSettings.isPending}
                    onClick={() => saveSettings.mutate({ aiMentions: !settings.aiMentions })}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                      settings.aiMentions ? 'bg-brand-600' : 'bg-ink-300 dark:bg-white/20'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                        settings.aiMentions ? 'left-[22px]' : 'left-0.5'
                      }`}
                    />
                  </button>
                </div>

                <div className="mt-4 border-t border-ink-200 pt-3 dark:border-white/10">
                  <p className="mb-1 flex items-center gap-1 text-[12px] font-semibold">
                    <LinkIcon className="h-3.5 w-3.5" /> Invite link
                  </p>
                  {inviteQuery.data?.inviteEnabled && inviteQuery.data.token ? (
                    <>
                      <p className="truncate rounded bg-ink-100 px-2 py-1 font-mono text-[11px] dark:bg-white/10">
                        /web/join/{inviteQuery.data.token.slice(0, 10)}…
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button type="button" className="btn-ghost !py-1 text-[12px]" onClick={() => void copyInvite()}>
                          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy link'}
                        </button>
                        <button type="button" className="btn-ghost !py-1 text-[12px]" onClick={() => createInvite.mutate()}>
                          <RefreshCw className="h-3.5 w-3.5" /> Reset
                        </button>
                        <button type="button" className="btn-ghost !py-1 text-[12px] text-rose-500" onClick={() => revokeInvite.mutate()}>
                          Revoke
                        </button>
                      </div>
                    </>
                  ) : (
                    <button type="button" className="btn-primary !py-1.5 text-[12px]" onClick={() => createInvite.mutate()}>
                      <LinkIcon className="h-4 w-4" /> Create invite link
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="text-xs text-ink-500 dark:text-ink-400">Only group admins can change these settings.</p>
            )}
          </div>
        ) : null}
      </div>

      <footer className="border-t border-ink-200 p-3 dark:border-white/10">
        {reportOpen ? (
          <div className="mb-3 rounded-xl border border-rose-300/60 bg-rose-50 p-3 text-left dark:border-rose-500/30 dark:bg-rose-500/10">
            <p className="text-[12.5px] font-semibold text-rose-700 dark:text-rose-300">Report this group to the Chatgram team?</p>
            <select className="field mt-2" value={reportReason} onChange={(event) => setReportReason(event.target.value)} aria-label="Report reason">
              <option value="spam">Spam</option>
              <option value="abuse">Abusive content</option>
              <option value="harassment">Harassment</option>
              <option value="impersonation">Impersonation</option>
              <option value="scam">Scam or fraud</option>
              <option value="other">Something else</option>
            </select>
            <textarea className="field mt-2 resize-none" rows={2} maxLength={500} placeholder="Anything else we should know? (optional)" value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="btn-primary !bg-rose-600 !py-1.5 text-[12px]"
                onClick={async () => {
                  try {
                    const result = await api.reportChat(chat.id, reportReason, reportDetails.trim() || undefined);
                    setNotice(`Report sent (${result.reportId}). Our team will review it.`);
                    setReportOpen(false);
                    setReportDetails('');
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Could not send the report');
                  }
                }}
              >
                Send report
              </button>
              <button type="button" className="btn-ghost !py-1.5 text-[12px]" onClick={() => setReportOpen(false)}>Cancel</button>
            </div>
          </div>
        ) : null}
        <div className="mb-2 flex gap-2">
          <button type="button" className="btn-ghost !py-1.5 text-[12px]" onClick={() => setReportOpen(true)} data-testid="report-group">
            <Flag className="h-4 w-4" /> Report group
          </button>
        </div>
        {confirmLeave ? (
          <div className="space-y-2">
            <p className="text-[12.5px] font-semibold text-rose-600 dark:text-rose-400">
              Leave “{chat.groupName ?? 'this group'}”? You will stop receiving its messages.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn h-9 flex-1 bg-rose-600 text-[13px] font-semibold text-white hover:bg-rose-700"
                disabled={leave.isPending}
                onClick={() => leave.mutate()}
              >
                {leave.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Yes, leave
              </button>
              <button type="button" className="btn-ghost h-9 flex-1 text-[13px]" onClick={() => setConfirmLeave(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmLeave(true)}
            className="btn-ghost h-9 w-full text-[13px] font-semibold text-rose-600"
          >
            <LogOut className="h-4 w-4" /> Exit group
          </button>
        )}
      </footer>

      {adding ? <AddMembersModal chat={chat} onClose={() => setAdding(false)} /> : null}
    </aside>
  );
}

/* ------------------------------------------------------------------ groups */

export default function Groups({ onOpenChat: _onOpenChat }: { onOpenChat: (chatId: string) => void }) {
  const me = useSession((s) => s.user);
  const [creating, setCreating] = useState(false);
  const groupInfo = useGroupInfo();
  const [query, setQuery] = useState('');

  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.groups() });
  const meId = me?.id ?? '';

  const visible = (groups.data ?? []).filter((chat) =>
    chatTitle(chat, meId).toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="flex h-full" data-testid="groups-page">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-ink-200 px-4 py-3 dark:border-white/10">
          <Users className="h-5 w-5 text-brand-600" />
          <h2 className="font-bold">Groups</h2>
          <span className="flex-1" />
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New group
          </button>
        </header>

        <div className="relative px-3 py-2">
          <Search className="pointer-events-none absolute left-6 top-4 h-4 w-4 text-ink-400" />
          <input className="field pl-9" placeholder="Search groups" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        <div className="flex-1 overflow-y-auto">
          {groups.isLoading ? <p className="p-4 text-sm text-ink-500">Loading groups…</p> : null}
          {groups.data?.length === 0 ? (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <Users className="mx-auto h-12 w-12 text-ink-300 dark:text-ink-600" />
                <h3 className="mt-4 font-bold">No groups yet</h3>
                <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">Create one to chat with several people at once.</p>
              </div>
            </div>
          ) : null}
          {visible.map((chat) => (
            <div
              key={chat.id}
              className="flex items-center gap-3 px-4 py-3 hover:bg-ink-100/70 dark:hover:bg-white/[.04]"
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white">
                {chat.groupAvatarUrl ? (
                  <img src={chat.groupAvatarUrl} alt={chatTitle(chat, meId)} className="h-full w-full object-cover" />
                ) : (
                  chatTitle(chat, meId).slice(0, 2).toUpperCase()
                )}
              </div>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => groupInfo.openGroupInfo(chat.id)}>
                <p className="truncate font-semibold">{chatTitle(chat, meId)}</p>
                <p className="truncate text-xs text-ink-500 dark:text-ink-400">
                  {chat.participants.length} members · {chat.lastMessage?.content ?? 'No messages yet'}
                </p>
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => groupInfo.openGroupInfo(chat.id)}
              >
                Info
              </button>
            </div>
          ))}
        </div>
      </section>

      {creating ? <CreateGroupModal onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
