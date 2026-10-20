import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Moon, Sun, Monitor, MessageCircle, LogOut, Send } from 'lucide-react';
import { chatTitle, useSession, useTheme, type Chat, type Message } from '@chatgram/core';
import { api } from './lib/api';

/** Auth screen: sign in, then everything else is behind the session store. */
function Login() {
  const setUser = useSession((s) => s.setUser);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { mode, cycle } = useTheme();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api.login(identifier.trim(), password);
      setUser(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full place-items-center px-4">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-600 text-white">
            <MessageCircle className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">Welcome to Chatgram</h1>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">Sign in to continue</p>
          </div>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          {error ? (
            <p className="rounded-xl border border-rose-300/50 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </p>
          ) : null}
          <div>
            <label className="label" htmlFor="id">Email or phone</label>
            <input id="id" className="field" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="pw">Password</label>
            <input id="pw" type="password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="mt-4 flex justify-center">
          <button type="button" onClick={cycle} className="btn-ghost" title={`Theme: ${mode}`}>
            {mode === 'dark' ? <Moon className="h-4 w-4" /> : mode === 'light' ? <Sun className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Chat list + conversation (Phase 2 slices 4 and 5). */
function Chats() {
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const { mode, cycle } = useTheme();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const chats = useQuery({ queryKey: ['chats'], queryFn: () => api.chats() });
  const selected = chats.data?.find((c) => c.id === selectedId) ?? null;

  const messages = useQuery<Message[]>({
    queryKey: ['messages', selectedId],
    queryFn: () => api.messages(selectedId!),
    enabled: Boolean(selectedId),
  });

  const meId = user?.id ?? '';

  if (!user) return null;

  return (
    <div className="flex h-full">
      <aside className="flex w-[340px] shrink-0 flex-col border-r border-ink-200 dark:border-white/10">
        <header className="flex items-center gap-2 border-b border-ink-200 px-4 py-3 dark:border-white/10">
          <MessageCircle className="h-5 w-5 text-brand-600" />
          <span className="font-bold">Chatgram</span>
          <span className="flex-1" />
          <button type="button" onClick={cycle} className="btn-ghost !px-2" title={`Theme: ${mode}`}>
            {mode === 'dark' ? <Moon className="h-4 w-4" /> : mode === 'light' ? <Sun className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
          </button>
          <button
            type="button"
            className="btn-ghost !px-2"
            title="Sign out"
            onClick={async () => {
              await api.logout().catch(() => {});
              setUser(null);
            }}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {chats.isLoading ? <p className="p-4 text-sm text-ink-500">Loading…</p> : null}
          {chats.isError ? <p className="p-4 text-sm text-rose-500">Failed to load chats.</p> : null}
          {chats.data?.length === 0 ? (
            <p className="p-4 text-sm text-ink-500">No conversations yet.</p>
          ) : null}
          {chats.data?.map((chat: Chat) => (
            <button
              key={chat.id}
              type="button"
              onClick={() => setSelectedId(chat.id)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
                chat.id === selectedId
                  ? 'bg-brand-600/10 dark:bg-white/[.07]'
                  : 'hover:bg-ink-100/70 dark:hover:bg-white/[.04]'
              }`}
            >
              <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white">
                {chatTitle(chat, meId).slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{chatTitle(chat, meId)}</p>
                <p className="truncate text-xs text-ink-500 dark:text-ink-400">
                  {chat.lastMessage?.content ?? 'No messages yet'}
                </p>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {!selected ? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <MessageCircle className="mx-auto h-12 w-12 text-ink-300 dark:text-ink-600" />
              <h2 className="mt-4 text-lg font-bold">Select a conversation</h2>
              <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
                Pick a chat on the left, or start a new one.
              </p>
            </div>
          </div>
        ) : (
          <>
            <header className="border-b border-ink-200 px-4 py-3 dark:border-white/10">
              <p className="font-semibold">{chatTitle(selected, meId)}</p>
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {messages.data?.map((m) => {
                const mine = m.senderId === meId;
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                        mine
                          ? 'rounded-br-md bg-brand-600 text-white'
                          : 'rounded-bl-md bg-white text-ink-800 dark:bg-ink-700 dark:text-ink-100'
                      }`}
                    >
                      {m.content}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-2 border-t border-ink-200 p-3 dark:border-white/10">
              <input className="field flex-1" placeholder="Type a message" disabled />
              <button type="button" className="btn-primary !px-3" disabled>
                <Send className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default function App() {
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const setReady = useSession((s) => s.setReady);

  // Restore the session on first load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!api.accessToken) {
        setReady(true);
        return;
      }
      try {
        const me = await api.me();
        if (!cancelled) setUser(me);
      } catch {
        api.clearTokens();
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setUser, setReady]);

  return user ? <Chats /> : <Login />;
}
