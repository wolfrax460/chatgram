import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Moon, Sun, Monitor, MessageCircle, LogOut, Users, BookUser, CircleDashed,
  Settings as SettingsIcon, ChevronDown, X, Search,
} from 'lucide-react';
import {
  chatPartner,
  usePrefs,
  useRealtime,
  useSession,
  useTheme,
  type Chat,
  type Message,
} from '@chatgram/core';
import { api, realtime } from './lib/api';
import { useRealtimeBridge } from './lib/useRealtime';
import { ChatList } from './components/ChatList';
import { ChatHeader } from './components/ChatHeader';
import { MessageBubble } from './components/MessageBubble';
import Composer from './components/Composer';
import Groups from './pages/Groups';
import Contacts from './pages/Contacts';
import Status from './pages/Status';
import SettingsPage from './pages/Settings';
import Auth from './pages/Auth';
import { dateSeparatorLabel, sameDay, statusOf } from './lib/ui';

type Tab = 'chats' | 'status' | 'groups' | 'contacts' | 'settings';

/* --------------------------------------------------------------- favicon */

function setUnreadFavicon(count: number): void {
  const base = '/web/assets/favicon.png';
  const ensureLink = (): HTMLLinkElement => {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    return link;
  };

  if (count <= 0) {
    ensureLink().href = base;
    return;
  }

  const img = new Image();
  img.onload = () => {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, size, size);
    ctx.beginPath();
    ctx.arc(size - 15, 15, 14, 0, Math.PI * 2);
    ctx.fillStyle = '#e5484d';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 19px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(count > 9 ? '9+' : String(count), size - 15, 16);
    ensureLink().href = canvas.toDataURL('image/png');
  };
  img.src = base;
}

/* ------------------------------------------------------------------- chat */

function ChatWindow({ chat, meId, onBack }: { chat: Chat; meId: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const timeFormat = usePrefs((s) => s.timeFormat);
  const typingByChat = useRealtime((s) => s.typing);
  const online = useRealtime((s) => s.online);
  const connected = useRealtime((s) => s.connected);

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; name: string; preview: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inChatSearch, setInChatSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [showJump, setShowJump] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = useQuery<Message[]>({
    queryKey: ['messages', chat.id],
    queryFn: () => api.messages(chat.id),
  });

  useEffect(() => {
    setDraft('');
    setReplyTo(null);
    setInChatSearch('');
    setSearchOpen(false);
  }, [chat.id]);

  useEffect(() => {
    realtime.joinChat(chat.id);
    return () => realtime.leaveChat(chat.id);
  }, [chat.id]);

  useEffect(() => {
    api.markChatRead(chat.id).catch(() => {});
    void queryClient.invalidateQueries({ queryKey: ['chats'] });
  }, [chat.id, queryClient]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [chat.id, messages.data?.length, scrollToBottom]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight > 240);
  }

  const list = messages.data ?? [];
  const partner = chatPartner(chat, meId);
  const participantIds = chat.participants.map((p) => p.id);
  const typing = Boolean(typingByChat[chat.id]);
  const isOnline = partner ? (online[partner.id] ?? partner.isOnline ?? false) : false;

  /** First message I have not read — drives the "New messages" divider. */
  const firstUnreadId = useMemo(() => {
    const index = list.findIndex((m) => m.senderId !== meId && !m.readBy.includes(meId));
    return index > 0 ? list[index]?.id : undefined;
  }, [list, meId]);

  const filtered = inChatSearch.trim()
    ? list.filter((m) => (m.content ?? '').toLowerCase().includes(inChatSearch.trim().toLowerCase()))
    : list;

  async function sendText(text: string) {
    const body = replyTo ? `> ${replyTo.name}: ${replyTo.preview}\n${text}` : text;
    const clientId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: Message = {
      id: clientId,
      clientId,
      chatId: chat.id,
      senderId: meId,
      type: 'text',
      content: body,
      sentAt: new Date().toISOString(),
      deliveredTo: [],
      readBy: [],
      reactions: [],
    };
    queryClient.setQueryData<Message[]>(['messages', chat.id], (prev) => [...(prev ?? []), optimistic]);
    setDraft('');

    if (realtime.connected) {
      realtime.sendMessage({ chatId: chat.id, type: 'text', content: body, clientId });
    } else {
      try {
        const saved = await api.sendMessage({ chatId: chat.id, type: 'text', content: body, clientId });
        queryClient.setQueryData<Message[]>(['messages', chat.id], (prev) =>
          (prev ?? []).map((m) => (m.clientId === clientId ? saved : m)),
        );
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'Could not send');
      }
    }
  }

  async function sendFile(file: File, forced?: 'image' | 'file' | 'audio') {
    if (file.size > 10 * 1024 * 1024) {
      setNotice('That file is larger than 10 MB.');
      return;
    }
    try {
      const uploaded = await api.uploadMedia(file);
      const type =
        forced ??
        (uploaded.mimetype.startsWith('image/')
          ? 'image'
          : uploaded.mimetype.startsWith('video/')
            ? 'video'
            : uploaded.mimetype.startsWith('audio/')
              ? 'audio'
              : 'file');
      const saved = await api.sendMessage({
        chatId: chat.id,
        type,
        mediaUrl: uploaded.url,
        content: type === 'file' ? uploaded.originalname : undefined,
      });
      queryClient.setQueryData<Message[]>(['messages', chat.id], (prev) => [...(prev ?? []), saved]);
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Upload failed');
    }
  }

  function reply(message: Message) {
    setReplyTo({
      id: message.id,
      name: message.senderId === meId ? 'You' : (chatPartner(chat, meId)?.displayName ?? 'Contact'),
      preview: message.content ?? (message.type === 'audio' ? 'Voice message' : message.type),
    });
  }

  async function removeMessage(message: Message, scope: 'me' | 'everyone') {
    const before = queryClient.getQueryData<Message[]>(['messages', chat.id]) ?? [];
    queryClient.setQueryData<Message[]>(['messages', chat.id], (prev) =>
      (prev ?? []).filter((m) => m.id !== message.id),
    );
    try {
      await api.deleteMessage(message.id, scope);
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
    } catch (err) {
      queryClient.setQueryData<Message[]>(['messages', chat.id], before);
      setNotice(err instanceof Error ? err.message : 'Could not delete');
    }
  }

  async function reactTo(message: Message, emoji: string) {
    try {
      const result = await api.reactToMessage(message.id, emoji);
      queryClient.setQueryData<Message[]>(['messages', chat.id], (prev) =>
        (prev ?? []).map((m) => (m.id === result.messageId ? { ...m, reactions: result.reactions } : m)),
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not react');
    }
  }

  function emitTyping(isTyping: boolean) {
    if (isTyping) realtime.typingStart(chat.id);
    else realtime.typingStop(chat.id);
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <ChatHeader
        chat={chat}
        meId={meId}
        partner={partner}
        typing={typing}
        online={isOnline}
        connected={connected}
        timeFormat={timeFormat}
        inChatSearchOpen={searchOpen}
        onToggleSearch={() => {
          setSearchOpen((v) => !v);
          setInChatSearch('');
        }}
        onCall={() => setNotice('Voice calls are still being deployed — coming soon.')}
        menu={{
          onContactInfo: () => setNotice('Contact info is still being deployed — coming soon.'),
          onMute: () => setNotice('Mute is still being deployed — coming soon.'),
          onForward: () => setNotice('Forwarding is still being deployed — coming soon.'),
          onClearChat: async () => {
            try {
              await api.clearChat(chat.id);
              queryClient.setQueryData<Message[]>(['messages', chat.id], []);
              void queryClient.invalidateQueries({ queryKey: ['chats'] });
              setNotice('Chat cleared for you.');
            } catch (err) {
              setNotice(err instanceof Error ? err.message : 'Could not clear chat');
            }
          },
          onBlock: () => setNotice('Blocking is still being deployed — coming soon.'),
        }}
        onBack={onBack}
      />

      {searchOpen ? (
        <div className="relative border-b border-ink-200 px-3 py-2 dark:border-white/10">
          <Search className="pointer-events-none absolute left-6 top-4.5 h-4 w-4 text-ink-500" />
          <input
            className="field pl-9"
            placeholder="Search in chat"
            autoFocus
            value={inChatSearch}
            onChange={(e) => setInChatSearch(e.target.value)}
          />
        </div>
      ) : null}

      <div ref={scrollRef} onScroll={onScroll} className="relative flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[860px] flex-col px-4 py-4">
          {messages.isLoading ? <p className="text-sm text-ink-600 dark:text-ink-300">Loading messages…</p> : null}
          {filtered.length === 0 && !messages.isLoading ? (
            <p className="text-sm text-ink-600 dark:text-ink-300">
              {inChatSearch ? 'No matches in this chat.' : 'No messages yet — say hello.'}
            </p>
          ) : null}

          {filtered.map((message, index) => {
            const prev = filtered[index - 1];
            const next = filtered[index + 1];
            const newDay = !prev || !sameDay(prev.sentAt, message.sentAt);
            const firstInGroup = newDay || prev?.senderId !== message.senderId;
            const lastInGroup =
              !next || next.senderId !== message.senderId || !sameDay(next.sentAt, message.sentAt);

            return (
              <div key={message.id}>
                {newDay ? (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-full bg-ink-200/80 px-3 py-1 text-[11px] font-semibold text-ink-700 dark:bg-white/10 dark:text-ink-200">
                      {dateSeparatorLabel(message.sentAt)}
                    </span>
                  </div>
                ) : null}

                {message.id === firstUnreadId ? (
                  <div className="my-3 flex items-center gap-3">
                    <span className="h-px flex-1 bg-brand-600/40" />
                    <span className="text-[11px] font-bold uppercase tracking-wide text-brand-600 dark:text-brand-300">
                      New messages
                    </span>
                    <span className="h-px flex-1 bg-brand-600/40" />
                  </div>
                ) : null}

                <MessageBubble
                  message={message}
                  meId={meId}
                  status={statusOf(message, meId, participantIds)}
                  timeFormat={timeFormat}
                  firstInGroup={firstInGroup}
                  lastInGroup={lastInGroup}
                  actions={{ onReply: reply, onDelete: removeMessage, onReact: reactTo }}
                />
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {showJump ? (
          <button
            type="button"
            onClick={scrollToBottom}
            className="sticky bottom-3 left-full mr-4 grid h-10 w-10 place-items-center rounded-full bg-white text-ink-700 shadow-lg ring-1 ring-ink-200 dark:bg-ink-700 dark:text-white dark:ring-white/10"
            title="Scroll to latest"
          >
            <ChevronDown className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      <div className="mx-auto w-full max-w-[860px]">
        <Composer
          chatId={chat.id}
          draft={draft}
          onDraftChange={setDraft}
          onSendText={sendText}
          onSendFile={sendFile}
          onTyping={emitTyping}
          replyTo={replyTo ? { name: replyTo.name, preview: replyTo.preview } : null}
          onCancelReply={() => setReplyTo(null)}
          notice={notice}
          onDismissNotice={() => setNotice(null)}
        />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ shell */

const NAV: { key: Tab; label: string; Icon: typeof MessageCircle }[] = [
  { key: 'chats', label: 'Chats', Icon: MessageCircle },
  { key: 'status', label: 'Status', Icon: CircleDashed },
  { key: 'groups', label: 'Groups', Icon: Users },
  { key: 'contacts', label: 'Contacts', Icon: BookUser },
  { key: 'settings', label: 'Settings', Icon: SettingsIcon },
];

function Shell() {
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const { mode, cycle } = useTheme();
  const timeFormat = usePrefs((s) => s.timeFormat);
  const connected = useRealtime((s) => s.connected);
  const typing = useRealtime((s) => s.typing);
  const online = useRealtime((s) => s.online);

  const [tab, setTab] = useState<Tab>('chats');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

  useRealtimeBridge();

  const chats = useQuery({ queryKey: ['chats'], queryFn: () => api.chats() });
  const selected = useMemo(
    () => chats.data?.find((c) => c.id === selectedId) ?? null,
    [chats.data, selectedId],
  );

  const meId = user?.id ?? '';
  const unreadTotal = useMemo(
    () => (chats.data ?? []).reduce((sum, c) => sum + (c.unreadCount ?? 0), 0),
    [chats.data],
  );

  useEffect(() => {
    document.title = unreadTotal > 0 ? `(${unreadTotal}) Chatgram` : 'Chatgram';
    setUnreadFavicon(unreadTotal);
    // Tell the Electron shell (if we are running inside it) so the taskbar and
    // tray badges stay in sync.
    (window as unknown as { chatgramDesktop?: { setUnread?: (n: number) => void } })
      .chatgramDesktop?.setUnread?.(unreadTotal);
  }, [unreadTotal]);

  const openChat = useCallback((chatId: string) => {
    setTab('chats');
    setSelectedId(chatId);
  }, []);

  if (!user) return null;

  return (
    <div className="flex h-full">
      <nav className="hidden w-[76px] shrink-0 flex-col items-center gap-1 border-r border-ink-200 py-4 dark:border-white/10 sm:flex">
        {NAV.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            title={label}
            aria-label={label}
            className={`flex w-14 flex-col items-center gap-1 rounded-xl py-2 text-[11.5px] font-semibold transition ${
              tab === key
                ? 'bg-brand-600/10 text-brand-700 dark:text-brand-300'
                : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-white/5'
            }`}
          >
            <Icon className="h-5 w-5" />
            {label}
          </button>
        ))}
        <span className="flex-1" />
        <button type="button" onClick={cycle} className="btn-ghost !px-2" title={`Theme: ${mode}`} aria-label="Toggle theme">
          {mode === 'dark' ? <Moon className="h-4 w-4" /> : mode === 'light' ? <Sun className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
        </button>
        <button
          type="button"
          className="btn-ghost !px-2"
          title="Log out"
          aria-label="Log out"
          onClick={() => setConfirmLogout(true)}
        >
          <LogOut className="h-4 w-4" />
        </button>
      </nav>

      {tab === 'chats' ? (
        <>
          <aside
            className={`${selected ? 'hidden lg:flex' : 'flex'} w-full shrink-0 flex-col border-r border-ink-200 dark:border-white/10 sm:w-[330px]`}
          >
            <ChatList
              chats={chats.data ?? []}
              meId={meId}
              selectedId={selectedId}
              typingByChat={typing}
              online={online}
              timeFormat={timeFormat}
              onSelect={setSelectedId}
              onNewChat={() => setTab('contacts')}
            />
          </aside>

          {selected ? (
            <ChatWindow chat={selected} meId={meId} onBack={() => setSelectedId(null)} />
          ) : (
            <section className="hidden flex-1 place-items-center px-6 text-center sm:grid">
              <div>
                <MessageCircle className="mx-auto h-12 w-12 text-ink-300 dark:text-ink-600" />
                <h2 className="mt-4 text-lg font-bold">Select a conversation</h2>
                <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">Pick a chat on the left, or start a new one.</p>
                {!connected ? <p className="mt-2 text-xs font-semibold text-amber-500">Reconnecting…</p> : null}
              </div>
            </section>
          )}
        </>
      ) : tab === 'status' ? (
        <Status />
      ) : tab === 'groups' ? (
        <Groups onOpenChat={openChat} />
      ) : tab === 'contacts' ? (
        <Contacts onOpenChat={openChat} />
      ) : (
        <SettingsPage onOpenSupport={openChat} />
      )}

      {confirmLogout ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-ink-800">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold">Log out?</h3>
              <button type="button" className="btn-ghost !px-2" onClick={() => setConfirmLogout(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-ink-600 dark:text-ink-300">You will need to sign in again to use Chatgram.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setConfirmLogout(false)}>Cancel</button>
              <button
                type="button"
                className="btn-primary"
                onClick={async () => {
                  await api.logout().catch(() => {});
                  setUser(null);
                }}
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------- app */

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

  return user ? <Shell /> : <Auth />;
}
