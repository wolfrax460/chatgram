import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Ban, ChevronRight, FolderPlus, MoreVertical, Phone, Search, Trash2, UserPlus, Video,
} from 'lucide-react';
import { useSession } from '@chatgram/core';
import { api } from '../lib/api';
import { useProfilePanel } from '../lib/profilePanel';
import { startCall } from '../lib/calls';
import { avatarGradient, initialsFor } from '../lib/ui';

/**
 * "New chat" panel: replaces the chat-list column, the way WhatsApp Web does.
 *
 * Contains New group, New contact and the alphabetically grouped contact list,
 * plus per-contact actions (message, call, video call, remove, block).
 */
export function NewChatPanel({
  onClose,
  onOpenChat,
  onNewGroup,
}: {
  onClose: () => void;
  onOpenChat: (chatId: string) => void;
  onNewGroup: () => void;
}) {
  const me = useSession((s) => s.user);
  const profilePanel = useProfilePanel();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  // Escape closes the panel (keyboard accessibility).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (addOpen) setAddOpen(false);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, addOpen]);

  const contacts = useQuery({ queryKey: ['contacts'], queryFn: () => api.contacts() });
  const search = useQuery({
    queryKey: ['people-search', debounced],
    queryFn: () => api.searchPeople(debounced),
    enabled: debounced.length >= 2,
    retry: false,
  });
  const blocked = useQuery({ queryKey: ['blocked-users'], queryFn: () => api.blockedUsers() });

  const contactIds = useMemo(() => new Set((contacts.data ?? []).map((c) => c.id)), [contacts.data]);

  const grouped = useMemo(() => {
    const people = [...(contacts.data ?? [])].filter((p) => p.id !== me?.id);
    people.sort((a, b) => a.displayName.localeCompare(b.displayName));
    const groups = new Map<string, typeof people>();
    for (const person of people) {
      const letter = (person.displayName.trim()[0] ?? '#').toUpperCase();
      if (!groups.has(letter)) groups.set(letter, []);
      groups.get(letter)!.push(person);
    }
    return [...groups.entries()];
  }, [contacts.data, me?.id]);

  async function openOrStartChat(peerId: string) {
    setError('');
    try {
      const chat = await api.createDirect(peerId);
      await queryClient.invalidateQueries({ queryKey: ['chats'] });
      onOpenChat(chat.id);
    } catch {
      setError('Could not open that chat.');
    }
  }

  async function call(peerId: string, displayName: string, video: boolean) {
    setError('');
    try {
      const chat = await api.createDirect(peerId);
      await startCall({ chatId: chat.id, title: displayName, isGroup: false }, { video });
    } catch {
      setError('Could not start the call.');
    }
  }

  const addContact = useMutation({
    mutationFn: (userId: string) => api.addContact(userId),
    onSuccess: () => {
      setNotice('Contact added.');
      void queryClient.invalidateQueries({ queryKey: ['contacts'] });
      void queryClient.invalidateQueries({ queryKey: ['people-search', debounced] });
    },
    onError: () => setError('Could not add that contact.'),
  });

  const removeContact = useMutation({
    mutationFn: (userId: string) => api.removeContact(userId),
    onSuccess: () => {
      setMenuFor(null);
      setNotice('Contact removed.');
      void queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: () => setError('Could not remove that contact.'),
  });

  const block = useMutation({
    mutationFn: ({ userId, blocked: isBlocked }: { userId: string; blocked: boolean }) =>
      isBlocked ? api.unblockUser(userId) : api.blockUser(userId),
    onSuccess: () => {
      setMenuFor(null);
      void queryClient.invalidateQueries({ queryKey: ['blocked-users'] });
      void queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: () => setError('Could not update the block.'),
  });

  const blockedIds = new Set((blocked.data ?? []).map((u) => u.id));
  const searchResults = (search.data ?? []).filter((person) => person.id !== me?.id);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col" data-testid="new-chat-panel">
      <header className="flex items-center gap-2 border-b border-ink-200 px-2 py-2.5 dark:border-white/10">
        <button type="button" className="btn-ghost !px-2" onClick={onClose} aria-label="Back to chats">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="font-semibold">New chat</h2>
      </header>

      <div className="border-b border-ink-200 px-3 py-2 dark:border-white/10">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-500 dark:text-ink-400" />
          <input
            autoFocus
            className="field pl-9"
            placeholder="Search name or number"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search name or number"
            data-testid="new-chat-search"
          />
        </div>
      </div>

      {error ? <p className="px-4 py-2 text-[12.5px] text-rose-600 dark:text-rose-400">{error}</p> : null}
      {notice ? <p className="px-4 py-2 text-[12.5px] text-emerald-600 dark:text-emerald-400">{notice}</p> : null}

      <div className="flex-1 overflow-y-auto">
        {/* directory search results take over while typing */}
        {debounced.length >= 2 ? (
          <div>
            <p className="px-4 pt-3 text-[11px] font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">
              Search results
            </p>
            {search.isLoading ? <p className="p-3 text-sm text-ink-500">Searching…</p> : null}
            {searchResults.map((person) => (
              <div
                key={person.id}
                className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-ink-100/70 dark:hover:bg-white/[.04]"
                onClick={() => void openOrStartChat(person.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    void openOrStartChat(person.id);
                  }
                }}
              >
                <span className={`grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br ${avatarGradient(person.id)} text-xs font-bold text-white`}>
                  {person.avatarUrl ? <img src={person.avatarUrl} alt="" className="h-full w-full object-cover" /> : initialsFor(person.displayName)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{person.displayName}</span>
                  <span className="block truncate text-[11.5px] text-ink-500 dark:text-ink-300">{person.about || 'on Chatgram'}</span>
                </span>
                {contactIds.has(person.id) ? (
                  <button
                    type="button"
                    className="btn-ghost !px-2 text-[12px]"
                    onClick={(event) => {
                      event.stopPropagation();
                      void openOrStartChat(person.id);
                    }}
                  >
                    Message
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-primary !h-8 !px-3 !text-[12px]"
                    onClick={(event) => {
                      event.stopPropagation();
                      addContact.mutate(person.id);
                    }}
                  >
                    Add
                  </button>
                )}
              </div>
            ))}
            {!search.isLoading && searchResults.length === 0 ? (
              <p className="p-3 text-sm text-ink-500">No one found for “{debounced}”.</p>
            ) : null}
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={onNewGroup}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink-100/70 dark:hover:bg-white/[.04]"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 text-white">
                <FolderPlus className="h-5 w-5" />
              </span>
              <span className="font-medium">New group</span>
            </button>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink-100/70 dark:hover:bg-white/[.04]"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 text-white">
                <UserPlus className="h-5 w-5" />
              </span>
              <span className="font-medium">New contact</span>
            </button>

            <p className="px-4 pt-3 text-[11px] font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">
              Contacts on Chatgram
            </p>
            {contacts.isLoading ? <p className="p-3 text-sm text-ink-500">Loading contacts…</p> : null}
            {!contacts.isLoading && grouped.length === 0 ? (
              <p className="p-4 text-sm text-ink-500 dark:text-ink-300">
                No contacts yet. Use New contact or search above to find people.
              </p>
            ) : null}

            {grouped.map(([letter, people]) => (
              <div key={letter}>
                <p className="sticky top-0 z-10 bg-white/95 px-4 py-1 text-[11px] font-bold text-brand-600 backdrop-blur dark:bg-ink-800/95 dark:text-brand-300">
                  {letter}
                </p>
                {people.map((person) => (
                  <div key={person.id} className="relative flex items-center gap-3 px-3 py-2 hover:bg-ink-100/70 dark:hover:bg-white/[.04]">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() => void openOrStartChat(person.id)}
                      aria-label={`Chat with ${person.displayName}`}
                    >
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Open ${person.displayName}'s profile`}
                        title="Open profile"
                        onClick={(event) => {
                          event.stopPropagation();
                          profilePanel.openProfile(person.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            profilePanel.openProfile(person.id);
                          }
                        }}
                        className={`grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br ${avatarGradient(person.id)} text-xs font-bold text-white`}
                      >
                        {person.avatarUrl ? <img src={person.avatarUrl} alt="" className="h-full w-full object-cover" /> : initialsFor(person.displayName)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{person.displayName}</span>
                        <span className="block truncate text-[11.5px] text-ink-500 dark:text-ink-300">
                          {person.about || 'Hey there! I am using Chatgram.'}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="btn-ghost !px-2"
                      aria-label={`More actions for ${person.displayName}`}
                      aria-expanded={menuFor === person.id}
                      onClick={() => setMenuFor(menuFor === person.id ? null : person.id)}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                    {menuFor === person.id ? (
                      <div className="absolute right-2 top-12 z-30 w-48 overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-ink-700">
                        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-100 dark:hover:bg-white/10" onClick={() => void openOrStartChat(person.id)}>
                          <ChevronRight className="h-4 w-4" /> Message
                        </button>
                        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-100 dark:hover:bg-white/10" onClick={() => void call(person.id, person.displayName, false)}>
                          <Phone className="h-4 w-4" /> Voice call
                        </button>
                        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-100 dark:hover:bg-white/10" onClick={() => void call(person.id, person.displayName, true)}>
                          <Video className="h-4 w-4" /> Video call
                        </button>
                        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-ink-100 dark:hover:bg-white/10" onClick={() => removeContact.mutate(person.id)}>
                          <Trash2 className="h-4 w-4" /> Remove contact
                        </button>
                        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-ink-100 dark:hover:bg-white/10" onClick={() => block.mutate({ userId: person.id, blocked: blockedIds.has(person.id) })}>
                          <Ban className="h-4 w-4" /> {blockedIds.has(person.id) ? 'Unblock' : 'Block'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>

      {/* new contact modal (directory search, reuses the add-contact backend) */}
      {addOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setAddOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-2xl dark:bg-ink-800" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="New contact">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-bold">New contact</h3>
              <button type="button" className="btn-ghost !px-2" onClick={() => setAddOpen(false)} aria-label="Close">
                <ArrowLeft className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-2 text-[12.5px] text-ink-500 dark:text-ink-300">
              Search Chatgram by name, email or phone, then add them to your contacts.
            </p>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-500" />
              <input
                autoFocus
                className="field pl-9"
                placeholder="Name, email or phone"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search people to add"
              />
            </div>
            <div className="mt-2 max-h-64 overflow-y-auto">
              {searchResults.map((person) => (
                <div key={person.id} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm">{person.displayName}</span>
                  {contactIds.has(person.id) ? (
                    <span className="text-[11.5px] text-ink-500">Already a contact</span>
                  ) : (
                    <button type="button" className="btn-primary !h-8 !px-3 !text-[12px]" onClick={() => addContact.mutate(person.id)}>
                      Add
                    </button>
                  )}
                </div>
              ))}
              {debounced.length >= 2 && searchResults.length === 0 && !search.isLoading ? (
                <p className="py-2 text-sm text-ink-500">No one found. Check the spelling, or invite them to Chatgram.</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
