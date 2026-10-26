import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Moon, Sun, Monitor, MessageCircle, LogOut, Users, CircleDashed, Phone,
  Settings as SettingsIcon, ChevronDown, X, Search, LifeBuoy, Sparkles, BadgeCheck,
  UserRoundPlus, Plus, Download, Share2, FolderUp, FileText, Camera, Lock,
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
import { GroupInfoContext, useGroupInfo, type GroupInfoApi } from './lib/groupInfo';
import { ChatList } from './components/ChatList';
import AnnouncementBanner from './components/AnnouncementBanner';
import { ChatHeader } from './components/ChatHeader';
import { MessageBubble } from './components/MessageBubble';
import Composer from './components/Composer';
import { CallOverlay } from './components/CallOverlay';
import { CallAlerts } from './components/CallAlerts';
import { NewChatPanel } from './components/NewChatPanel';
import { useIsOnline } from './lib/presence';
import { getCallState, joinActiveCall, rejectCall, requestRoomState, startCall, subscribeCalls, subscribeCallRooms, getCallRoom, canJoinRoom } from './lib/calls';
import Groups, { GroupInfo } from './pages/Groups';
import Calls from './pages/Calls';
import Status from './pages/Status';
import SettingsPage from './pages/Settings';
import Auth from './pages/Auth';
import SupportWidget from './components/SupportWidget';
import { AiThread } from './components/AiThread';
import { useAiThread } from './lib/aiThread';
import JoinGroup from './pages/JoinGroup';
import MaintenancePage from './components/MaintenancePage';
import { isMaintenancePreview } from './lib/maintenance';
import { READ_ONLY_BANNER, READ_ONLY_NOTICE } from './lib/readOnly';
import { ProfilePanel } from './components/ProfilePanel';
import { ProfilePanelContext, type ProfilePanelApi } from './lib/profilePanel';
import { dateSeparatorLabel, formatTime, sameDay, statusOf } from './lib/ui';

type Tab = 'chats' | 'calls' | 'status' | 'groups' | 'settings' | 'ai';

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

function ChatWindow({
  chat,
  meId,
  onBack,
  readOnly = false,
}: {
  chat: Chat;
  meId: string;
  onBack: () => void;
  /** Read-only maintenance mode: reading works, every write path is disabled. */
  readOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const profilePanel = useProfilePanel();
  const groupInfo = useGroupInfo();
  const timeFormat = usePrefs((s) => s.timeFormat);
  const typingByChat = useRealtime((s) => s.typing);
  const connected = useRealtime((s) => s.connected);

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; name: string; preview: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inChatSearch, setInChatSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [showJump, setShowJump] = useState(false);

  // Live group-call room for this chat (banner + call card "Join").
  const callState = useSyncExternalStore(subscribeCalls, getCallState);
  const callRoom = useSyncExternalStore(subscribeCallRooms, () => getCallRoom(chat.id));
  const callRoomLive = Boolean(
    callRoom && callRoom.state !== 'ended' && canJoinRoom(callRoom) && callState.callId !== callRoom.callId,
  );

  function joinThisRoom() {
    if (!callRoom) return;
    void joinActiveCall(callRoom);
  }

  function declineCallCard(card: { callId: string }) {
    if (callState.status === 'incoming' && callState.callId === card.callId) {
      rejectCall();
      return;
    }
    setNotice('That call invitation is no longer ringing.');
  }

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
    // Opening a chat must show a call that is already running there (banner +
    // call card state), even if this client missed the room broadcast.
    requestRoomState(chat.id);
    return () => realtime.leaveChat(chat.id);
  }, [chat.id]);

  useEffect(() => {
    if (readOnly) return;
    api.markChatRead(chat.id).catch(() => {});
    void queryClient.invalidateQueries({ queryKey: ['chats'] });
  }, [chat.id, queryClient, readOnly]);

  // While this conversation is open and the window is focused, incoming
  // messages must be marked read — otherwise the sender never gets blue ticks.
  useEffect(() => {
    const list = messages.data;
    if (readOnly) return undefined;
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
  }, [messages.data, meId, chat.id, queryClient, readOnly]);

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

  const list = useMemo(
    () =>
      [...(messages.data ?? [])].sort(
        (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
      ),
    [messages.data],
  );
  const partner = chatPartner(chat, meId);
  const contactsQuery = useQuery({ queryKey: ['contacts'], queryFn: () => api.contacts(), staleTime: 60_000, retry: false });
  const partnerIsContact = !partner || (contactsQuery.data ?? []).some((person) => person.id === partner.id);
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
    if (readOnly) {
      setNotice(READ_ONLY_NOTICE);
      return;
    }
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
    if (readOnly) {
      setNotice(READ_ONLY_NOTICE);
      return;
    }
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
    if (readOnly) {
      setNotice(READ_ONLY_NOTICE);
      return;
    }
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

  /** Chunk 1C: reveal a private AI answer (and its question) to the group. */
  async function shareWithGroup(message: Message) {
    if (readOnly) {
      setNotice(READ_ONLY_NOTICE);
      return;
    }
    try {
      await api.shareWithGroup(message.id);
      void queryClient.invalidateQueries({ queryKey: ['messages', chat.id] });
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      setNotice('Shared with the group.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not share the AI answer');
    }
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ChatHeader
        chat={chat}
        meId={meId}
        partner={partner}
        readOnly={readOnly}
        typing={typing}
        online={isOnline}
        connected={connected}
        timeFormat={timeFormat}
        inChatSearchOpen={searchOpen}
        onToggleSearch={() => {
          setSearchOpen((v) => !v);
          setInChatSearch('');
        }}
        onOpenProfile={
          chat.type === 'group'
            ? () => groupInfo.openGroupInfo(chat.id)
            : partner
              ? () => profilePanel.openProfile(partner.id, chat.id)
              : undefined
        }
        onCall={() => {
          if (callRoomLive) {
            joinThisRoom();
            return;
          }
          if (chat.participants.length < 2) {
            setNotice('There is nobody else in this chat to call.');
            return;
          }
          void startCall(
            {
              chatId: chat.id,
              title: chat.type === 'group' ? chat.groupName || 'Group call' : partner?.displayName || 'Chat',
              isGroup: chat.type === 'group',
              participantCount: chat.participants.length,
            },
            { video: false },
          );
        }}
        onVideoCall={() => {
          if (callRoomLive) {
            joinThisRoom();
            return;
          }
          if (chat.participants.length < 2) {
            setNotice('There is nobody else in this chat to call.');
            return;
          }
          void startCall(
            {
              chatId: chat.id,
              title: chat.type === 'group' ? chat.groupName || 'Group call' : partner?.displayName || 'Chat',
              isGroup: chat.type === 'group',
              participantCount: chat.participants.length,
            },
            { video: true },
          );
        }}
        menu={{
          onContactInfo: () =>
            chat.type === 'group'
              ? groupInfo.openGroupInfo(chat.id)
              : partner
                ? profilePanel.openProfile(partner.id, chat.id)
                : undefined,
          onMute: readOnly
            ? undefined
            : async () => {
                try {
                  await api.muteChat(chat.id);
                  setNotice('Notifications muted for this chat.');
                } catch (err) {
                  setNotice(err instanceof Error ? err.message : 'Could not mute this chat');
                }
              },
          onForward: () => setNotice('Forwarding is still being deployed — coming soon.'),
          onClearChat: readOnly
            ? undefined
            : async () => {
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

      {callRoomLive && callRoom && chat.type === 'group' ? (
        <div
          className="flex flex-wrap items-center gap-2 border-b border-emerald-300/50 bg-emerald-50 px-4 py-2 text-[12.5px] text-emerald-900 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-100"
          data-testid="group-call-banner"
          role="status"
        >
          <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            {callRoom.state === 'ringing' ? 'Call ringing' : 'Call in progress'}, {callRoom.participantCount}{' '}
            {callRoom.participantCount === 1 ? 'person' : 'people'}
            {callRoom.video ? ' · video' : ' · voice'}
          </span>
          <button
            type="button"
            className="rounded-full bg-emerald-600 px-3 py-1 text-[11.5px] font-semibold text-white hover:bg-emerald-700"
            onClick={joinThisRoom}
            aria-label={`Join the group call, ${callRoom.participantCount} people on it`}
          >
            Join
          </button>
        </div>
      ) : null}

      {chat.type !== 'group' && partner && contactsQuery.data && !partnerIsContact ? (
        <div
          className="flex flex-wrap items-center gap-2 border-b border-amber-300/50 bg-amber-50 px-4 py-2 text-[12.5px] text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200"
          data-testid="non-contact-banner"
        >
          <span className="min-w-0 flex-1">
            Not in your contacts: <strong className="font-semibold">{partner.displayName}</strong>
          </span>
          <button
            type="button"
            className="rounded-full border border-amber-500/60 px-2.5 py-1 text-[11.5px] font-semibold hover:bg-amber-100 dark:hover:bg-amber-500/20"
            onClick={() => profilePanel.openProfile(partner.id, chat.id)}
          >
            <Plus className="mr-1 inline h-3.5 w-3.5" /> Add
          </button>
          <button
            type="button"
            className="rounded-full border border-amber-500/60 px-2.5 py-1 text-[11.5px] font-semibold hover:bg-amber-100 dark:hover:bg-amber-500/20"
            onClick={async () => {
              try {
                await api.blockUser(partner.id);
                void queryClient.invalidateQueries({ queryKey: ['chats'] });
                void queryClient.invalidateQueries({ queryKey: ['profile', partner.id] });
                setNotice(`${partner.displayName} is blocked.`);
              } catch (err) {
                setNotice(err instanceof Error ? err.message : 'Could not block this person');
              }
            }}
          >
            Block
          </button>
          <button
            type="button"
            className="rounded-full border border-rose-500/60 px-2.5 py-1 text-[11.5px] font-semibold text-rose-700 hover:bg-rose-100 dark:text-rose-300 dark:hover:bg-rose-500/20"
            onClick={() => profilePanel.openProfile(partner.id, chat.id, { report: true })}
          >
            Report
          </button>
        </div>
      ) : null}

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

      <div ref={scrollRef} onScroll={onScroll} className="no-scrollbar relative min-h-0 flex-1 overflow-y-auto">
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
                    onDelete: readOnly
                      ? () => setNotice(READ_ONLY_NOTICE)
                      : removeMessage,
                    onReact: readOnly ? () => setNotice(READ_ONLY_NOTICE) : reactTo,
                    onOpenProfile: (userId) => profilePanel.openProfile(userId, chat.id),
                    onPin: !readOnly && chat.type === 'group' ? (message) => void pinToGroup(message) : undefined,
                    onSeenBy:
                      message.senderId === meId ? (message) => setReadersFor(message) : undefined,
                    onEdit:
                      !readOnly && message.senderId === meId
                        ? (row, content) => void editMessage(row, content)
                        : undefined,
                    onStar: readOnly ? undefined : (row) => void toggleStar(row),
                    onForward: readOnly ? undefined : (row) => setForwardFor(row),
                    onShareWithGroup: readOnly ? undefined : (row) => void shareWithGroup(row),
                    onCallJoin: readOnly
                      ? undefined
                      : (card) => {
                          const room = callRoom && callRoom.callId === card.callId ? callRoom : getCallRoom(chat.id);
                          if (room && canJoinRoom(room)) void joinActiveCall(room);
                          else setNotice('That call has already ended.');
                        },
                    onCallDecline: readOnly ? undefined : (card) => declineCallCard(card),
                    activeCallId: callState.callId,
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

      <div className="composer-safe mx-auto w-full max-w-[1400px]">
        <Composer
          chatId={chat.id}
          draft={draft}
          onDraftChange={setDraft}
          onSendText={sendText}
          onSendFile={sendFile}
          onTyping={emitTyping}
          readOnly={readOnly}
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
  { key: 'calls', label: 'Calls', Icon: Phone },
  { key: 'status', label: 'Status', Icon: CircleDashed },
  { key: 'groups', label: 'Groups', Icon: Users },
  { key: 'settings', label: 'Settings', Icon: SettingsIcon },
];

function Shell({ features }: { features: AppFeatures | null }) {
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const { mode, cycle } = useTheme();
  // Read-only mode (PlatformSettings.readOnlyMode): reads work, writes fail with
  // 503. The realtime send/call events are NOT behind the server gate, so the
  // client disables them explicitly.
  const readOnly = features?.readOnlyMode === true;
  const timeFormat = usePrefs((s) => s.timeFormat);
  const connected = useRealtime((s) => s.connected);
  const typing = useRealtime((s) => s.typing);

  const [tab, setTab] = useState<Tab>('chats');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [profileTarget, setProfileTarget] = useState<{ userId: string; chatId?: string; report?: boolean } | null>(null);
  const [groupInfoId, setGroupInfoId] = useState<string | null>(null);
  const callState = useSyncExternalStore(subscribeCalls, getCallState);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const missedCalls = useQuery({
    queryKey: ['call-missed-count'],
    queryFn: () => api.callMissedCount(),
    refetchInterval: 30_000,
    retry: false,
  });

  // Old /web/contacts links open the New chat panel instead of a dead page.
  useEffect(() => {
    if (!/\/contacts\/?$/.test(window.location.pathname)) return;
    window.history.replaceState(null, '', '/web/');
    setTab('chats');
    setNewChatOpen(true);
  }, []);

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
  const closeGroupInfo = useCallback(() => setGroupInfoId(null), []);
  const groupInfoApi = useMemo<GroupInfoApi>(
    () => ({
      openGroupInfo: (chatId: string) => setGroupInfoId(chatId),
      closeGroupInfo,
      activeGroupId: groupInfoId,
    }),
    [closeGroupInfo, groupInfoId],
  );
  const groupInfoChat = useMemo(
    () => (chats.data ?? []).find((chat) => chat.id === groupInfoId) ?? null,
    [chats.data, groupInfoId],
  );
  const profileApi = useMemo<ProfilePanelApi>(
    () => ({
      openProfile: (userId: string, chatId?: string, options?: { report?: boolean }) =>
        setProfileTarget({ userId, chatId, report: Boolean(options?.report) }),
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
    if (readOnly) return;
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
    <GroupInfoContext.Provider value={groupInfoApi}>
    <div className="app-viewport flex flex-col overflow-hidden">
      <CallOverlay call={callState} />
      <CallAlerts />
      {readOnly ? (
        <div
          role="status"
          data-testid="read-only-banner"
          className="flex shrink-0 items-start gap-2 border-b border-amber-300/60 bg-amber-50 px-3 py-2 text-[12.5px] leading-snug text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1">{READ_ONLY_BANNER}</p>
        </div>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <nav className="hidden w-[76px] shrink-0 flex-col items-center gap-1 border-r border-ink-200 py-4 dark:border-white/10 sm:flex">
        {NAV.map(({ key, label, Icon }) => {
          const badge = key === 'calls' ? missedCalls.data?.count ?? 0 : 0;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              title={label}
              aria-label={badge > 0 ? `${label}, ${badge} missed call${badge === 1 ? '' : 's'}` : label}
              className={`flex w-14 flex-col items-center gap-1 rounded-xl py-2 text-[11.5px] font-semibold transition ${
                tab === key
                  ? 'bg-brand-600/10 text-brand-700 dark:text-brand-300'
                  : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-white/5'
              }`}
            >
              <span className="relative">
                <Icon className="h-5 w-5" />
                {badge > 0 ? (
                  <span
                    className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[9px] font-bold text-white"
                    data-testid="calls-missed-badge"
                  >
                    {badge > 9 ? '9+' : badge}
                  </span>
                ) : null}
              </span>
              {label}
            </button>
          );
        })}
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
        {features?.supportWidgetEnabled === false ? null : (
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
        )}
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
            className={`${tab === 'ai' || selected ? 'hidden lg:flex' : 'flex'} min-h-0 w-full shrink-0 flex-col overflow-hidden border-r border-ink-200 dark:border-white/10 sm:w-[330px]`}
          >
            {newChatOpen ? (
              <NewChatPanel
                onClose={() => setNewChatOpen(false)}
                onOpenChat={(chatId) => {
                  setNewChatOpen(false);
                  openChat(chatId);
                }}
                onNewGroup={() => {
                  setNewChatOpen(false);
                  setTab('groups');
                }}
              />
            ) : (
              <>
            <AnnouncementBanner />
            <button
              type="button"
              onClick={() => setTab('ai')}
              aria-current={tab === 'ai' ? 'page' : undefined}
              className={`flex w-full shrink-0 items-center gap-3 border-b border-ink-200 px-3 py-2.5 text-left dark:border-white/10 ${
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
              onNewChat={() => setNewChatOpen(true)}
              onOpenProfile={(userId, chatId) => profileApi.openProfile(userId, chatId)}
            />
              </>
            )}
          </aside>

          {tab === 'ai' ? (
            <AiThread
              onBack={() => setTab('chats')}
              initialQuestion={aiPendingQuestion}
              onQuestionHandled={() => setAiPendingQuestion(null)}
            />
          ) : selected ? (
            <ChatWindow chat={selected} meId={meId} onBack={() => setSelectedId(null)} readOnly={readOnly} />
          ) : (
            <section className="hidden min-h-0 flex-1 place-items-center overflow-y-auto px-6 py-6 text-center sm:grid">
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
                    { label: 'Add contact', icon: UserRoundPlus, action: () => { setTab('chats'); setNewChatOpen(true); } },
                    { label: 'Invite a friend', icon: Share2, action: shareInvite },
                    { label: 'New group', icon: FolderUp, action: () => setTab('groups') },
                    { label: 'Chatgram AI', icon: Sparkles, action: () => setTab('ai') },
                  ].map((action) => (
                    <button key={action.label} type="button" onClick={action.action} disabled={readOnly} className="flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium text-ink-600 hover:bg-ink-100/70 disabled:cursor-not-allowed disabled:opacity-50 dark:text-ink-300 dark:hover:bg-white/[.04]" aria-label={action.label} title={readOnly ? READ_ONLY_NOTICE : action.label}>
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
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {tab === 'status' ? (
            <Status readOnly={readOnly} />
          ) : tab === 'groups' ? (
            <Groups onOpenChat={openChat} />
          ) : tab === 'calls' ? (
            <Calls onOpenChat={openChat} readOnly={readOnly} />
          ) : (
            <SettingsPage onOpenSupport={openChat} />
          )}
        </div>
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

      {groupInfoChat ? (
        <div className="fixed inset-y-0 right-0 z-40 flex max-w-full shadow-2xl" data-testid="group-info-host">
          <GroupInfo
            chat={groupInfoChat}
            meId={meId}
            onClose={closeGroupInfo}
            onOpenChat={openChat}
            onAskAi={() => {
              closeGroupInfo();
              setTab('ai');
            }}
          />
        </div>
      ) : null}

      {profileTarget ? (
        <ProfilePanel
          userId={profileTarget.userId}
          chatId={profileTarget.chatId}
          openReport={profileTarget.report}
          onClose={closeProfile}
          onOpenChat={openChat}
          onBack={groupInfoId ? closeProfile : undefined}
        />
      ) : null}
      </div>
    </div>
    </GroupInfoContext.Provider>
    </ProfilePanelContext.Provider>
  );
}

/* -------------------------------------------------------------------- app */

type AppFeatures = {
  registrationEnabled: boolean;
  statusEnabled: boolean;
  groupsEnabled: boolean;
  fileUploadsEnabled: boolean;
  aiEnabled: boolean;
  supportWidgetEnabled: boolean;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  readOnlyMode: boolean;
  maxUploadMb: number;
};

export default function App() {
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const setReady = useSession((s) => s.setReady);
  const [features, setFeatures] = useState<AppFeatures | null>(null);

  const loadFeatures = useCallback(async () => {
    try {
      const response = await fetch('/api/app/features', { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const payload = (await response.json()) as AppFeatures | null;
      if (payload) setFeatures(payload);
    } catch {
      // Keep the last known flags: the maintenance page polls on its own.
    }
  }, []);

  // Feature flags + maintenance state (the server also enforces every flag).
  // Re-read periodically and on resume, so maintenance / read-only switches show
  // up without a manual reload; Electron and Android resume fire these events.
  useEffect(() => {
    void loadFeatures();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadFeatures();
    }, 60_000);
    const onVisible = () => {
      if (!document.hidden) void loadFeatures();
    };
    const onOnline = () => void loadFeatures();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [loadFeatures]);

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

  // Local preview of the maintenance experience (admin dashboard → Preview):
  // `?maintenance-preview=1` renders the page without enabling maintenance.
  if (isMaintenancePreview()) {
    return <MaintenancePage preview maintenanceMessage={features?.maintenanceMessage ?? ''} />;
  }

  // Full maintenance: every non-admin API call returns 503, so the whole app is
  // replaced by the branded page that polls health + feature flags.
  if (features?.maintenanceMode) {
    return <MaintenancePage maintenanceMessage={features.maintenanceMessage} />;
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
      {user ? <Shell features={features} /> : <Auth />}
      {features?.supportWidgetEnabled === false ? null : <SupportWidget hideLauncher={Boolean(user)} />}
    </>
  );
}
