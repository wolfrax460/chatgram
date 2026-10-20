import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import {
  Avatar,
  Icon,
  Spinner,
  EmptyState,
  ErrorNote,
  formatTime,
  formatDay,
} from '../components/ui.jsx';

/* ------------------------------------------------------------- utilities */
function otherParticipants(chat, meId) {
  return (chat.participants || []).filter((p) => (p._id || p.id) !== meId);
}

function chatTitle(chat, meId) {
  if (chat.type === 'group') return chat.groupName || 'Group';
  const others = otherParticipants(chat, meId);
  if (others.length === 0) return 'Saved messages';
  if (others.length === 1) return others[0].displayName || 'Unknown';
  return others.map((o) => o.displayName).join(', ');
}

function avatarName(chat, meId) {
  if (chat.type === 'group') return chat.groupName || 'Group';
  const others = otherParticipants(chat, meId);
  return others[0]?.displayName || 'Chat';
}

function lastLine(chat, meId) {
  const m = chat.lastMessage;
  if (!m) return 'No messages yet';
  const prefix = (m.senderId?._id || m.senderId) === meId ? 'You: ' : '';
  const body =
    m.content ||
    (m.type === 'image'
      ? 'Photo'
      : m.type === 'video'
        ? 'Video'
        : m.type === 'audio'
          ? 'Voice message'
          : m.type === 'file'
            ? 'Document'
            : '');
  return `${prefix}${body}`;
}

/* ------------------------------------------------------------- chat list */
function ChatRow({ chat, meId, active, onClick }) {
  const unread = chat.unreadCount || 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
        active
          ? 'bg-brand-600/10 dark:bg-white/[.07]'
          : 'hover:bg-ink-100/70 dark:hover:bg-white/[.04]'
      }`}
    >
      <Avatar name={avatarName(chat, meId)} size={46} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-semibold">{chatTitle(chat, meId)}</span>
          <span className="shrink-0 text-[11px] text-ink-400">
            {chat.lastMessage?.sentAt ? formatTime(chat.lastMessage.sentAt) : ''}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-[13px] text-ink-500 dark:text-ink-400">
            {lastLine(chat, meId)}
          </span>
          {unread > 0 ? (
            <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-brand-600 px-1.5 text-[11px] font-bold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

/* ----------------------------------------------------------- chat window */
function Bubble({ message, meId }) {
  const mine = (message.senderId?._id || message.senderId) === meId;
  const senderName = message.senderId?.displayName;
  const isGroup = Boolean(senderName) && !mine;

  return (
    <div className={`flex w-full ${mine ? 'justify-end' : 'justify-start'} animate-slide-in`}>
      <div
        className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-[14.5px] shadow-sm ${
          mine
            ? 'rounded-br-md bg-brand-600 text-white'
            : 'rounded-bl-md bg-white text-ink-800 dark:bg-ink-700 dark:text-ink-100'
        }`}
      >
        {isGroup ? (
          <div className="mb-0.5 text-[12px] font-semibold text-brand-600 dark:text-brand-300">
            {senderName}
          </div>
        ) : null}
        {message.type === 'image' && message.mediaUrl ? (
          <img
            src={message.mediaUrl}
            alt=""
            className="mb-1 max-h-72 rounded-lg object-cover"
            loading="lazy"
          />
        ) : null}
        {message.content ? <div className="whitespace-pre-wrap break-words">{message.content}</div> : null}
        <div
          className={`mt-1 flex items-center justify-end gap-1 text-[10.5px] ${
            mine ? 'text-white/70' : 'text-ink-400'
          }`}
        >
          {formatTime(message.sentAt)}
          {mine ? <Icon.checkDouble className="h-3.5 w-3.5" /> : null}
        </div>
      </div>
    </div>
  );
}

function Composer({ onSend, disabled }) {
  const [text, setText] = useState('');
  const ref = useRef(null);

  function submit(e) {
    e?.preventDefault();
    const value = text.trim();
    if (!value || disabled) return;
    onSend(value);
    setText('');
    ref.current?.focus();
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-2 border-t border-ink-200 p-3 dark:border-white/10">
      <button type="button" className="btn-ghost !px-2.5" title="Attachments (coming soon)" disabled>
        <Icon.attach className="h-5 w-5" />
      </button>
      <textarea
        ref={ref}
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Type a message"
        className="field max-h-32 min-h-[44px] flex-1 resize-none py-2.5"
      />
      <button type="submit" className="btn-primary !px-3" disabled={!text.trim() || disabled}>
        <Icon.send className="h-5 w-5" />
      </button>
    </form>
  );
}

function ChatWindow({ chat, meId, onBack, socket }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  const chatId = chat._id || chat.id;

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.messages(chatId);
      const list = Array.isArray(data) ? data : data?.messages || [];
      setMessages(list);
      scrollToBottom();
      api.markRead(chatId).catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [chatId, scrollToBottom]);

  useEffect(() => {
    load();
  }, [load]);

  // Live incoming messages for this chat.
  useEffect(() => {
    if (!socket) return undefined;
    const onNew = (msg) => {
      const msgChatId = msg.chatId?._id || msg.chatId;
      if (msgChatId !== chatId) return;
      setMessages((prev) => {
        if (msg.clientId && prev.some((m) => m.clientId === msg.clientId)) return prev;
        if (prev.some((m) => (m._id || m.id) === (msg._id || msg.id))) return prev;
        return [...prev, msg];
      });
      scrollToBottom();
      api.markRead(chatId).catch(() => {});
    };
    socket.on('message:new', onNew);
    return () => socket.off('message:new', onNew);
  }, [socket, chatId, scrollToBottom]);

  async function send(text) {
    setSending(true);
    const clientId = `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic = {
      _id: clientId,
      clientId,
      chatId,
      senderId: meId,
      type: 'text',
      content: text,
      sentAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    scrollToBottom();

    try {
      if (socket?.connected) {
        socket.emit('message:send', { chatId, type: 'text', content: text, clientId });
      } else {
        const saved = await api.sendMessage({ chatId, type: 'text', content: text, clientId });
        setMessages((prev) =>
          prev.map((m) =>
            m.clientId === clientId ? { ...saved, sentAt: saved.sentAt || m.sentAt } : m,
          ),
        );
      }
    } catch (err) {
      setError(err.message);
      setMessages((prev) => prev.filter((m) => m.clientId !== clientId));
    } finally {
      setSending(false);
    }
  }

  const grouped = useMemo(() => {
    const out = [];
    let lastDay = '';
    for (const m of messages) {
      const day = formatDay(m.sentAt);
      if (day !== lastDay) {
        out.push({ kind: 'day', key: `d-${day}-${out.length}`, day });
        lastDay = day;
      }
      out.push({ kind: 'msg', key: (m._id || m.id) + (m.clientId || ''), message: m });
    }
    return out;
  }, [messages]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-ink-200 px-4 py-3 dark:border-white/10">
        <button type="button" className="btn-ghost !px-2 lg:hidden" onClick={onBack}>
          <Icon.back className="h-5 w-5" />
        </button>
        <Avatar name={avatarName(chat, meId)} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{chatTitle(chat, meId)}</div>
          <div className="truncate text-[12px] text-ink-500 dark:text-ink-400">
            {chat.type === 'group'
              ? `${(chat.participants || []).length} members`
              : otherParticipants(chat, meId)[0]?.isOnline
                ? 'online'
                : 'offline'}
          </div>
        </div>
        <button type="button" className="btn-ghost !px-2" onClick={load} title="Reload">
          <Icon.refresh className="h-5 w-5" />
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="grid h-full place-items-center">
            <Spinner className="h-7 w-7 text-brand-600" />
          </div>
        ) : messages.length === 0 ? (
          <EmptyState
            icon={Icon.chat}
            title="No messages yet"
            message="Say hello to start the conversation."
          />
        ) : (
          <div className="space-y-2">
            {grouped.map((item) =>
              item.kind === 'day' ? (
                <div key={item.key} className="flex justify-center py-2">
                  <span className="rounded-full bg-ink-200/70 px-3 py-1 text-[11px] font-semibold text-ink-600 dark:bg-white/10 dark:text-ink-300">
                    {item.day}
                  </span>
                </div>
              ) : (
                <Bubble key={item.key} message={item.message} meId={meId} />
              ),
            )}
          </div>
        )}
        {error ? <div className="mt-3"><ErrorNote onDismiss={() => setError('')}>{error}</ErrorNote></div> : null}
      </div>

      <Composer onSend={send} disabled={sending} />
    </div>
  );
}

/* ------------------------------------------------------------------ chats */
export default function Chats({ meId, socket, onOpenContacts, initialChatId }) {
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [direct, groups] = await Promise.all([
        api.chats().catch(() => []),
        api.groups().catch(() => []),
      ]);
      const map = new Map();
      for (const c of [...(direct || []), ...(groups || [])]) {
        map.set(c._id || c.id, c);
      }
      const list = [...map.values()].sort((a, b) => {
        const at = a.lastMessage?.sentAt || a.updatedAt || '';
        const bt = b.lastMessage?.sentAt || b.updatedAt || '';
        return new Date(bt) - new Date(at);
      });
      setChats(list);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the list fresh as messages arrive.
  useEffect(() => {
    if (!socket) return undefined;
    const onNew = () => load();
    socket.on('message:new', onNew);
    return () => socket.off('message:new', onNew);
  }, [socket, load]);

  const visible = useMemo(() => {
    let list = chats;
    if (filter === 'unread') list = list.filter((c) => (c.unreadCount || 0) > 0);
    if (filter === 'groups') list = list.filter((c) => c.type === 'group');
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((c) => chatTitle(c, meId).toLowerCase().includes(q));
    return list;
  }, [chats, filter, query, meId]);

  const active = chats.find((c) => (c._id || c.id) === activeId) || null;

  return (
    <div className="flex h-full">
      {/* list column */}
      <div
        className={`flex w-full flex-col border-r border-ink-200 dark:border-white/10 lg:w-[380px] ${
          active ? 'hidden lg:flex' : 'flex'
        }`}
      >
        <div className="border-b border-ink-200 px-4 py-3 dark:border-white/10">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold">Chats</h2>
            <div className="flex gap-1">
              <button type="button" className="btn-ghost !px-2" onClick={load} title="Refresh">
                <Icon.refresh className="h-5 w-5" />
              </button>
              <button
                type="button"
                className="btn-primary !px-2.5"
                onClick={onOpenContacts}
                title="New chat"
              >
                <Icon.plus className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="relative mt-3">
            <Icon.search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-400" />
            <input
              className="field pl-9"
              placeholder="Search chats"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="mt-3 flex gap-1.5">
            {[
              ['all', 'All'],
              ['unread', 'Unread'],
              ['groups', 'Groups'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  filter === key
                    ? 'bg-brand-600 text-white'
                    : 'bg-ink-100 text-ink-600 hover:bg-ink-200 dark:bg-white/5 dark:text-ink-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error ? <div className="p-3"><ErrorNote onDismiss={() => setError('')}>{error}</ErrorNote></div> : null}
          {loading && chats.length === 0 ? (
            <div className="grid h-40 place-items-center">
              <Spinner className="h-6 w-6 text-brand-600" />
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={Icon.chat}
              title={query ? 'No matches' : 'No conversations yet'}
              message={
                query
                  ? 'Try a different search.'
                  : 'Add a contact, then start a conversation.'
              }
              action={
                <button type="button" className="btn-soft mt-2" onClick={onOpenContacts}>
                  <Icon.plus className="h-4 w-4" /> New chat
                </button>
              }
            />
          ) : (
            visible.map((chat) => {
              const id = chat._id || chat.id;
              return (
                <ChatRow
                  key={id}
                  chat={chat}
                  meId={meId}
                  active={id === activeId}
                  onClick={() => setActiveId(id)}
                />
              );
            })
          )}
        </div>
      </div>

      {/* conversation column */}
      <div className={`min-w-0 flex-1 ${active ? 'flex' : 'hidden lg:flex'} flex-col`}>
        {active ? (
          <ChatWindow
            chat={active}
            meId={meId}
            socket={socket}
            onBack={() => setActiveId(null)}
          />
        ) : (
          <div className="grid h-full place-items-center">
            <EmptyState
              icon={Icon.chat}
              title="Select a conversation"
              message="Pick a chat on the left, or start a new one."
            />
          </div>
        )}
      </div>
    </div>
  );
}
