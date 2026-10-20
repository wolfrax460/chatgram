import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import {
  Avatar,
  Icon,
  Spinner,
  EmptyState,
  ErrorNote,
  formatTime,
  formatDay,
} from '../components/ui.jsx';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // matches the server's multer limit

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
      ? '📷 Photo'
      : m.type === 'video'
        ? '🎬 Video'
        : m.type === 'audio'
          ? '🎤 Voice message'
          : m.type === 'file'
            ? '📎 Document'
            : '');
  return `${prefix}${body}`;
}

/** Message type derived from a MIME type. */
function typeFromMime(mimetype = '') {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  return 'file';
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds = 0) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
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

/* --------------------------------------------------------------- media */
function MediaContent({ message, mine }) {
  const url = message.mediaUrl;
  const [failed, setFailed] = useState(false);

  if (!url) return null;

  if (message.type === 'image') {
    if (failed) {
      return (
        <a href={url} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 underline opacity-80">
          <Icon.image className="h-4 w-4" /> Photo (tap to open)
        </a>
      );
    }
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img
          src={url}
          alt={message.content || 'Photo'}
          className="mb-1 max-h-80 w-full rounded-lg object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </a>
    );
  }

  if (message.type === 'video') {
    return (
      <video
        src={url}
        controls
        preload="metadata"
        className="mb-1 max-h-80 w-full rounded-lg bg-black"
        onError={() => setFailed(true)}
      />
    );
  }

  if (message.type === 'audio') {
    return (
      <div className={`mb-1 flex items-center gap-2 rounded-xl px-1 py-1 ${mine ? 'bg-white/15' : 'bg-black/5 dark:bg-white/10'}`}>
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${mine ? 'bg-white/25' : 'bg-brand-600 text-white'}`}>
          <Icon.mic className="h-4 w-4" />
        </span>
        <audio src={url} controls preload="metadata" className="h-8 w-56 max-w-full" />
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      download
      className={`mb-1 flex items-center gap-2 rounded-xl px-2.5 py-2 ${mine ? 'bg-white/15' : 'bg-black/5 dark:bg-white/10'}`}
    >
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${mine ? 'bg-white/25' : 'bg-brand-600 text-white'}`}>
        <Icon.attach className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold">
          {message.content || 'Document'}
        </span>
        <span className="block text-[11px] opacity-70">Tap to download</span>
      </span>
    </a>
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
        <MediaContent message={message} mine={mine} />
        {message.content && message.type !== 'file' ? (
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        ) : null}
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

/* ------------------------------------------------------------- composer */
function Composer({ onSend, onSendMedia, disabled }) {
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const inputRef = useRef(null);
  const textRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const cancelRef = useRef(false);

  function submit(e) {
    e?.preventDefault();
    const value = text.trim();
    if (!value || disabled || busy) return;
    onSend(value);
    setText('');
    textRef.current?.focus();
  }

  async function pickFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) {
        setNotice(`"${file.name}" is ${formatBytes(file.size)} — the limit is 10 MB.`);
        continue;
      }
      setBusy(true);
      setNotice('');
      try {
        await onSendMedia(file);
      } catch (err) {
        setNotice(err.message);
      } finally {
        setBusy(false);
      }
    }
  }

  function pickMime() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    for (const type of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported?.(type)) return type;
    }
    return '';
  }

  async function startRecording() {
    setNotice('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice('Recording is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMime();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      cancelRef.current = false;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(timerRef.current);
        setRecording(false);
        setSeconds(0);

        if (cancelRef.current) return;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size < 800) {
          setNotice('That recording was too short.');
          return;
        }
        if (blob.size > MAX_UPLOAD_BYTES) {
          setNotice(`Recording is ${formatBytes(blob.size)} — the limit is 10 MB.`);
          return;
        }
        const ext = (recorder.mimeType || 'audio/webm').includes('mp4') ? 'm4a' : 'webm';
        const file = new File([blob], `voice-note-${Date.now()}.${ext}`, {
          type: recorder.mimeType || 'audio/webm',
        });
        setBusy(true);
        try {
          await onSendMedia(file, 'audio');
        } catch (err) {
          setNotice(err.message);
        } finally {
          setBusy(false);
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (err) {
      setNotice('Microphone permission was denied.');
    }
  }

  function stopRecording(cancel = false) {
    cancelRef.current = cancel;
    try {
      recorderRef.current?.stop();
    } catch {
      /* already stopped */
    }
  }

  useEffect(
    () => () => {
      clearInterval(timerRef.current);
      try {
        recorderRef.current?.stop();
      } catch {
        /* ignore */
      }
    },
    [],
  );

  return (
    <div className="border-t border-ink-200 dark:border-white/10">
      {notice ? (
        <div className="px-3 pt-2">
          <ErrorNote onDismiss={() => setNotice('')}>{notice}</ErrorNote>
        </div>
      ) : null}

      {recording ? (
        <div className="flex items-center gap-3 p-3">
          <button
            type="button"
            className="btn-ghost !px-2 text-rose-600"
            onClick={() => stopRecording(true)}
            title="Cancel recording"
          >
            <Icon.close className="h-5 w-5" />
          </button>
          <div className="flex flex-1 items-center gap-2 rounded-xl bg-rose-500/10 px-3 py-2">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
            <span className="text-sm font-semibold text-rose-600 dark:text-rose-300">
              Recording {formatDuration(seconds)}
            </span>
            <span className="ml-auto text-xs text-ink-400">tap ✓ to send</span>
          </div>
          <button
            type="button"
            className="btn-primary !px-3"
            onClick={() => stopRecording(false)}
            title="Send voice note"
          >
            <Icon.check className="h-5 w-5" />
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex items-end gap-2 p-3">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
            className="hidden"
            onChange={pickFiles}
          />
          <button
            type="button"
            className="btn-ghost !px-2.5"
            title="Attach a file"
            onClick={() => inputRef.current?.click()}
            disabled={busy || disabled}
          >
            {busy ? <Spinner className="h-5 w-5" /> : <Icon.attach className="h-5 w-5" />}
          </button>

          <textarea
            ref={textRef}
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

          {text.trim() ? (
            <button type="submit" className="btn-primary !px-3" disabled={disabled || busy}>
              <Icon.send className="h-5 w-5" />
            </button>
          ) : (
            <button
              type="button"
              className="btn-soft !px-3"
              onClick={startRecording}
              disabled={busy || disabled}
              title="Record a voice note"
            >
              <Icon.mic className="h-5 w-5" />
            </button>
          )}
        </form>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ chat view */
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

  /** Upload a file, then send it as a message. Media always goes over REST. */
  async function sendMedia(file, forcedType) {
    const uploaded = await api.uploadMedia(file);
    const stored = uploaded?.file;
    if (!stored?.url) throw new Error('Upload did not return a file URL.');

    const type = forcedType || typeFromMime(stored.mimetype);
    const saved = await api.sendMessage({
      chatId,
      type,
      mediaUrl: stored.url,
      content: type === 'file' ? stored.originalname || file.name : undefined,
    });
    setMessages((prev) => [...prev, saved]);
    scrollToBottom();
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
            message="Say hello, attach a file or record a voice note."
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

      <Composer onSend={send} onSendMedia={sendMedia} disabled={sending} />
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

  useEffect(() => {
    if (!initialChatId?.id) return;
    setActiveId(initialChatId.id);
    load();
  }, [initialChatId, load]);

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
