import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Moon, Sun, Monitor, MessageCircle, LogOut, Users, BookUser, CircleDashed,
  Settings as SettingsIcon, ChevronDown, X, Search, LifeBuoy, Sparkles, BadgeCheck,
  UserPlus, Download, Share2, FolderUp, FileText, Camera,
} from 'lucide-react';
import {
  chatPartner,
  chatTitle,
  usePrefs,
  useRealtime,
  useSession,
  useTheme,
  type Chat,
  type Message,
} from '@chatgram/core';
import { api, realtime } from './lib/api';
import { useRealtimeBridge } from './lib/useRealtime';
import { setDoNotDisturb } from './lib/notify';
import { useProfilePanel } from './lib/profilePanel';
import { ChatList } from './components/ChatList';
import { ChatHeader } from './components/ChatHeader';
import { MessageBubble } from './components/MessageBubble';
import Composer from './components/Composer';
import { CallOverlay } from './components/CallOverlay';
import { useIsOnline } from './lib/presence';
import { getCallState, startCall, subscribeCalls } from './lib/calls';
import Groups from './pages/Groups';
import Contacts from './pages/Contacts';
import Status from './pages/Status';
import SettingsPage from './pages/Settings';
import Auth from './pages/Auth';
import SupportWidget from './components/SupportWidget';
import { AiThread } from './components/AiThread';
import { useAiThread } from './lib/aiThread';
import JoinGroup from './pages/JoinGroup';
import { ProfilePanel } from './components/ProfilePanel';
import { ProfilePanelContext, type ProfilePanelApi } from './lib/profilePanel';
import { dateSeparatorLabel, formatTime, sameDay, statusOf } from './lib/ui';

type Tab = 'chats' | 'status' | 'groups' | 'contacts' | 'settings' | 'ai';

/** Item 4: one empty-screen recommendation from GET /api/app/recommendations. */
type AppRecommendation = {
  key: string;
  title: string;
  body: string;
  ctaLabel: string;
  action: 'ai' | 'downloads' | 'profile' | 'invite' | 'url';
  url?: string;
};

// The admin dashboard is its own route tree, loaded lazily so the messaging app
// bundle never carries the dashboard code.
const AdminApp = lazy(() => import('./pages/admin/AdminApp'));

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
  const profilePanel = useProfilePanel();
  const timeFormat = usePrefs((s) => s.timeFormat);
  const typingByChat = useRealtime((s) => s.typing);
  const connected = useRealtime((s) => s.connected);

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; name: string; preview: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inChatSearch, setInChatSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [showJump, setShowJump] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Support-account only: is this conversation attached to a ticket?
  const ticketQuery = useQuery({
    queryKey: ['ticket-by-chat', chat.id],
    queryFn: () => api.getTicketByChat(chat.id),
    staleTime: 60_000,
    retry: false,
  });
  const ticket = ticketQuery.data?.ticket ?? null;

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

  // While this conversation is open and the window is focused, incoming
  // messages must be marked read — otherwise the sender never gets blue ticks.
  useEffect(() => {
    const list = messages.data;
    if (!list || list.length === 0) return undefined;
    if (document.visibilityState !== 'visible') return undefined;
    const hasUnread = list.some((message) => message.senderId !== meId && !message.readBy.includes(meId));
    if (!hasUnread) return undefined;
    const timer = window.setTimeout(() => {
      api
        .markChatRead(chat.id)
        .then(() => queryClient.invalidateQueries({ queryKey: ['messages', chat.id] }))
        .catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [messages.data, meId, chat.id, queryClient]);

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
  // Presence comes from live sockets (never a stale REST snapshot).
  const isOnline = useIsOnline(partner?.id, partner?.isOnline);

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

  // ---- group extras: pinned message, seen-by ---------------------------------
  const [readersFor, setReadersFor] = useState<Message | null>(null);
  const readersQuery = useQuery({
    queryKey: ['readers', readersFor?.id],
    queryFn: () => api.messageReaders(readersFor?.id ?? ''),
    enabled: Boolean(readersFor),
    retry: false,
  });

  const pinnedMessage = list.find((message) => message.id === chat.pinnedMessageId);

  async function pinToGroup(message: Message) {
    try {
      await api.pinMessage(chat.id, message.id);
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      setNotice('Message pinned to this group.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not pin the message');
    }
  }

  async function unpinFromGroup() {
    try {
      await api.unpinMessage(chat.id);
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      setNotice('Pinned message removed.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not unpin the message');
    }
  }

  // ---- edit / star / forward / report ---------------------------------------
  const [forwardFor, setForwardFor] = useState<Message | null>(null);
  const [reportFor, setReportFor] = useState<Message | null>(null);
  const [reportReason, setReportReason] = useState('spam');
  const forwardTargets = useQuery({
    queryKey: ['chats'],
    queryFn: () => api.chats(),
    enabled: Boolean(forwardFor),
  });

  async function editMessage(message: Message, content: string) {
    const before = queryClient.getQueryData<Message[]>(['messages', chat.id]) ?? [];
    queryClient.setQueryData<Message[]>(['messages', chat.id], (prev) =>
      (prev ?? []).map((row) =>
        row.id === message.id ? { ...row, content, editedAt: new Date().toISOString() } : row,
      ),
    );
    try {
      await api.editMessage(message.id, content);
      setNotice('Message edited.');
    } catch (err) {
      queryClient.setQueryData<Message[]>(['messages', chat.id], before);
      setNotice(err instanceof Error ? err.message : 'Could not edit the message');
    }
  }

  async function toggleStar(message: Message) {
    const next = !message.starred;
    try {
      await api.starMessage(message.id, next);
      queryClient.setQueryData<Message[]>(['messages', chat.id], (prev) =>
        (prev ?? []).map((row) => (row.id === message.id ? { ...row, starred: next } : row)),
      );
      setNotice(next ? 'Message starred.' : 'Star removed.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not update the star');
    }
  }

  async function forwardTo(message: Message, targetChatId: string) {
    try {
      await api.forwardMessage(message.id, targetChatId);
      setForwardFor(null);
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      setNotice('Message forwarded.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not forward the message');
    }
  }

  async function reportMessage() {
    if (!reportFor) return;
    try {
      const result = await api.reportMessage(reportFor.id, reportReason);
      setReportFor(null);
      setNotice(`Report sent (${result.reportId}). Our team will review it.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not send the report');
    }
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
        onOpenProfile={partner ? () => profilePanel.openProfile(partner.id, chat.id) : undefined}
        onCall={() => {
          if (chat.participants.length < 2) {
            setNotice('There is nobody else in this chat to call.');
            return;
          }
          void startCall(
            {
              chatId: chat.id,
              title: chat.type === 'group' ? chat.groupName || 'Group call' : partner?.displayName || 'Chat',
              isGroup: chat.type === 'group',
            },
            { video: false },
          );
        }}
        onVideoCall={() => {
          if (chat.participants.length < 2) {
            setNotice('There is nobody else in this chat to call.');
            return;
          }
          void startCall(
            {
              chatId: chat.id,
              title: chat.type === 'group' ? chat.groupName || 'Group call' : partner?.displayName || 'Chat',
              isGroup: chat.type === 'group',
            },
            { video: true },
          );
        }}
        menu={{
          onContactInfo: () => (partner ? profilePanel.openProfile(partner.id, chat.id) : undefined),
          onMute: async () => {
            try {
              await api.muteChat(chat.id);
              setNotice('Notifications muted for this chat.');
            } catch (err) {
              setNotice(err instanceof Error ? err.message : 'Could not mute this chat');
            }
          },
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
          onBlock: () => (partner ? profilePanel.openProfile(partner.id, chat.id) : undefined),
        }}
        onBack={onBack}
      />

      {chat.type === 'group' && chat.pinnedMessageId ? (
        <div className="flex items-center gap-2 border-b border-ink-200 bg-brand-600/5 px-4 py-2 dark:border-white/10 dark:bg-brand-600/10">
          <span className="rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Pinned</span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-700 dark:text-ink-200" data-testid="pinned-message">
            {pinnedMessage?.content || (pinnedMessage ? pinnedMessage.type : 'Pinned message')}
          </span>
          <button
            type="button"
            className="text-[12px] font-semibold text-ink-500 hover:text-rose-500 dark:text-ink-300"
            onClick={() => void unpinFromGroup()}
          >
            Unpin
          </button>
        </div>
      ) : null}

      {ticket ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 bg-amber-50 px-4 py-2 text-[12px] dark:border-white/10 dark:bg-amber-500/10">
          <span className="rounded bg-amber-500 px-1.5 py-0.5 font-bold uppercase tracking-wide text-white">Ticket</span>
          <span className="font-mono font-bold text-amber-800 dark:text-amber-300">{ticket.ticketId}</span>
          <span className="rounded-full border border-amber-400 px-2 py-0.5 font-semibold uppercase text-amber-800 dark:text-amber-300">{ticket.status}</span>
          <span className="flex-1" />
          {ticket.status !== 'closed' ? (
            <button
              type="button"
              className="rounded border border-amber-500 px-2 py-0.5 font-semibold text-amber-800 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/20"
              onClick={async () => {
                try {
                  await api.closeSupportTicket(ticket.ticketId);
                  await ticketQuery.refetch();
                  setNotice('Ticket ' + ticket.ticketId + ' closed.');
                } catch (err) {
                  setNotice(err instanceof Error ? err.message : 'Could not close the ticket');
                }
              }}
            >
              Close ticket
            </button>
          ) : null}
        </div>
      ) : null}
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

      <div ref={scrollRef} onScroll={onScroll} className="no-scrollbar relative flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col px-4 py-4">
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
                  actions={{
                    onReply: reply,
                    onDelete: removeMessage,
                    onReact: reactTo,
                    onOpenProfile: (userId) => profilePanel.openProfile(userId, chat.id),
                    onPin: chat.type === 'group' ? (message) => void pinToGroup(message) : undefined,
                    onSeenBy:
                      message.senderId === meId ? (message) => setReadersFor(message) : undefined,
                    onEdit:
                      message.senderId === meId ? (row, content) => void editMessage(row, content) : undefined,
                    onStar: (row) => void toggleStar(row),
                    onForward: (row) => setForwardFor(row),
                    onReport: (row) => {
                      setReportReason('spam');
                      setReportFor(row);
                    },
                  }}
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

      <div className="mx-auto w-full max-w-[1400px]">
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

      {readersFor ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setReadersFor(null)}>
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-ink-800"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-label="Who has seen this message"
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-bold">Seen by</h3>
              <button type="button" className="btn-ghost !px-2" onClick={() => setReadersFor(null)} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            {readersQuery.isLoading ? <p className="text-sm text-ink-500">Loading…</p> : null}
            {readersQuery.isError ? (
              <p className="text-sm text-rose-600 dark:text-rose-400">Could not load the list.</p>
            ) : null}
            {readersQuery.data && readersQuery.data.readers.length === 0 ? (
              <p className="text-sm text-ink-500 dark:text-ink-300">Nobody has seen this yet.</p>
            ) : null}
            <ul className="max-h-64 overflow-y-auto">
              {(readersQuery.data?.readers ?? []).map((reader) => (
                <li key={reader.id} className="flex items-center gap-2 py-1.5">
                  <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-[10px] font-bold text-white">
                    {reader.avatarUrl ? (
                      <img src={reader.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      reader.displayName.slice(0, 2).toUpperCase()
                    )}
                  </span>
                  <span className="truncate text-sm">{reader.displayName}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {forwardFor ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setForwardFor(null)}>
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-ink-800"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-label="Forward message"
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-bold">Forward to…</h3>
              <button type="button" className="btn-ghost !px-2" onClick={() => setForwardFor(null)} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            {forwardTargets.isLoading ? <p className="text-sm text-ink-500">Loading chats…</p> : null}
            <ul className="max-h-72 overflow-y-auto">
              {(forwardTargets.data ?? []).map((target) => (
                <li key={target.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-ink-100 dark:hover:bg-white/5"
                    onClick={() => void forwardTo(forwardFor, target.id)}
                  >
                    <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-[10px] font-bold text-white">
                      {chatTitle(target, meId).slice(0, 2).toUpperCase()}
                    </span>
                    <span className="truncate text-sm">{chatTitle(target, meId)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {reportFor ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setReportFor(null)}>
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-ink-800"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-label="Report message"
          >
            <h3 className="text-lg font-bold">Report message</h3>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
              Only Chatgram&apos;s moderation team sees your report.
            </p>
            <div className="mt-2 space-y-1">
              {([
                { key: 'spam', label: 'Spam or unwanted messages' },
                { key: 'abuse', label: 'Abusive content' },
                { key: 'harassment', label: 'Harassment' },
                { key: 'impersonation', label: 'Pretending to be someone else' },
                { key: 'scam', label: 'Scam or fraud' },
                { key: 'other', label: 'Something else' },
              ] as const).map((reason) => (
                <label key={reason.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-ink-100 dark:hover:bg-white/5">
                  <input
                    type="radio"
                    name="message-report-reason"
                    value={reason.key}
                    checked={reportReason === reason.key}
                    onChange={() => setReportReason(reason.key)}
                  />
                  {reason.label}
                </label>
              ))}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setReportFor(null)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={() => void reportMessage()}>
                Send report
              </button>
            </div>
          </div>
        </div>
      ) : null}
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

  const [tab, setTab] = useState<Tab>('chats');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [profileTarget, setProfileTarget] = useState<{ userId: string; chatId?: string } | null>(null);
  const callState = useSyncExternalStore(subscribeCalls, getCallState);

  // Chatgram AI thread state (pinned row preview, unread badge).
  const aiUnread = useAiThread((s) => s.unread);
  const aiPreview = useAiThread((s) => s.lastMessage);
  const aiPreviewAt = useAiThread((s) => s.lastAt);
  const [aiPendingQuestion, setAiPendingQuestion] = useState<string | null>(null);

  useRealtimeBridge();
  const queryClient = useQueryClient();

  // Load the user's do-not-disturb schedule; notifications/sounds honour it.
  const notificationPrefs = useQuery({
    queryKey: ['notification-prefs'],
    queryFn: () => api.notificationPrefs(),
    staleTime: 60_000,
  });
  useEffect(() => {
    if (notificationPrefs.data) setDoNotDisturb(notificationPrefs.data);
  }, [notificationPrefs.data]);

  // A group created / joined just before a reload asks to be opened.
  useEffect(() => {
    const pending = window.localStorage.getItem('chatgram.pendingChat');
    if (!pending) return;
    window.localStorage.removeItem('chatgram.pendingChat');
    setTab('chats');
    setSelectedId(pending);
  }, []);

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

  const closeProfile = useCallback(() => setProfileTarget(null), []);
  const profileApi = useMemo<ProfilePanelApi>(
    () => ({
      openProfile: (userId: string, chatId?: string) => setProfileTarget({ userId, chatId }),
      closeProfile,
      activeUserId: profileTarget?.userId ?? null,
    }),
    [closeProfile, profileTarget?.userId],
  );

  // Item 4: the empty-screen recommendation is server-driven (admin editor) and
  // can be dismissed; completed items are already filtered by the API.
  const recommendationsQuery = useQuery({
    queryKey: ['app-recommendations'],
    queryFn: () => api.request<{ recommendations: AppRecommendation[] }>('/api/app/recommendations'),
    staleTime: 60_000,
    retry: false,
  });
  const [dismissingRecommendation, setDismissingRecommendation] = useState(false);
  const [emptyDocument, setEmptyDocument] = useState<File | null>(null);
  const emptyDocRef = useRef<HTMLInputElement>(null);

  function shareInvite() {
    const url = `${window.location.origin}/web/`;
    if (navigator.share) void navigator.share({ title: 'Chatgram', url });
    else void navigator.clipboard?.writeText(url);
  }

  function runRecommendation(rec: AppRecommendation) {
    if (rec.action === 'ai') setTab('ai');
    else if (rec.action === 'downloads') window.open('/docs#downloads', '_blank', 'noopener');
    else if (rec.action === 'profile') setTab('settings');
    else if (rec.action === 'invite') shareInvite();
    else if (rec.url) window.open(rec.url, '_blank', 'noopener');
  }

  async function dismissRecommendation(key: string) {
    setDismissingRecommendation(true);
    try {
      await api.request(`/api/app/recommendations/${encodeURIComponent(key)}/dismiss`, { method: 'POST' });
      await queryClient.invalidateQueries({ queryKey: ['app-recommendations'] });
    } catch {
      // The card simply stays if the dismiss fails.
    } finally {
      setDismissingRecommendation(false);
    }
  }

  async function sendEmptyDocument(chatId: string) {
    if (!emptyDocument) return;
    try {
      const uploaded = await api.uploadMedia(emptyDocument);
      await api.sendMessage({ chatId, type: 'file', mediaUrl: uploaded.url, content: uploaded.originalname });
      setEmptyDocument(null);
      openChat(chatId);
    } catch {
      // Leave the picker open so the user can retry.
    }
  }

  if (!user) return null;

  return (
    <ProfilePanelContext.Provider value={profileApi}>
    <div className="flex h-full">
      <CallOverlay call={callState} />
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
        <span className="my-1 h-px w-9 bg-ink-200 dark:bg-white/10" aria-hidden="true" />
        <button
          type="button"
          onClick={() => setTab('ai')}
          title="Chatgram AI"
          aria-label="Chatgram AI"
          data-testid="sidebar-ai"
          className={`flex w-14 flex-col items-center gap-1 rounded-xl py-2 text-[11.5px] font-semibold transition ${
            tab === 'ai'
              ? 'bg-brand-600/10 text-brand-700 dark:text-brand-300'
              : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-white/5'
          }`}
        >
          <span className="relative">
            <Sparkles className="h-5 w-5" />
            {aiUnread > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[9px] font-bold text-white">
                {aiUnread > 9 ? '9+' : aiUnread}
              </span>
            ) : null}
          </span>
          AI
        </button>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('chatgram-open-help'))}
          title="Help and support"
          aria-label="Help and support"
          data-testid="sidebar-help"
          className="flex w-14 flex-col items-center gap-1 rounded-xl py-2 text-[11.5px] font-semibold text-ink-600 transition hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-white/5"
        >
          <LifeBuoy className="h-5 w-5" />
          Help
        </button>
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

      {tab === 'chats' || tab === 'ai' ? (
        <>
          <aside
            className={`${tab === 'ai' || selected ? 'hidden lg:flex' : 'flex'} w-full shrink-0 flex-col border-r border-ink-200 dark:border-white/10 sm:w-[330px]`}
          >
            <button
              type="button"
              onClick={() => setTab('ai')}
              aria-current={tab === 'ai' ? 'page' : undefined}
              className={`flex w-full items-center gap-3 border-b border-ink-200 px-3 py-2.5 text-left dark:border-white/10 ${
                tab === 'ai' ? 'bg-ink-100/80 dark:bg-white/[.06]' : 'hover:bg-ink-100/70 dark:hover:bg-white/[.04]'
              }`}
              data-testid="ai-pinned-entry"
            >
              <span className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-600 text-white">
                <img src="/web/assistant-avatar.svg" alt="" className="h-full w-full object-cover" />
                <BadgeCheck className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-white text-brand-600 dark:bg-ink-800 dark:text-brand-300" aria-label="Official Chatgram AI" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate font-semibold">Chatgram AI</span>
                  {aiPreviewAt ? (
                    <span className="shrink-0 text-[10.5px] font-medium text-ink-500 dark:text-ink-400">{formatTime(aiPreviewAt, timeFormat)}</span>
                  ) : null}
                </span>
                <span className="mt-0.5 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-500 dark:text-ink-400">
                    {aiPreview || 'Official · Ask anything'}
                  </span>
                  {aiUnread > 0 ? (
                    <span
                      className="grid h-5 min-w-[20px] shrink-0 place-items-center rounded-full bg-brand-600 px-1.5 text-[10.5px] font-bold text-white"
                      data-testid="ai-unread-badge"
                    >
                      {aiUnread > 9 ? '9+' : aiUnread}
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
            <ChatList
              onAskAi={(text: string) => {
                setAiPendingQuestion(text);
                setTab('ai');
              }}
              chats={chats.data ?? []}
              meId={meId}
              selectedId={selectedId}
              typingByChat={typing}
              timeFormat={timeFormat}
              onSelect={setSelectedId}
              onNewChat={() => setTab('contacts')}
              onOpenProfile={(userId, chatId) => profileApi.openProfile(userId, chatId)}
            />
          </aside>

          {tab === 'ai' ? (
            <AiThread
              onBack={() => setTab('chats')}
              initialQuestion={aiPendingQuestion}
              onQuestionHandled={() => setAiPendingQuestion(null)}
            />
          ) : selected ? (
            <ChatWindow chat={selected} meId={meId} onBack={() => setSelectedId(null)} />
          ) : (
            <section className="hidden flex-1 place-items-center overflow-y-auto px-6 py-6 text-center sm:grid">
              <div className="w-full max-w-md">
                <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand-600 text-white shadow-lg">
                  <MessageCircle className="h-8 w-8" />
                </span>
                <h2 className="mt-3 text-lg font-bold">Welcome to Chatgram</h2>
                <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">Pick a chat on the left, or start something new.</p>
                {!connected ? <p className="mt-2 text-xs font-semibold text-amber-500">Reconnecting…</p> : null}

                {/* Item 4: one rotating recommendation from the server, dismissible. */}
                {(() => {
                  const recommendations = recommendationsQuery.data?.recommendations ?? [];
                  if (recommendations.length === 0) return null;
                  const pick = recommendations[new Date().getHours() % recommendations.length]!;
                  const Icon = pick.action === 'downloads' ? Download : pick.action === 'profile' ? Camera : pick.action === 'invite' ? Share2 : Sparkles;
                  return (
                    <div className="relative mt-4 rounded-2xl border border-ink-200 bg-white p-3 text-left dark:border-white/10 dark:bg-white/[.03]" data-testid="empty-recommendation">
                      <button
                        type="button"
                        className="absolute right-2 top-2 rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-white/10 dark:hover:text-white"
                        aria-label="Dismiss this recommendation"
                        title="Dismiss"
                        data-testid="dismiss-recommendation"
                        disabled={dismissingRecommendation}
                        onClick={() => void dismissRecommendation(pick.key)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                      <div className="flex items-start gap-3 pr-6">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200"><Icon className="h-5 w-5" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">{pick.title}</p>
                          <p className="mt-0.5 text-[12.5px] text-ink-500 dark:text-ink-300">{pick.body}</p>
                          <button type="button" className="btn-primary mt-2 !h-8 !px-3 !text-[12px]" onClick={() => runRecommendation(pick)} data-testid="recommendation-cta">{pick.ctaLabel}</button>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Quick actions row (item 4): document, contact, invite, group, AI. */}
                <input ref={emptyDocRef} type="file" multiple className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) setEmptyDocument(file); }} />
                <div className="mt-4 grid grid-cols-5 gap-1.5" data-testid="empty-quick-actions">
                  {[
                    { label: 'Send document', icon: FileText, action: () => emptyDocRef.current?.click() },
                    { label: 'Add contact', icon: UserPlus, action: () => setTab('contacts') },
                    { label: 'Invite a friend', icon: Share2, action: shareInvite },
                    { label: 'New group', icon: FolderUp, action: () => setTab('groups') },
                    { label: 'Chatgram AI', icon: Sparkles, action: () => setTab('ai') },
                  ].map((action) => (
                    <button key={action.label} type="button" onClick={action.action} className="flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium text-ink-600 hover:bg-ink-100/70 dark:text-ink-300 dark:hover:bg-white/[.04]" aria-label={action.label} title={action.label}>
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-ink-100 text-ink-700 dark:bg-white/[.07] dark:text-ink-100"><action.icon className="h-4 w-4" /></span>
                      {action.label}
                    </button>
                  ))}
                </div>

                {emptyDocument ? (
                  <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setEmptyDocument(null)}>
                    <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-ink-800" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="Send document">
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="min-w-0 truncate font-bold">Send “{emptyDocument.name}” to…</h3>
                        <button type="button" className="btn-ghost !px-2" onClick={() => setEmptyDocument(null)} aria-label="Close"><X className="h-4 w-4" /></button>
                      </div>
                      {(chats.data ?? []).length === 0 ? <p className="text-sm text-ink-500">Start a chat first, then attach the document there.</p> : null}
                      <ul className="max-h-72 overflow-y-auto">
                        {(chats.data ?? []).map((target) => (
                          <li key={target.id}>
                            <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-ink-100 dark:hover:bg-white/5" onClick={() => void sendEmptyDocument(target.id)}>
                              <span className="truncate text-sm">{chatTitle(target, meId)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}

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

      {profileTarget ? (
        <ProfilePanel
          userId={profileTarget.userId}
          chatId={profileTarget.chatId}
          onClose={closeProfile}
          onOpenChat={openChat}
        />
      ) : null}
    </div>
    </ProfilePanelContext.Provider>
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

  // Route tree: /web/admin and every /web/admin/* section (Overview, Users, Inbox, …).
  if (typeof window !== 'undefined' && /\/admin(?:\/|$)/.test(window.location.pathname)) {
    return (
      <Suspense
        fallback={
          <div className="grid min-h-screen place-items-center bg-ink-900 text-sm text-ink-300">Loading the admin dashboard…</div>
        }
      >
        <AdminApp />
      </Suspense>
    );
  }

  // Group invite links: /web/join/<token>
  const joinMatch =
    typeof window !== 'undefined' ? window.location.pathname.match(/\/join\/([^/]+)\/?$/) : null;
  if (joinMatch && joinMatch[1]) {
    return (
      <>
        <JoinGroup token={decodeURIComponent(joinMatch[1])} />
        <SupportWidget />
      </>
    );
  }

  return (
    <>
      {user ? <Shell /> : <Auth />}
      <SupportWidget hideLauncher={Boolean(user)} />
    </>
  );
}
