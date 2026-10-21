import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Users, X, Check, Trash2, Shield, ShieldOff, Loader2 } from 'lucide-react';
import { chatTitle, useSession, type Chat, type User } from '@chatgram/core';
import { api } from '../lib/api';
import { useProfilePanel } from '../lib/profilePanel';

/* ------------------------------------------------------------ create modal */

function CreateGroupModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  const contacts = useQuery({ queryKey: ['contacts'], queryFn: () => api.contacts() });

  const create = useMutation({
    mutationFn: () => api.createGroup(name.trim(), selected),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      onClose();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not create group'),
  });

  const canSubmit = name.trim().length > 0 && selected.length > 0 && !create.isPending;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 animate-fade-up" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-ink-800" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">New group</h3>
          <button type="button" className="btn-ghost !px-2" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {error ? (
          <p className="mb-3 rounded-xl border border-rose-300/50 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
            {error}
          </p>
        ) : null}

        <label className="label" htmlFor="gname">Group name</label>
        <input id="gname" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Team chat" />

        <p className="label mt-4">Members ({selected.length})</p>
        <div className="max-h-56 overflow-y-auto rounded-xl border border-ink-200 dark:border-white/10">
          {contacts.isLoading ? <p className="p-3 text-sm text-ink-500">Loading contacts…</p> : null}
          {contacts.data?.length === 0 ? <p className="p-3 text-sm text-ink-500">No contacts yet.</p> : null}
          {contacts.data?.map((person: User) => {
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

/* ------------------------------------------------------------- group info */

function GroupInfo({ chat, meId, onClose }: { chat: Chat; meId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const profilePanel = useProfilePanel();
  const [error, setError] = useState('');
  const isAdmin = (chat.admins ?? []).includes(meId);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['groups'] });
    void queryClient.invalidateQueries({ queryKey: ['chats'] });
    void queryClient.invalidateQueries({ queryKey: ['chat', chat.id] });
  };

  const remove = useMutation({
    mutationFn: (userId: string) => api.removeParticipant(chat.id, userId),
    onSuccess: refresh,
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not remove member'),
  });

  // Authoritative roster from the server (chat.participants is often just ids).
  const membersQuery = useQuery({
    queryKey: ['group-members', chat.id],
    queryFn: () => api.getGroupMembers(chat.id),
    retry: false,
  });
  type Member = { _id: string; displayName: string; isAdmin: boolean; isYou: boolean; isOnline?: boolean };
  const members: Member[] =
    membersQuery.data?.members ??
    (chat.participants ?? []).map((p) => ({
      _id: p.id,
      displayName: p.displayName,
      isAdmin: (chat.admins ?? []).includes(p.id),
      isYou: p.id === meId,
    }));
  const iAmAdmin = members.find((m) => m.isYou)?.isAdmin ?? isAdmin;

  const [confirmLeave, setConfirmLeave] = useState(false);
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
    onSuccess: refresh,
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not change admin'),
  });

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-ink-200 dark:border-white/10">
      <header className="flex items-center justify-between border-b border-ink-200 px-4 py-3 dark:border-white/10">
        <h3 className="font-bold">Group info</h3>
        <button type="button" className="btn-ghost !px-2" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </header>

      {error ? <p className="px-4 py-2 text-xs text-rose-500">{error}</p> : null}

      <div className="flex-1 overflow-y-auto">
        <p className="px-4 pt-4 text-[11px] font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">
          {members.length} members
        </p>
        {members.map((person) => {
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
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-[11px] font-bold text-white">
                  {person.displayName.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {person.displayName}
                    {isMe ? ' (you)' : ''}
                  </p>
                  {personIsAdmin ? (
                    <p className="text-[11px] font-semibold text-brand-600 dark:text-brand-300">admin</p>
                  ) : null}
                </div>
              </button>
              {iAmAdmin && !isMe ? (
                <>
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
      </div>

      {/* Leave group — with confirmation, since it cannot be undone */}
      <footer className="border-t border-ink-200 p-3 dark:border-white/10">
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
            Leave group
          </button>
        )}
      </footer>
    </aside>
  );
}

/* ------------------------------------------------------------------ groups */

export default function Groups({ onOpenChat }: { onOpenChat: (chatId: string) => void }) {
  const me = useSession((s) => s.user);
  const [creating, setCreating] = useState(false);
  const [infoFor, setInfoFor] = useState<Chat | null>(null);

  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.groups() });
  const meId = me?.id ?? '';

  // Keep the info panel in sync after mutations refresh the list.
  const liveInfo = useMemo(
    () => (infoFor ? groups.data?.find((g) => g.id === infoFor.id) ?? infoFor : null),
    [infoFor, groups.data],
  );

  return (
    <div className="flex h-full">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-ink-200 px-4 py-3 dark:border-white/10">
          <Users className="h-5 w-5 text-brand-600" />
          <h2 className="font-bold">Groups</h2>
          <span className="flex-1" />
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New group
          </button>
        </header>

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
          {groups.data?.map((chat) => (
            <div
              key={chat.id}
              className="flex items-center gap-3 px-4 py-3 hover:bg-ink-100/70 dark:hover:bg-white/[.04]"
            >
              <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white">
                {chatTitle(chat, meId).slice(0, 2).toUpperCase()}
              </div>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpenChat(chat.id)}>
                <p className="truncate font-semibold">{chatTitle(chat, meId)}</p>
                <p className="truncate text-xs text-ink-500 dark:text-ink-400">
                  {chat.participants.length} members · {chat.lastMessage?.content ?? 'No messages yet'}
                </p>
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setInfoFor(chat)}
              >
                Info
              </button>
            </div>
          ))}
        </div>
      </section>

      {liveInfo ? (
        <GroupInfo chat={liveInfo} meId={meId} onClose={() => setInfoFor(null)} />
      ) : null}

      {creating ? <CreateGroupModal onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
