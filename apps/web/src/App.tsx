import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Moon, Sun, Monitor, MessageCircle, LogOut, Send, Wifi, WifiOff, Users, BookUser, ChevronLeft,
} from 'lucide-react';
import {
  chatPartner,
  chatTitle,
  useRealtime,
  useSession,
  useTheme,
  type Chat,
  type Message,
} from '@chatgram/core';
import { api, realtime } from './lib/api';
import { useRealtimeBridge } from './lib/useRealtime';
import Groups from './pages/Groups';
import Contacts from './pages/Contacts';

type Tab = 'chats' | 'groups' | 'contacts';

/* ------------------------------------------------------------------- login */

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

/* ------------------------------------------------------------------- theme */

function ThemeButton() {
  const { mode, cycle } = useTheme();
  return (
    <button type="button" onClick={cycle} className="btn-ghost !px-2" title={`Theme: ${mode}`}>
      {mode === 'dark' ? <Moon className="h-4 w-4" /> : mode === 'light' ? <Sun className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
    </button>
  );
}

/* --------------------------------------------------------------- composer */

function Composer({ chatId }: { chatId: string }) {
  const [text, setText] = useState('');
  const typingTimer = useRef<number | null>(null);
  const queryClient = useQueryClient();
  const me = useSession((s) => s.user);
  const connected = useRealtime((s) => s.connected);

  const stopTyping = useCallback(() => {
    if (typingTimer.current) {
      window.clearTimeout(typingTimer.current);
      typingTimer.current = null;
    }
    realtime.typingStop(chatId);
  }, [chatId]);

  useEffect(() => () => stopTyping(), [stopTyping]);

  function onChange(value: string) {
    setText(value);
    if (!value.trim()) return;
    realtime.typingStart(chatId);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      realtime.typingStop(chatId);
      typingTimer.current = null;
    }, 1500);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value || !me) return;

    const clientId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: Message = {
      id: clientId,
      clientId,
      chatId,
      senderId: me.id,
      type: 'text',
      content: value,
      sentAt: new Date().toISOString(),
      deliveredTo: [],
      readBy: [],
    };

    queryClient.setQueryData<Message[]>(['messages', chatId], (prev) => [...(prev ?? []), optimistic]);
    setText('');
    stopTyping();

    if (realtime.connected) {
      realtime.sendMessage({ chatId, type: 'text', content: value, clientId });
    } else {
      try {
        const saved = await api.sendMessage({ chatId, type: 'text', content: value, clientId });
        queryClient.setQueryData<Message[]>(['messages', chatId], (prev) =>
          (prev ?? []).map((m) => (m.clientId === clientId ? saved : m)),
        );
      } catch {
        queryClient.setQueryData<Message[]>(['messages', chatId], (prev) =>
          (prev ?? []).map((m) => (m.clientId === clientId ? { ...m, failed: true } : m)),
        );
      }
    }
  }

  return (
    <form onSubmit={send} className="flex items-center gap-2 border-t border-ink-200 p-3 dark:border-white/10">
      <input
        className="field flex-1"
        placeholder={connected ? 'Type a message' : 'Reconnecting…'}
        value={text}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="submit" className="btn-primary !px-3" disabled={!text.trim()}>
        <Send className="h-4 w-4" />
      </button>
    </form>
  );
}

/* -------------------------------------------------------------------- chat */

function ChatWindow({ chat, meId, onBack }: { chat: Chat; meId: string; onBack: () => void }) {
  const typing = useRealtime((s) => s.typing[chat.id] ?? null);
  const online = useRealtime((s) => s.online);
  const connected = useRealtime((s) => s.connected);
  const queryClient = useQueryClient();

  const messages = useQuery<Message[]>({
    queryKey: ['messages', chat.id],
    queryFn: () => api.messages(chat.id),
  });

  useEffect(() => {
    realtime.joinChat(chat.id);
    return () => realtime.leaveChat(chat.id);
  }, [chat.id]);

  useEffect(() => {
    api.markChatRead(chat.id).catch(() => {});
    void queryClient.invalidateQueries({ queryKey: ['chats'] });
  }, [chat.id, queryClient]);

  const partner = chatPartner(chat, meId);
  const isOnline = partner ? (online[partner.id] ?? partner.isOnline ?? false) : false;

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-ink-200 px-4 py-3 dark:border-white/10">
        <button type="button" className="btn-ghost !px-2 lg:hidden" onClick={onBack} title="Back">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white">
          {chatTitle(chat, meId).slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{chatTitle(chat, meId)}</p>
          <p className="truncate text-xs text-ink-500 dark:text-ink-400">
            {typing ? 'typing…' : chat.type === 'group' ? `${chat.participants.length} members` : isOnline ? 'online' : 'offline'}
          </p>
        </div>
        <span className={connected ? 'text-brand-600' : 'text-amber-500'} title={connected ? 'Realtime connected' : 'Reconnecting…'}>
          {connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
        </span>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.isLoading ? <p className="text-sm text-ink-500">Loading messages…</p> : null}
        {messages.data?.length === 0 ? <p className="text-sm text-ink-500">No messages yet — say hello.</p> : null}
        {messages.data?.map((m) => {
          const mine = m.senderId === meId;
          const pending = m.id.startsWith('tmp-');
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                  mine
                    ? 'rounded-br-md bg-brand-600 text-white'
                    : 'rounded-bl-md bg-white text-ink-800 dark:bg-ink-700 dark:text-ink-100'
                } ${m.failed ? 'opacity-60' : ''}`}
              >
                <span className="whitespace-pre-wrap break-words">{m.content}</span>
                <span className={`ml-2 align-bottom text-[10px] ${mine ? 'text-white/70' : 'text-ink-400'}`}>
                  {pending ? '…' : m.failed ? 'failed' : new Date(m.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <Composer chatId={chat.id} />
    </section>
  );
}

/* -------------------------------------------------------------- chat list */

function ChatList({
  meId,
  selectedId,
  onSelect,
}: {
  meId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const online = useRealtime((s) => s.online);
  const chats = useQuery({ queryKey: ['chats'], queryFn: () => api.chats() });

  return (
    <div className="flex-1 overflow-y-auto">
      {chats.isLoading ? <p className="p-4 text-sm text-ink-500">Loading…</p> : null}
      {chats.data?.length === 0 ? <p className="p-4 text-sm text-ink-500">No conversations yet.</p> : null}
      {chats.data?.map((chat) => {
        const partner = chatPartner(chat, meId);
        const isOnline = partner ? (online[partner.id] ?? partner.isOnline ?? false) : false;
        const unread = chat.unreadCount ?? 0;
        return (
          <button
            key={chat.id}
            type="button"
            onClick={() => onSelect(chat.id)}
            className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
              chat.id === selectedId ? 'bg-brand-600/10 dark:bg-white/[.07]' : 'hover:bg-ink-100/70 dark:hover:bg-white/[.04]'
            }`}
          >
            <div className="relative">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white">
                {chatTitle(chat, meId).slice(0, 2).toUpperCase()}
              </div>
              {isOnline ? (
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-ink-900" />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{chatTitle(chat, meId)}</p>
              <p className="truncate text-xs text-ink-500 dark:text-ink-400">{chat.lastMessage?.content ?? 'No messages yet'}</p>
            </div>
            {unread > 0 ? (
              <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-brand-600 px-1.5 text-[11px] font-bold text-white">
                {unread > 99 ? '99+' : unread}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------- shell */

const NAV: { key: Tab; label: string; Icon: typeof MessageCircle }[] = [
  { key: 'chats', label: 'Chats', Icon: MessageCircle },
  { key: 'groups', label: 'Groups', Icon: Users },
  { key: 'contacts', label: 'Contacts', Icon: BookUser },
];

function Shell() {
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const connected = useRealtime((s) => s.connected);
  const [tab, setTab] = useState<Tab>('chats');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useRealtimeBridge();

  const chats = useQuery({ queryKey: ['chats'], queryFn: () => api.chats() });
  const selected = useMemo(
    () => chats.data?.find((c) => c.id === selectedId) ?? null,
    [chats.data, selectedId],
  );

  const meId = user?.id ?? '';

  const openChat = useCallback((chatId: string) => {
    setTab('chats');
    setSelectedId(chatId);
  }, []);

  if (!user) return null;

  return (
    <div className="flex h-full">
      {/* rail */}
      <nav className="hidden w-[76px] shrink-0 flex-col items-center gap-1 border-r border-ink-200 py-4 dark:border-white/10 sm:flex">
        {NAV.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            title={label}
            className={`flex w-14 flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-semibold transition ${
              tab === key
                ? 'bg-brand-600/10 text-brand-700 dark:text-brand-300'
                : 'text-ink-500 hover:bg-ink-100 dark:hover:bg-white/5'
            }`}
          >
            <Icon className="h-5 w-5" />
            {label}
          </button>
        ))}
        <span className="flex-1" />
        <ThemeButton />
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
      </nav>

      {/* content */}
      {tab === 'chats' ? (
        <>
          <aside className="flex w-full shrink-0 flex-col border-r border-ink-200 dark:border-white/10 sm:w-[320px]">
            <header className="flex items-center gap-2 border-b border-ink-200 px-4 py-3 dark:border-white/10">
              <MessageCircle className="h-5 w-5 text-brand-600" />
              <span className="font-bold">Chats</span>
              <span className="flex-1" />
              <span className={connected ? 'text-brand-600' : 'text-amber-500'}>
                {connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
              </span>
            </header>
            <ChatList meId={meId} selectedId={selectedId} onSelect={setSelectedId} />
          </aside>

          {selected ? (
            <ChatWindow chat={selected} meId={meId} onBack={() => setSelectedId(null)} />
          ) : (
            <section className="hidden flex-1 place-items-center px-6 text-center sm:grid">
              <div>
                <MessageCircle className="mx-auto h-12 w-12 text-ink-300 dark:text-ink-600" />
                <h2 className="mt-4 text-lg font-bold">Select a conversation</h2>
                <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">Pick a chat on the left, or start a new one.</p>
              </div>
            </section>
          )}
        </>
      ) : tab === 'groups' ? (
        <Groups onOpenChat={openChat} />
      ) : (
        <Contacts onOpenChat={openChat} />
      )}
    </div>
  );
}

/* --------------------------------------------------------------------- app */

export default function App() {
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const setReady = useSession((s) => s.setReady);

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

  return user ? <Shell /> : <Login />;
}
