import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, BookOpen, CheckCircle2, ChevronDown, Database, HardDrive, Home as HomeIcon,
  LifeBuoy, Loader2, MessageSquareText, Paperclip, Search, Send, ShieldAlert, Smile,
  ThumbsDown, ThumbsUp, UserRound, Wifi, X,
} from 'lucide-react';
import { api } from '../lib/api';
import type { HelpMessageWire } from '@chatgram/api-client';
import { useSession } from '@chatgram/core';

/**
 * Chatgram help-centre widget: Home / Messages / Help tabs.
 *
 * Everything is server-backed (`/api/help/...`): articles, search and the
 * conversations themselves, so the Messages tab survives a reload and the
 * support team can see the transcript and reply. AI answers come from the
 * existing assistant endpoint; when it is unavailable the server falls back to
 * keyword matching over the same articles.
 */

type Tab = 'home' | 'messages' | 'help';

interface ConversationSummary {
  id: string;
  status: string;
  ticketId: string | null;
  unread: number;
  lastMessageAt: string;
  preview: string;
  lastRole: string;
}

const EMOJIS = ['ðŸ˜Š', 'ðŸ‘', 'ðŸ™', 'ðŸ˜…', 'ðŸ¤”', 'â¤ï¸', 'ðŸŽ‰', 'ðŸ˜¢'];

/** Replace anything that looks like a credential before it leaves the browser. */
function maskSecrets(text: string): string {
  return text
    .replace(/(password\s*(?:is|=|:)\s*)(\S+)/gi, '$1****')
    .replace(/(code\s*(?:is|=|:)\s*)(\d{4,8})/gi, '$1****')
    .replace(/(otp\s*(?:is|=|:)\s*)(\d{4,8})/gi, '$1****');
}

function guestId(): string {
  try {
    let id = sessionStorage.getItem('chatgram.guestId');
    if (!id) {
      id = `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem('chatgram.guestId', id);
    }
    return id;
  } catch {
    return `g-${Math.random().toString(36).slice(2, 14)}`;
  }
}

const ASSISTANT_AVATAR = `${import.meta.env.BASE_URL}assistant-avatar.svg`;

function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

function AssistantAvatar({ size = 32 }: { size?: number }) {
  return (
    <img
      src={ASSISTANT_AVATAR}
      alt="Chatgram Assistant"
      width={size}
      height={size}
      className="shrink-0 rounded-full"
      style={{ width: size, height: size }}
    />
  );
}

export default function SupportWidget({ hideLauncher = false }: { hideLauncher?: boolean }) {
  const user = useSession((s) => s.user);
  const [open, setOpen] = useState(false);

  // Signed-in users open the widget from the sidebar (the floating launcher is
  // hidden there so it never covers the composer).
  useEffect(() => {
    const openHelp = () => setOpen(true);
    window.addEventListener('chatgram-open-help', openHelp);
    return () => window.removeEventListener('chatgram-open-help', openHelp);
  }, []);
  const [tab, setTab] = useState<Tab>('home');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<HelpMessageWire[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [article, setArticle] = useState<Awaited<ReturnType<typeof api.helpArticle>> | null>(null);
  const [collections, setCollections] = useState<Awaited<ReturnType<typeof api.helpCollections>>>([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Awaited<ReturnType<typeof api.helpSearch>>['results']>([]);
  const [suggested, setSuggested] = useState<{ slug: string; title: string; summary: string }[]>([]);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.statusHealth>> | null>(null);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffEmail, setHandoffEmail] = useState('');
  const [attachments, setAttachments] = useState<{ url: string; type: string; name: string; size: number }[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<number | null>(null);

  const guest = guestId();
  const isGuest = !user;
  const active = messages.length > 0 ? messages : [];
  const lastAgent = [...active].reverse().find((message) => message.role === 'agent');
  const assistantName = lastAgent ? 'Support team' : 'Chatgram Assistant';
  const assistantSubtitle = lastAgent ? lastAgent.authorName || 'Support team' : 'AI Â· usually replies instantly';
  const unreadTotal = conversations.reduce((sum, conversation) => sum + (conversation.unread || 0), 0);

  /* ------------------------------------------------------------- data loads */

  const loadConversations = useCallback(async () => {
    setLoadingConversations(true);
    try {
      const rows = await api.listHelpConversations(isGuest ? guest : undefined);
      setConversations(rows);
    } catch {
      /* the widget must keep working even if this fails */
    } finally {
      setLoadingConversations(false);
    }
  }, [guest, isGuest]);

  const loadConversation = useCallback(
    async (id: string) => {
      try {
        const data = await api.getHelpConversation(id, isGuest ? guest : undefined);
        setMessages(data.messages);
        void api.markHelpRead(id, isGuest ? guest : undefined).catch(() => {});
        void loadConversations();
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load the conversation');
      }
    },
    [guest, isGuest, loadConversations],
  );

  // Widget opened: load the home data once.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const [cols, h] = await Promise.all([api.helpCollections(), api.statusHealth().catch(() => null)]);
        if (!cancelled) {
          setCollections(cols);
          setHealth(h);
        }
        const first = await api.helpCollection('getting-started').catch(() => null);
        if (!cancelled && first) setSuggested(first.articles.slice(0, 4));
      } catch {
        /* ignore: the widget shows its own error state */
      }
      void loadConversations();
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loadConversations]);

  // Poll while open so human replies appear without a socket (guests).
  useEffect(() => {
    if (!open) return undefined;
    const interval = window.setInterval(() => {
      void loadConversations();
      if (conversationId) void loadConversation(conversationId);
    }, 6000);
    return () => window.clearInterval(interval);
  }, [open, conversationId, loadConversations, loadConversation]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (handoffOpen) setHandoffOpen(false);
      else if (article) setArticle(null);
      else setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, handoffOpen, article]);

  useEffect(() => {
    if (open && tab === 'home') {
      window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>('button, input, textarea')?.focus(), 50);
    }
  }, [open, tab]);

  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages, typing]);

  // Debounced help search.
  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    const query = search.trim();
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    searchTimer.current = window.setTimeout(async () => {
      try {
        const result = await api.helpSearch(query);
        setSearchResults(result.results);
      } catch {
        setSearchResults([]);
      }
    }, 300);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [search]);

  /* -------------------------------------------------------------- actions */

  async function ensureConversation(): Promise<string> {
    if (conversationId) return conversationId;
    const created = await api.createHelpConversation(isGuest ? guest : undefined, isGuest ? 'Guest' : user?.displayName);
    setConversationId(created.conversation.id);
    setMessages(created.conversation.messages);
    void loadConversations();
    return created.conversation.id;
  }

  async function ask(question: string) {
    const text = maskSecrets(question).trim().slice(0, 2000);
    if ((!text && attachments.length === 0) || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    setTyping(true);
    try {
      const id = await ensureConversation();
      // Optimistic user bubble.
      const optimistic: HelpMessageWire = {
        id: `tmp-${Date.now()}`,
        role: 'user',
        text,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      setInput('');
      const result = await api.postHelpMessage(id, {
        text: text || undefined,
        guestId: isGuest ? guest : undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      setAttachments([]);
      setMessages((prev) => [
        ...prev.filter((message) => message.id !== optimistic.id),
        result.message,
        result.reply,
      ]);
      void loadConversations();
    } catch (askError) {
      setError(askError instanceof Error ? askError.message : 'Could not send the message');
    } finally {
      setTyping(false);
      setBusy(false);
    }
  }

  async function openArticle(slug: string) {
    setTab('help');
    setArticle(null);
    try {
      setArticle(await api.helpArticle(slug));
    } catch (articleError) {
      setError(articleError instanceof Error ? articleError.message : 'Could not load the article');
    }
  }

  async function startConversation() {
    setError('');
    try {
      const id = await ensureConversation();
      setTab('messages');
      await loadConversation(id);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Could not start the chat');
    }
  }

  async function openConversation(id: string) {
    setConversationId(id);
    setTab('messages');
    setArticle(null);
    await loadConversation(id);
  }

  async function sendFeedback(message: HelpMessageWire, value: 'up' | 'down') {
    try {
      await api.helpFeedback(message.id, value, isGuest ? guest : undefined);
      setMessages((prev) => prev.map((row) => (row.id === message.id ? { ...row, feedback: value } : row)));
      setNotice('Thanks for the feedback.');
    } catch {
      setNotice('Could not save the feedback.');
    }
  }

  async function requestPerson() {
    setBusy(true);
    setError('');
    try {
      const id = await ensureConversation();
      const result = await api.handoffHelpConversation(
        id,
        isGuest ? guest : undefined,
        handoffEmail.trim() || user?.email || undefined,
      );
      setHandoffOpen(false);
      setNotice(`A person will reply here. Your ticket is ${result.ticketId}.`);
      await loadConversation(id);
    } catch (handoffError) {
      setError(handoffError instanceof Error ? handoffError.message : 'Could not reach a person right now');
    } finally {
      setBusy(false);
    }
  }

  async function attachFile(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      setError('Files must be 10 MB or smaller.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const result = await api.uploadHelpAttachment(file);
      setAttachments((prev) => [...prev, result.file].slice(0, 4));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not upload the file');
    } finally {
      setUploading(false);
    }
  }

  async function resolve() {
    if (!conversationId) return;
    try {
      await api.resolveHelpConversation(conversationId, isGuest ? guest : undefined);
      setNotice('Marked as resolved. Thank you!');
      await loadConversation(conversationId);
    } catch {
      setError('Could not resolve the conversation');
    }
  }

  async function removeConversation() {
    if (!conversationId) return;
    try {
      await api.deleteHelpConversation(conversationId, isGuest ? guest : undefined);
      setConversationId(null);
      setMessages([]);
      setTab('messages');
      void loadConversations();
    } catch {
      setError('Could not delete the conversation');
    }
  }

  async function emailTranscript() {
    try {
      const result = await api.emailHelpTranscript(conversationId || '', isGuest ? guest : undefined, user?.email);
      setNotice(result.delivered ? `Transcript emailed to ${result.to}.` : 'Email is not configured in this environment.');
    } catch {
      setError('Could not email the transcript');
    }
  }

  /* ----------------------------------------------------------------- render */

  return (
    <>
      {/* launcher (hidden inside the signed-in app: the sidebar opens the widget) */}
      {hideLauncher ? null : (
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? 'Close help' : 'Open help'}
        aria-expanded={open}
        className="fixed bottom-4 right-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-brand-600 text-white shadow-xl transition hover:bg-brand-700"
        data-testid="help-launcher"
      >
        {open ? <ChevronDown className="h-6 w-6" /> : <LifeBuoy className="h-6 w-6" />}
        {!open && unreadTotal > 0 ? (
          <span className="absolute right-1 top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold">
            {unreadTotal > 9 ? '9+' : unreadTotal}
          </span>
        ) : null}
      </button>
      )}

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label="Chatgram help"
          data-testid="help-widget"
          className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-ink-900 sm:inset-auto sm:bottom-20 sm:right-4 sm:h-[70vh] sm:max-h-[640px] sm:w-[400px] sm:rounded-2xl sm:border sm:border-ink-200 sm:shadow-2xl sm:dark:border-white/10"
        >
          {/* header */}
          <div className="flex items-center gap-2 rounded-t-2xl bg-gradient-to-br from-brand-600 to-brand-800 px-4 py-3 text-white">
            <AssistantAvatar size={34} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">Chatgram Assistant</p>
              <p className="truncate text-[11.5px] text-white/80">Ask about anything in the app</p>
            </div>
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/15"
              onClick={() => setOpen(false)}
              aria-label="Close help"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* tabs */}
          <nav className="flex border-b border-ink-200 text-[13px] font-semibold dark:border-white/10" aria-label="Help sections">
            {([
              ['home', 'Home', HomeIcon],
              ['messages', 'Messages', MessageSquareText],
              ['help', 'Help', BookOpen],
            ] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setTab(key);
                  setArticle(null);
                }}
                aria-current={tab === key ? 'page' : undefined}
                className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 ${
                  tab === key
                    ? 'border-b-2 border-brand-600 text-brand-700 dark:text-brand-300'
                    : 'text-ink-500 dark:text-ink-400'
                }`}
              >
                <Icon className="h-4 w-4" /> {label}
                {key === 'messages' && unreadTotal > 0 ? (
                  <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">{unreadTotal}</span>
                ) : null}
              </button>
            ))}
          </nav>

          {/* body */}
          <div className="no-scrollbar flex-1 overflow-y-auto">
            {error ? (
              <p role="alert" className="m-3 rounded-xl border border-rose-300/50 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p role="status" aria-live="polite" className="m-3 rounded-xl border border-emerald-300/50 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                {notice}
              </p>
            ) : null}

            {/* ---------------------------------------------------- HOME */}
            {tab === 'home' ? (
              <div className="pb-4">
                <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-4 pb-5 pt-4 text-white">
                  <p className="text-lg font-bold">
                    {user ? `Hello ${String(user.displayName || '').split(' ')[0]}! How can we help?` : 'Hello! How can we help?'}
                  </p>
                  <p className="mt-1 text-[12.5px] text-white/80">
                    Search the help articles or start a chat with the assistant.
                  </p>
                  <div className="relative mt-3">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-400" />
                    <input
                      className="field pl-9"
                      placeholder="Search for help"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') setTab('help');
                      }}
                      aria-label="Search for help"
                    />
                  </div>
                </div>

                {/* recent message */}
                {conversations[0] ? (
                  <button
                    type="button"
                    onClick={() => void openConversation(conversations[0]?.id ?? '')}
                    className="mx-3 mt-3 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-xl border border-ink-200 p-3 text-left hover:bg-ink-100/70 dark:border-white/10 dark:hover:bg-white/5"
                  >
                    <AssistantAvatar size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">
                        Recent message
                      </span>
                      <span className="block truncate text-[12.5px]">{conversations[0].preview || 'Continue your conversation'}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-400">{relativeTime(conversations[0].lastMessageAt)}</span>
                  </button>
                ) : null}

                {/* status card */}
                <div className="mx-3 mt-3 rounded-xl border border-ink-200 p-3 dark:border-white/10">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">Status</p>
                  <div className="mt-1 grid grid-cols-3 gap-1 text-[11.5px]">
                    <StatusCell Icon={Database} label="Database" state={health?.database} />
                    <StatusCell Icon={Wifi} label="Realtime" state={health?.socket} />
                    <StatusCell Icon={HardDrive} label="Media" state={health?.storage} />
                  </div>
                  <p className="mt-1.5 text-[11px] text-ink-500 dark:text-ink-400">
                    {health?.ok ? 'All systems operational.' : 'Some services may be degraded â€” support can still help.'}
                  </p>
                </div>

                {/* suggested articles */}
                <div className="mx-3 mt-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">Suggested articles</p>
                  {suggested.length === 0 ? (
                    <p className="mt-1 text-[12px] text-ink-500">Loading articlesâ€¦</p>
                  ) : (
                    suggested.map((item) => (
                      <button
                        key={item.slug}
                        type="button"
                        onClick={() => void openArticle(item.slug)}
                        className="mt-1 flex w-full items-start gap-2 rounded-lg p-2 text-left hover:bg-ink-100 dark:hover:bg-white/5"
                      >
                        <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold">{item.title}</span>
                          <span className="block truncate text-[11.5px] text-ink-500 dark:text-ink-400">{item.summary}</span>
                        </span>
                      </button>
                    ))
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void startConversation()}
                  className="btn-primary mx-3 mt-4 w-[calc(100%-1.5rem)]"
                  data-testid="ask-question"
                >
                  <MessageSquareText className="h-4 w-4" /> Ask a question
                </button>
              </div>
            ) : null}

            {/* ------------------------------------------------ MESSAGES */}
            {tab === 'messages' ? (
              conversationId && active.length > 0 ? (
                <div className="flex h-full flex-col">
                  <div className="flex items-center gap-2 border-b border-ink-200 px-2 py-2 dark:border-white/10">
                    <button type="button" className="btn-ghost !px-2" onClick={() => { setConversationId(null); setMessages([]); }} aria-label="Back to messages">
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                    <AssistantAvatar size={30} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold">{assistantName}</p>
                      <p className="truncate text-[11px] text-ink-500 dark:text-ink-400">{assistantSubtitle}</p>
                    </div>
                    {conversations.find((c) => c.id === conversationId)?.ticketId ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                        {conversations.find((c) => c.id === conversationId)?.ticketId}
                      </span>
                    ) : null}
                  </div>

                  <p className="border-b border-ink-200 bg-ink-100/70 px-3 py-1.5 text-[10.5px] text-ink-600 dark:border-white/10 dark:bg-white/5 dark:text-ink-300">
                    <ShieldAlert className="mr-1 inline h-3 w-3" />
                    This chat session is recorded and may be reviewed by Chatgram. Never share your password.
                  </p>

                  <div ref={scrollerRef} className="flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite" data-testid="help-messages">
                    {active.map((message) => (
                      <HelpBubble
                        key={message.id}
                        message={message}
                        onArticle={(slug) => void openArticle(slug)}
                        onFeedback={(value) => void sendFeedback(message, value)}
                      />
                    ))}
                    {typing ? (
                      <p className="flex items-center gap-1 text-[11px] text-ink-500" aria-label="Assistant is typing">
                        <Loader2 className="h-3 w-3 animate-spin" /> Chatgram Assistant is typingâ€¦
                      </p>
                    ) : null}
                  </div>

                  {active.filter((message) => message.role === 'assistant').length >= 3 && !lastAgent ? (
                    <button
                      type="button"
                      onClick={() => setHandoffOpen(true)}
                      className="mx-3 mb-1 rounded-lg border border-brand-600/40 py-1.5 text-[12px] font-semibold text-brand-700 hover:bg-brand-600/10 dark:text-brand-300"
                    >
                      <UserRound className="mr-1 inline h-3.5 w-3.5" /> Talk to a person
                    </button>
                  ) : null}

                  {attachments.length > 0 ? (
                    <div className="flex gap-1 px-3 pb-1">
                      {attachments.map((attachment) => (
                        <span key={attachment.url} className="truncate rounded bg-ink-100 px-2 py-1 text-[10.5px] dark:bg-white/10">
                          {attachment.name || attachment.type}
                          <button type="button" className="ml-1 text-rose-500" onClick={() => setAttachments((prev) => prev.filter((row) => row.url !== attachment.url))} aria-label="Remove attachment">
                            Ã—
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="border-t border-ink-200 p-2 dark:border-white/10">
                    <div className="flex items-end gap-1">
                      <input
                        ref={fileRef}
                        type="file"
                        className="hidden"
                        accept="image/*,application/pdf,.doc,.docx,.txt"
                        onChange={(event) => {
                          const picked = event.target.files?.[0];
                          event.target.value = '';
                          if (picked) void attachFile(picked);
                        }}
                      />
                      <button type="button" className="btn-ghost !px-2" onClick={() => fileRef.current?.click()} aria-label="Attach a file" disabled={uploading}>
                        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                      </button>
                      <button type="button" className="btn-ghost !px-2" onClick={() => setEmojiOpen((value) => !value)} aria-label="Insert emoji">
                        <Smile className="h-4 w-4" />
                      </button>
                      <textarea
                        ref={inputRef}
                        rows={1}
                        className="field max-h-24 min-h-[38px] flex-1 resize-none py-2"
                        placeholder="Type your message"
                        value={input}
                        onChange={(event) => setInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            void ask(input);
                          }
                        }}
                        aria-label="Message"
                      />
                      <button
                        type="button"
                        className="btn-primary !px-3"
                        onClick={() => void ask(input)}
                        disabled={busy || (!input.trim() && attachments.length === 0)}
                        aria-label="Send message"
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </button>
                    </div>
                    {emojiOpen ? (
                      <div className="mt-1 flex gap-1">
                        {EMOJIS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            className="rounded px-1 text-lg hover:bg-ink-100 dark:hover:bg-white/10"
                            onClick={() => {
                              setInput((value) => value + emoji);
                              setEmojiOpen(false);
                              inputRef.current?.focus();
                            }}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-1 flex gap-2 text-[11px] text-ink-500 dark:text-ink-400">
                      <button type="button" className="hover:underline" onClick={() => setHandoffOpen(true)}>Talk to a person</button>
                      <button type="button" className="hover:underline" onClick={() => void resolve()}>Mark resolved</button>
                      <button type="button" className="hover:underline" onClick={() => void emailTranscript()}>Email transcript</button>
                      <button type="button" className="ml-auto text-rose-500 hover:underline" onClick={() => void removeConversation()}>Delete</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3">
                  {loadingConversations ? (
                    <p className="flex items-center gap-2 text-[12px] text-ink-500">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading your messagesâ€¦
                    </p>
                  ) : conversations.length === 0 ? (
                    <div className="py-10 text-center">
                      <MessageSquareText className="mx-auto h-9 w-9 text-ink-300 dark:text-ink-600" />
                      <p className="mt-2 font-semibold">No conversations yet</p>
                      <p className="mt-1 text-[12px] text-ink-500 dark:text-ink-400">
                        Ask a question and it will appear here.
                      </p>
                    </div>
                  ) : (
                    conversations.map((conversation) => (
                      <button
                        key={conversation.id}
                        type="button"
                        onClick={() => void openConversation(conversation.id)}
                        className="mb-1 flex w-full items-start gap-2 rounded-xl p-2 text-left hover:bg-ink-100/70 dark:hover:bg-white/5"
                      >
                        <AssistantAvatar size={30} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-1">
                            <span className={`truncate text-[13px] ${conversation.unread > 0 ? 'font-bold' : 'font-semibold'}`}>
                              {conversation.ticketId ? `Support Â· ${conversation.ticketId}` : 'Chatgram Assistant'}
                            </span>
                            <span className="ml-auto shrink-0 text-[10.5px] text-ink-400">{relativeTime(conversation.lastMessageAt)}</span>
                          </span>
                          <span className="mt-0.5 flex items-center gap-1">
                            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-500 dark:text-ink-400">{conversation.preview}</span>
                            {conversation.unread > 0 ? (
                              <span className="grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
                                {conversation.unread}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </button>
                    ))
                  )}
                  <button type="button" className="btn-primary mt-3 w-full" onClick={() => void startConversation()}>
                    <MessageSquareText className="h-4 w-4" /> Ask a question
                  </button>
                </div>
              )
            ) : null}

            {/* ---------------------------------------------------- HELP */}
            {tab === 'help' ? (
              <div className="p-3">
                {article ? (
                  <div>
                    <button type="button" className="btn-ghost !px-2 text-[12px]" onClick={() => setArticle(null)}>
                      <ArrowLeft className="h-4 w-4" /> Back
                    </button>
                    <p className="mt-2 text-[11px] font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">
                      {article.collectionTitle}
                    </p>
                    <h3 className="mt-0.5 text-lg font-bold">{article.title}</h3>
                    <p className="mt-1 text-[12.5px] text-ink-500 dark:text-ink-400">{article.summary}</p>
                    <div className="mt-3 space-y-2 text-[13px] leading-relaxed" data-testid="help-article-body">
                      {article.body.split(/\n\s*\n/).map((paragraph, index) => (
                        <p key={index} className="whitespace-pre-wrap">{paragraph}</p>
                      ))}
                    </div>
                    <div className="mt-4 rounded-xl border border-ink-200 p-2.5 dark:border-white/10">
                      <p className="text-[12px] font-semibold">Was this helpful?</p>
                      <div className="mt-1 flex gap-2">
                        <button type="button" className="btn-ghost !py-1 text-[12px]" onClick={() => setNotice('Thanks for letting us know!')}>
                          <ThumbsUp className="h-3.5 w-3.5" /> Yes
                        </button>
                        <button type="button" className="btn-ghost !py-1 text-[12px]" onClick={() => void startConversation()}>
                          <ThumbsDown className="h-3.5 w-3.5" /> Not really
                        </button>
                      </div>
                    </div>
                    <button type="button" className="btn-primary mt-3 w-full" onClick={() => void startConversation()}>
                      Still need help? Ask a question
                    </button>
                    {article.related.length > 0 ? (
                      <div className="mt-3">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">Related</p>
                        {article.related.map((related) => (
                          <button
                            key={related.slug}
                            type="button"
                            className="mt-1 block w-full truncate text-left text-[12.5px] text-brand-600 hover:underline dark:text-brand-300"
                            onClick={() => void openArticle(related.slug)}
                          >
                            {related.title}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-400" />
                      <input
                        className="field pl-9"
                        placeholder="Search help articles"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        aria-label="Search help articles"
                        data-testid="help-search"
                      />
                    </div>

                    {search.trim().length >= 2 ? (
                      <div className="mt-2">
                        {searchResults.length === 0 ? (
                          <p className="py-6 text-center text-[12px] text-ink-500 dark:text-ink-400">
                            No articles matched â€œ{search.trim()}â€. Ask the assistant instead.
                          </p>
                        ) : (
                          searchResults.map((result) => (
                            <button
                              key={result.slug}
                              type="button"
                              onClick={() => void openArticle(result.slug)}
                              className="mb-1 block w-full rounded-lg p-2 text-left hover:bg-ink-100 dark:hover:bg-white/5"
                            >
                              <span className="block text-[13px] font-semibold">{result.title}</span>
                              <span className="mt-0.5 block text-[11.5px] text-ink-500 dark:text-ink-400">{result.snippet}</span>
                            </button>
                          ))
                        )}
                      </div>
                    ) : (
                      <div className="mt-2">
                        {collections.map((collection) => (
                          <button
                            key={collection.slug}
                            type="button"
                            onClick={() => void openCollection(collection.slug)}
                            className="mb-1 flex w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-ink-100 dark:hover:bg-white/5"
                          >
                            <BookOpen className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-semibold">{collection.title}</span>
                              <span className="block text-[11px] text-ink-500 dark:text-ink-400">
                                {collection.articleCount} article{collection.articleCount === 1 ? '' : 's'}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {handoffOpen ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Talk to a person">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-ink-800">
            <h3 className="text-lg font-bold">Talk to a person</h3>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
              We will open a ticket for the Chatgram team. Replies appear in this chat.
            </p>
            <label className="label mt-3" htmlFor="handoff-email">Your email (so we can reply)</label>
            <input
              id="handoff-email"
              className="field"
              placeholder="you@example.com"
              value={handoffEmail || user?.email || ''}
              onChange={(event) => setHandoffEmail(event.target.value)}
            />
            <div className="mt-3 flex gap-2">
              <button type="button" className="btn-primary flex-1" onClick={() => void requestPerson()} disabled={busy}>
                {busy ? 'Sendingâ€¦' : 'Send to the team'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setHandoffOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  // Collections open by searching for their first article list.
  async function openCollection(slug: string) {
    try {
      const collection = await api.helpCollection(slug);
      const first = collection.articles[0];
      if (first) {
        await openArticle(first.slug);
      }
    } catch {
      setError('Could not load the collection');
    }
  }
}

function StatusCell({
  Icon,
  label,
  state,
}: {
  Icon: typeof Database;
  label: string;
  state?: string;
}) {
  const ok = Boolean(state) && !['unavailable', 'disabled', 'error'].includes(String(state));
  return (
    <span className="flex items-center gap-1">
      <Icon className="h-3.5 w-3.5" />
      <span className="flex-1 truncate">{label}</span>
      <span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-rose-500'}`} aria-label={ok ? `${label} ok` : `${label} unavailable`} />
    </span>
  );
}

function HelpBubble({
  message,
  onArticle,
  onFeedback,
}: {
  message: HelpMessageWire;
  onArticle: (slug: string) => void;
  onFeedback: (value: 'up' | 'down') => void;
}) {
  if (message.role === 'system') {
    return (
      <p className="mx-auto max-w-[90%] rounded-full bg-ink-200/70 px-3 py-1 text-center text-[11px] font-medium text-ink-700 dark:bg-white/10 dark:text-ink-200">
        {message.text}
      </p>
    );
  }
  const mine = message.role === 'user';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`} data-testid={`help-message-${message.role}`}>
      <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] ${mine ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-800 dark:bg-ink-700 dark:text-ink-100'}`}>
        {!mine ? (
          <p className="mb-0.5 text-[10.5px] font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">
            {message.authorName || (message.role === 'agent' ? 'Support team' : 'Chatgram Assistant')}
          </p>
        ) : null}
        {message.text ? <p className="whitespace-pre-wrap break-words">{message.text}</p> : null}
        {message.attachments && message.attachments.length > 0 ? (
          <div className="mt-1 space-y-1">
            {message.attachments.map((attachment) => (
              <a
                key={attachment.url}
                href={attachment.url}
                target="_blank"
                rel="noreferrer noopener"
                className={`block truncate text-[11px] underline ${mine ? 'text-white' : 'text-brand-700 dark:text-brand-300'}`}
              >
                {attachment.type === 'image' ? 'ðŸ–¼ï¸ ' : 'ðŸ“Ž '}
                {attachment.name || attachment.type}
              </a>
            ))}
          </div>
        ) : null}
        {message.articleSlug ? (
          <button
            type="button"
            onClick={() => onArticle(message.articleSlug || '')}
            className={`mt-1.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              mine ? 'bg-white/20 text-white' : 'bg-brand-600/10 text-brand-700 dark:text-brand-300'
            }`}
          >
            <BookOpen className="h-3 w-3" /> Read the article
          </button>
        ) : null}
        {!mine && message.role === 'assistant' ? (
          <div className="mt-1 flex items-center gap-2 text-[11px] opacity-70">
            <button type="button" onClick={() => onFeedback('up')} aria-label="Helpful" className={message.feedback === 'up' ? 'text-emerald-500' : ''}>
              <ThumbsUp className="h-3 w-3" />
            </button>
            <button type="button" onClick={() => onFeedback('down')} aria-label="Not helpful" className={message.feedback === 'down' ? 'text-rose-500' : ''}>
              <ThumbsDown className="h-3 w-3" />
            </button>
            <span className="ml-auto flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Chatgram Assistant Â· AI
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

