import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, UserPlus, MessageCircle, BookUser } from 'lucide-react';
import { useSession, type User } from '@chatgram/core';
import { api } from '../lib/api';

/**
 * Address book + directory search.
 *
 * Searching the directory returns people who are not contacts yet; those rows
 * get an "Add" action, existing contacts get "Chat".
 */
export default function Contacts({ onOpenChat }: { onOpenChat: (chatId: string) => void }) {
  const me = useSession((s) => s.user);
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Debounce the directory search so we do not hit the API per keystroke.
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(query.trim()), 320);
    return () => window.clearTimeout(handle);
  }, [query]);

  const contacts = useQuery({ queryKey: ['contacts'], queryFn: () => api.contacts() });

  const search = useQuery({
    queryKey: ['people-search', debounced],
    queryFn: () => api.searchPeople(debounced),
    enabled: debounced.length > 0,
  });

  const add = useMutation({
    mutationFn: (userId: string) => api.addContact(userId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['contacts'] }),
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not add contact'),
  });

  const meId = me?.id ?? '';
  const searching = debounced.length > 0;
  const list: User[] = (searching ? search.data : contacts.data) ?? [];
  const filtered = list.filter((p) => p.id !== meId);

  async function startChat(person: User) {
    setBusyId(person.id);
    setError('');
    try {
      const chat = await api.createDirect(person.id);
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      onOpenChat(chat.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open chat');
    } finally {
      setBusyId(null);
    }
  }

  const loading = searching ? search.isLoading : contacts.isLoading;

  return (
    <div className="mx-auto flex h-full w-full flex-col">
      <header className="border-b border-ink-200 px-4 py-3 dark:border-white/10">
        <div className="flex items-center gap-2">
          <BookUser className="h-5 w-5 text-brand-600" />
          <h2 className="font-bold">Contacts</h2>
        </div>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-400" />
          <input
            className="field pl-9"
            placeholder="Search people by name, email or phone"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </header>

      {error ? <p className="px-4 py-2 text-sm text-rose-500">{error}</p> : null}

      <div className="flex-1 overflow-y-auto">
        {loading ? <p className="p-4 text-sm text-ink-500">Loading…</p> : null}

        {!loading && filtered.length === 0 ? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <BookUser className="mx-auto h-12 w-12 text-ink-300 dark:text-ink-600" />
              <h3 className="mt-4 font-bold">{searching ? 'Nobody found' : 'No contacts yet'}</h3>
              <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
                {searching
                  ? 'Try a different name, email or phone number.'
                  : 'Search the directory above and add the people you want to chat with.'}
              </p>
            </div>
          </div>
        ) : null}

        {filtered.map((person) => (
          <div key={person.id} className="flex items-center gap-3 px-4 py-3 hover:bg-ink-100/70 dark:hover:bg-white/[.04]">
            <div className="relative">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white">
                {person.displayName.slice(0, 2).toUpperCase()}
              </div>
              {person.isOnline ? (
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-ink-900" />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{person.displayName}</p>
              <p className="truncate text-xs text-ink-500 dark:text-ink-400">{person.email || person.phone || ''}</p>
            </div>
            {busyId === person.id ? (
              <span className="text-xs text-ink-400">…</span>
            ) : searching ? (
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => add.mutate(person.id)}
                title="Add to contacts"
              >
                <UserPlus className="h-4 w-4" /> Add
              </button>
            ) : (
              <button type="button" className="btn-primary text-xs" onClick={() => startChat(person)}>
                <MessageCircle className="h-4 w-4" /> Chat
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
