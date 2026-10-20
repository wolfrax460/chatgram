import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Avatar, Icon, Spinner, EmptyState, ErrorNote } from '../components/ui.jsx';

/** My address book + directory search, mirroring the Flutter contacts tab. */
export default function Contacts({ meId, onOpenChat }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setContacts((await api.contacts()) || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Debounced directory search.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return undefined;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        setResults((await api.searchPeople(q)) || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setSearching(false);
      }
    }, 320);
    return () => clearTimeout(handle);
  }, [query]);

  async function add(person) {
    setBusyId(person._id || person.id);
    try {
      await api.addContact(person._id || person.id);
      await load();
      setResults((prev) =>
        prev.map((p) =>
          (p._id || p.id) === (person._id || person.id) ? { ...p, isContact: true } : p,
        ),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function startChat(person) {
    setBusyId(person._id || person.id);
    try {
      const chat = await api.createDirect(person._id || person.id);
      onOpenChat(chat?._id || chat?.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const list = query.trim() ? results : contacts;

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col">
      <div className="border-b border-ink-200 px-4 py-3 dark:border-white/10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Contacts</h2>
          <button type="button" className="btn-ghost !px-2" onClick={load} title="Refresh">
            <Icon.refresh className="h-5 w-5" />
          </button>
        </div>
        <div className="relative mt-3">
          <Icon.search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-400" />
          <input
            className="field pl-9"
            placeholder="Search people by name, email or phone"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {searching ? (
            <Spinner className="absolute right-3 top-2.5 h-4 w-4 text-ink-400" />
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error ? <div className="p-3"><ErrorNote onDismiss={() => setError('')}>{error}</ErrorNote></div> : null}

        {loading && !query ? (
          <div className="grid h-40 place-items-center">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={Icon.users}
            title={query ? 'Nobody found' : 'No contacts yet'}
            message={
              query
                ? 'Try a different name, email or phone number.'
                : 'Search the directory above and add the people you want to chat with.'
            }
          />
        ) : (
          list
            .filter((p) => (p._id || p.id) !== meId)
            .map((person) => {
              const id = person._id || person.id;
              const isContact = Boolean(person.isContact) || (!query.trim() && true);
              return (
                <div
                  key={id}
                  className="flex items-center gap-3 px-4 py-3 transition hover:bg-ink-100/70 dark:hover:bg-white/[.04]"
                >
                  <Avatar
                    name={person.displayName}
                    src={person.avatarUrl}
                    size={44}
                    online={Boolean(person.isOnline)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{person.displayName}</div>
                    <div className="truncate text-[13px] text-ink-500 dark:text-ink-400">
                      {person.email || person.phone || ''}
                    </div>
                  </div>
                  {busyId === id ? (
                    <Spinner className="h-5 w-5 text-brand-600" />
                  ) : query.trim() && !isContact ? (
                    <button type="button" className="btn-soft" onClick={() => add(person)}>
                      <Icon.plus className="h-4 w-4" /> Add
                    </button>
                  ) : (
                    <button type="button" className="btn-primary" onClick={() => startChat(person)}>
                      <Icon.chat className="h-4 w-4" /> Chat
                    </button>
                  )}
                </div>
              );
            })
        )}
      </div>
    </div>
  );
}
