import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Copy, RefreshCw, Reply, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { usePrefs } from '@chatgram/core';
import { api } from '../lib/api';
import { aiThread, useAiThread } from '../lib/aiThread';
import { ChatHeader } from './ChatHeader';
import Composer from './Composer';
import { dateSeparatorLabel, formatTime, sameDay } from '../lib/ui';

/**
 * Chatgram AI as a normal Chatgram conversation (Change 1).
 *
 * This renders inside the same two-column shell as a person's chat and shares
 * the real ChatHeader and Composer components with ChatWindow, so the AI thread
 * gets the same header, wallpaper, input box, emoji picker, timestamps and dark
 * theme. Only the message body renderer differs: AI answers are markdown.
 */

const SUGGESTIONS = [
  'Explain photosynthesis in simple words',
  'Translate "good morning" to Kinyarwanda, French and Swahili',
  'Write a short polite message asking a client for a meeting',
  'Help me fix a JavaScript bug: my array filter returns undefined',
];

const DISCLAIMER = 'Chatgram AI can make mistakes. Messages are processed by a third-party AI provider.';

/**
 * The hidden `[[CHATGRAM_UNKNOWN: …]]` learning marker is stripped on the server,
 * but it becomes visible while the answer is still streaming. Hide it here too so
 * it can never flash in the bubble (and never be copied or shared).
 */
const LEARNING_MARKER = /\[\[CHATGRAM_UNKNOWN:[\s\S]*?\]\]/gi;
function visibleText(content: string): string {
  return String(content || '').replace(LEARNING_MARKER, '').trimEnd();
}

type AiMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  serverId?: string;
  at?: string;
  replyTo?: { name: string; preview: string } | null;
};

type Conversation = { id: string; title: string; updatedAt: string; lastMessage: string };
type HistoryMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt?: string };

/* ------------------------------------------------------------- markdown */

function inlineNodes(text: string, keyPrefix: string): React.ReactNode[] {
  // Bold, italic and inline code only; every plain part stays a React text node,
  // so model output can never inject HTML (XSS test relies on this).
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b-${index}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(
        <code key={`${keyPrefix}-c-${index}`} className="rounded bg-ink-200/60 px-1 py-0.5 font-mono text-[12px] dark:bg-white/10">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(<em key={`${keyPrefix}-i-${index}`}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type Block =
  | { kind: 'code'; lang: string; body: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'heading'; body: string }
  | { kind: 'paragraph'; body: string };

function parseBlocks(source: string): Block[] {
  const lines = source.split('\n');
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      index += 1; // closing fence
      blocks.push({ kind: 'code', lang, body: body.join('\n') });
      continue;
    }
    if (/^([-*•])\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^([-*•])\s+/.test((lines[index] ?? '').trim())) {
        items.push((lines[index] ?? '').trim().replace(/^([-*•])\s+/, ''));
        index += 1;
      }
      blocks.push({ kind: 'list', ordered: false, items });
      continue;
    }
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+[.)]\s+/.test((lines[index] ?? '').trim())) {
        items.push((lines[index] ?? '').trim().replace(/^\d+[.)]\s+/, ''));
        index += 1;
      }
      blocks.push({ kind: 'list', ordered: true, items });
      continue;
    }
    if (/^#{1,4}\s+/.test(trimmed)) {
      blocks.push({ kind: 'heading', body: trimmed.replace(/^#{1,4}\s+/, '') });
      index += 1;
      continue;
    }
    if (!trimmed) {
      index += 1;
      continue;
    }
    const body: string[] = [];
    while (index < lines.length) {
      const row = lines[index] ?? '';
      const rowTrimmed = row.trim();
      if (!rowTrimmed) break;
      if (rowTrimmed.startsWith('```') || /^([-*•])\s+/.test(rowTrimmed) || /^\d+[.)]\s+/.test(rowTrimmed) || /^#{1,4}\s+/.test(rowTrimmed)) break;
      body.push(row);
      index += 1;
    }
    blocks.push({ kind: 'paragraph', body: body.join('\n') });
  }
  return blocks;
}

function CodeBlock({ block }: { block: Extract<Block, { kind: 'code' }> }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-1.5 overflow-hidden rounded-xl border border-ink-200 bg-ink-100/70 dark:border-white/10 dark:bg-black/30">
      <div className="flex items-center justify-between border-b border-ink-200/70 px-2.5 py-1 dark:border-white/10">
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-ink-500 dark:text-ink-400">{block.lang || 'code'}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-100"
          aria-label="Copy code block"
          onClick={() => {
            void navigator.clipboard?.writeText(block.body);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          <Copy className="h-3 w-3" /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto px-2.5 py-2 text-[12.5px] leading-relaxed">
        <code className="font-mono">{block.body}</code>
      </pre>
    </div>
  );
}

function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <div className="space-y-1.5 text-[14px] leading-relaxed" data-testid="ai-markdown">
      {blocks.map((block, index) => {
        if (block.kind === 'code') return <CodeBlock key={index} block={block} />;
        if (block.kind === 'heading') {
          return (
            <p key={index} className="font-bold text-ink-900 dark:text-white">
              {inlineNodes(block.body, `h${index}`)}
            </p>
          );
        }
        if (block.kind === 'list') {
          return block.ordered ? (
            <ol key={index} className="list-decimal space-y-0.5 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inlineNodes(item, `ol${index}-${itemIndex}`)}</li>
              ))}
            </ol>
          ) : (
            <ul key={index} className="list-disc space-y-0.5 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inlineNodes(item, `ul${index}-${itemIndex}`)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index} className="whitespace-pre-wrap break-words">
            {inlineNodes(block.body, `p${index}`)}
          </p>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- thread */

export function AiThread({
  onBack,
  initialQuestion,
  onQuestionHandled,
}: {
  onBack: () => void;
  /** Query handed over by the "Ask Chatgram AI" row in the chat search box. */
  initialQuestion?: string | null;
  onQuestionHandled?: () => void;
}) {
  const timeFormat = usePrefs((s) => s.timeFormat);
  const pinned = useAiThread((s) => s.pinned);

  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [votes, setVotes] = useState<Record<string, 'up' | 'down'>>({});
  const [replyTo, setReplyTo] = useState<{ id: string; name: string; preview: string } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [inChatSearch, setInChatSearch] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const lastUserText = useRef('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    aiThread.setViewing(true);
    aiThread.markRead();
    return () => aiThread.setViewing(false);
  }, []);

  // Reopen the most recent conversation so history really persists across
  // devices; "New conversation" starts a fresh one without deleting it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.request<{ conversations: Conversation[] }>('/api/ai/conversations');
        if (cancelled) return;
        const list = data.conversations ?? [];
        setConversations(list);
        const latest = list[0];
        if (!latest) {
          aiThread.setPreview('Ask anything — questions, writing, code or Chatgram help.', null);
          return;
        }
        aiThread.setPreview(latest.lastMessage || 'Chatgram AI', latest.updatedAt ?? null);
        const history = await api.request<{ messages: HistoryMessage[] }>(`/api/ai/conversations/${latest.id}/messages`);
        if (cancelled) return;
        // Never overwrite anything the user already started: a suggestion pill or
        // a handed-over search query may have sent a message while history loaded.
        setConversationId((previous) => previous ?? latest.id);
        setMessages((previous) =>
          previous.length > 0
            ? previous
            : (history.messages ?? []).map((message) => ({
                id: `h-${message.id}`,
                serverId: message.id,
                role: message.role,
                content: message.content,
                at: message.createdAt,
              })),
        );
      } catch {
        /* offline: the composer still works when the request retries */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const streamReply = useCallback(
    async (prompt: string, options?: { appendUser?: boolean; quote?: { name: string; preview: string } | null }) => {
      if (!prompt.trim()) return;
      setError('');
      setNotice(null);
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const assistantId = `a-${Date.now()}`;
      if (options?.appendUser !== false) {
        setMessages((prev) => [
          ...prev,
          {
            id: `u-${Date.now()}`,
            role: 'user',
            content: prompt,
            at: new Date().toISOString(),
            replyTo: options?.quote ?? null,
          },
          { id: assistantId, role: 'assistant', content: '', streaming: true, at: new Date().toISOString() },
        ]);
      } else {
        setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', streaming: true, at: new Date().toISOString() }]);
      }

      try {
        const token = api.accessToken;
        const response = await fetch('/api/ai/messages/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ conversationId: conversationId ?? undefined, text: prompt }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error('Chatgram AI is unavailable right now.');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let settled = false;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';
          for (const event of events) {
            const line = event.split('\n').find((entry) => entry.startsWith('data: '));
            if (!line) continue;
            const payload = JSON.parse(line.slice(6)) as {
              delta?: string;
              error?: string;
              done?: boolean;
              conversationId?: string;
              messageId?: string;
              reply?: string;
            };
            if (payload.error) throw new Error(payload.error);
            if (payload.delta) {
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === assistantId ? { ...message, content: message.content + payload.delta } : message,
                ),
              );
            }
            if (payload.done) {
              settled = true;
              setConversationId(payload.conversationId ?? null);
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === assistantId
                    ? {
                        ...message,
                        streaming: false,
                        serverId: payload.messageId ?? undefined,
                        content: payload.reply ?? message.content,
                      }
                    : message,
                ),
              );
              const answer = payload.reply ?? '';
              aiThread.publishAnswer({ preview: answer, fromServer: true });
              if (answer) {
                api
                  .request<{ conversations: Conversation[] }>('/api/ai/conversations')
                  .then((data) => setConversations(data.conversations ?? []))
                  .catch(() => undefined);
              }
            }
          }
        }
        if (!settled) {
          setMessages((prev) => prev.filter((message) => message.id !== assistantId || message.content));
        }
      } catch (err) {
        // A user-initiated Clear chat / New conversation aborts the stream on
        // purpose: no error banner, just drop the half-written bubble.
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Chatgram AI is unavailable right now.');
        }
        setMessages((prev) => prev.filter((message) => message.id !== assistantId));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setBusy(false);
      }
    },
    [conversationId],
  );

  const send = useCallback(
    (text: string) => {
      const body = text.trim();
      if (!body || busy) return;
      lastUserText.current = body;
      setDraft('');
      const quote = replyTo;
      setReplyTo(null);
      const prompt = quote ? `> ${quote.name}: ${quote.preview}\n${body}` : body;
      void streamReply(prompt, { appendUser: true, quote });
    },
    [busy, replyTo, streamReply],
  );

  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => {
    function onAsk(event: Event) {
      const text = String((event as CustomEvent<{ text?: string }>).detail?.text || '').trim();
      if (text) sendRef.current(text);
    }
    window.addEventListener('chatgram-ai-ask', onAsk);
    return () => window.removeEventListener('chatgram-ai-ask', onAsk);
  }, []);

  // A question handed over by the "Ask Chatgram AI" row in the chat search box
  // (the row dispatches before this thread mounts, so it arrives as a prop).
  const consumedQuestion = useRef<string | null>(null);
  useEffect(() => {
    const question = initialQuestion?.trim();
    if (!question || consumedQuestion.current === question) return;
    consumedQuestion.current = question;
    sendRef.current(question);
    onQuestionHandled?.();
  }, [initialQuestion, onQuestionHandled]);

  async function vote(message: AiMessage, value: 'up' | 'down') {
    if (!message.serverId) {
      setNotice('Feedback is available once the answer finishes.');
      return;
    }
    setVotes((prev) => ({ ...prev, [message.id]: value }));
    try {
      const token = api.accessToken;
      const response = await fetch(`/api/ai/messages/${encodeURIComponent(message.serverId)}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ value }),
      });
      setNotice(response.ok ? (value === 'down' ? 'Thanks — the Chatgram team will look at this answer.' : 'Thanks for the feedback.') : 'Could not save the feedback.');
    } catch {
      setNotice('Could not save the feedback.');
    }
  }

  function regenerate() {
    if (busy) return;
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    if (!lastUser) return;
    lastUserText.current = lastUser.content;
    setMessages((prev) => {
      const copy = [...prev];
      while (copy.length > 0 && copy[copy.length - 1]?.role === 'assistant') copy.pop();
      return copy;
    });
    void streamReply(lastUser.content, { appendUser: false });
  }

  function newConversation() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setConversationId(null);
    setMessages([]);
    setReplyTo(null);
    setError('');
    setNotice('Started a new conversation.');
    aiThread.setPreview('', null);
  }

  async function clearChat() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    if (!conversationId) {
      newConversation();
      return;
    }
    if (busy) return;
    try {
      await api.request(`/api/ai/conversations/${conversationId}`, { method: 'DELETE' });
      setConversationId(null);
      setMessages([]);
      setError('');
      setNotice('Chat cleared.');
      setConversations((prev) => prev.filter((conversation) => conversation.id !== conversationId));
      aiThread.setPreview('', null);
    } catch {
      setError('Could not clear this chat.');
    }
  }

  async function loadConversation(id: string) {
    if (busy) return;
    setHistoryOpen(false);
    setBusy(true);
    setError('');
    try {
      const data = await api.request<{ messages: HistoryMessage[] }>(`/api/ai/conversations/${id}/messages`);
      setConversationId(id);
      setReplyTo(null);
      setMessages(
        (data.messages ?? []).map((message) => ({
          id: `h-${message.id}`,
          serverId: message.id,
          role: message.role,
          content: message.content,
          at: message.createdAt,
        })),
      );
      const summary = conversations.find((conversation) => conversation.id === id);
      if (summary) aiThread.setPreview(summary.lastMessage, summary.updatedAt ?? null);
    } catch {
      setError('Could not open that conversation.');
    } finally {
      setBusy(false);
    }
  }

  const visibleMessages = inChatSearch.trim()
    ? messages.filter((message) => message.content.toLowerCase().includes(inChatSearch.trim().toLowerCase()))
    : messages;
  const lastAssistantId = [...messages].reverse().find((message) => message.role === 'assistant')?.id;
  const typing = busy && messages.length > 0 && messages[messages.length - 1]?.role === 'assistant' && !messages[messages.length - 1]?.content;
  const userName = 'You';

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="ai-thread" data-busy={busy ? 'true' : 'false'}>
      <ChatHeader
        ai={{
          title: 'Chatgram AI',
          subtitle: 'AI',
          avatarUrl: '/web/assistant-avatar.svg',
          typing,
        }}
        connected
        timeFormat={timeFormat}
        inChatSearchOpen={searchOpen}
        onToggleSearch={() => {
          setSearchOpen((value) => !value);
          setInChatSearch('');
        }}
        menu={{
          onNewConversation: newConversation,
          onHistory: () => setHistoryOpen(true),
          onSearch: () => setSearchOpen(true),
          onMute: () => {
            const next = aiThread.toggleMuted();
            setNotice(next ? 'Chatgram AI notifications muted.' : 'Chatgram AI notifications unmuted.');
          },
          onPin: () => {
            const next = aiThread.togglePinned();
            setNotice(next ? 'Chatgram AI pinned to the top of your chats.' : 'Chatgram AI unpinned.');
          },
          pinned,
          onClearChat: () => void clearChat(),
        }}
        onBack={onBack}
      />

      {searchOpen ? (
        <div className="relative border-b border-ink-200 px-3 py-2 dark:border-white/10">
          <input
            className="field"
            placeholder="Search in this chat"
            autoFocus
            value={inChatSearch}
            onChange={(event) => setInChatSearch(event.target.value)}
            aria-label="Search in this chat"
          />
        </div>
      ) : null}

      <div className="no-scrollbar relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1000px] flex-col px-4 py-4">
          <div
            className="mx-auto mb-3 w-full max-w-2xl rounded-xl border border-ink-200 bg-ink-50 px-3 py-2 text-center text-[11.5px] text-ink-600 dark:border-white/10 dark:bg-white/[.04] dark:text-ink-300"
            data-testid="ai-disclaimer"
          >
            {DISCLAIMER}
          </div>

          {messages.length === 0 ? (
            <div
              className="mx-auto mt-2 max-w-md rounded-2xl border border-ink-200 bg-white px-4 py-3 text-center text-[13px] text-ink-600 dark:border-white/10 dark:bg-white/[.03] dark:text-ink-300"
              data-testid="ai-intro"
            >
              <div className="mx-auto mb-1.5 grid h-10 w-10 place-items-center rounded-full bg-brand-600 text-white">
                <Bot className="h-5 w-5" />
              </div>
              <p className="font-semibold text-ink-800 dark:text-ink-100">Chatgram AI</p>
              <p className="mt-0.5">Ask anything — questions, writing, translations (EN/RW/FR/SW), summaries, code or Chatgram help.</p>
            </div>
          ) : null}

          {visibleMessages.map((message, index) => {
            const previous = visibleMessages[index - 1];
            const newDay = !previous || !sameDay(previous.at, message.at);
            return (
              <div key={message.id}>
                {newDay && message.at ? (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-full bg-ink-200/80 px-3 py-1 text-[11px] font-semibold text-ink-700 dark:bg-white/10 dark:text-ink-200">
                      {dateSeparatorLabel(message.at)}
                    </span>
                  </div>
                ) : null}

                {message.role === 'user' ? (
                  <div className="group mb-2 flex justify-end" data-testid="ai-message-user">
                    <div className="max-w-[85%]">
                      <div className="rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-[14px] text-white shadow-sm">
                        {message.replyTo ? (
                          <div className="mb-1 rounded-lg border-l-2 border-white/60 bg-black/15 px-2 py-1 text-[11.5px] text-white/90">
                            <span className="font-semibold">{message.replyTo.name}</span>
                            <span className="block truncate">{message.replyTo.preview}</span>
                          </div>
                        ) : null}
                        <p className="whitespace-pre-wrap break-words">{message.content}</p>
                      </div>
                      <div className="mt-0.5 flex justify-end gap-2 text-[10.5px] text-ink-500 dark:text-ink-400">
                        <span>{formatTime(message.at, timeFormat)}</span>
                        <button
                          type="button"
                          className="opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                          onClick={() => setReplyTo({ id: message.id, name: userName, preview: visibleText(message.content).slice(0, 120) })}
                          aria-label="Reply to this message"
                        >
                          <Reply className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="group mb-2 flex justify-start" data-testid="ai-message-assistant">
                    <div className="flex max-w-[88%] gap-2">
                      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-600 text-white">
                        <img src="/web/assistant-avatar.svg" alt="" className="h-full w-full object-cover" />
                      </span>
                      <div className="min-w-0">
                        <div className="rounded-2xl rounded-bl-md border border-ink-200 bg-white px-3.5 py-2 text-ink-800 shadow-sm dark:border-white/10 dark:bg-ink-700 dark:text-ink-100">
                          {message.content ? (
                            <Markdown text={visibleText(message.content)} />
                          ) : (
                            <span className="flex items-center gap-1 py-1">
                              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-400" />
                              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-400 [animation-delay:120ms]" />
                              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-400 [animation-delay:240ms]" />
                            </span>
                          )}
                        </div>
                        {message.content && !message.streaming ? (
                          <div className="mt-1 flex flex-wrap items-center gap-2.5 text-[11px] text-ink-500 dark:text-ink-400">
                            <span>{formatTime(message.at, timeFormat)}</span>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 hover:text-ink-700 dark:hover:text-ink-100"
                              aria-label="Copy answer"
                              onClick={() => {
                                void navigator.clipboard?.writeText(visibleText(message.content));
                                setNotice('Answer copied.');
                              }}
                            >
                              <Copy className="h-3 w-3" /> Copy
                            </button>
                            <button
                              type="button"
                              className={`inline-flex items-center gap-1 ${votes[message.id] === 'up' ? 'text-emerald-600 dark:text-emerald-400' : 'hover:text-ink-700 dark:hover:text-ink-100'}`}
                              aria-label="Good answer"
                              onClick={() => void vote(message, 'up')}
                            >
                              <ThumbsUp className="h-3 w-3" /> Good
                            </button>
                            <button
                              type="button"
                              className={`inline-flex items-center gap-1 ${votes[message.id] === 'down' ? 'text-rose-600 dark:text-rose-400' : 'hover:text-ink-700 dark:hover:text-ink-100'}`}
                              aria-label="Bad answer"
                              onClick={() => void vote(message, 'down')}
                            >
                              <ThumbsDown className="h-3 w-3" /> Bad
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 hover:text-ink-700 dark:hover:text-ink-100"
                              aria-label="Reply to this message"
                              onClick={() => setReplyTo({ id: message.id, name: 'Chatgram AI', preview: visibleText(message.content).slice(0, 120) })}
                            >
                              <Reply className="h-3 w-3" /> Reply
                            </button>
                            {message.id === lastAssistantId && !busy ? (
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 hover:text-ink-700 dark:hover:text-ink-100"
                                aria-label="Regenerate answer"
                                onClick={regenerate}
                              >
                                <RefreshCw className="h-3 w-3" /> Regenerate
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {typing ? (
            <p className="mb-2 ml-9 flex items-center gap-2 text-[12px] font-medium text-brand-700 dark:text-brand-300" data-testid="ai-typing">
              Chatgram AI is typing
              <span className="flex gap-0.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500 [animation-delay:120ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500 [animation-delay:240ms]" />
              </span>
            </p>
          ) : null}

          {inChatSearch ? <p className="text-center text-[11.5px] text-ink-500">Searching this conversation only.</p> : null}
          {error ? (
            <p role="alert" className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="mt-2 text-center text-[11.5px] text-ink-500 dark:text-ink-400">
              {notice}
            </p>
          ) : null}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="composer-safe mx-auto w-full max-w-[1000px]">
        {messages.length === 0 ? (
          <div className="flex flex-wrap justify-center gap-2 px-3 pb-1" data-testid="ai-suggestions">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                data-testid="ai-suggestion-pill"
                className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] text-ink-700 shadow-sm transition hover:border-brand-500 hover:text-brand-700 dark:border-white/15 dark:bg-white/[.04] dark:text-ink-200 dark:hover:border-brand-400 dark:hover:text-brand-200"
                onClick={() => send(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
        <p className="px-3 pb-1 text-[11px] text-ink-500 dark:text-ink-400" data-testid="ai-attach-note">
          Attachments are off in this chat — Chatgram AI currently reads text only.
        </p>
        <Composer
          chatId="chatgram-ai"
          draft={draft}
          onDraftChange={setDraft}
          onSendText={send}
          onSendFile={() => setNotice('Chatgram AI reads text only in this version.')}
          onTyping={() => undefined}
          replyTo={replyTo ? { name: replyTo.name, preview: replyTo.preview } : null}
          onCancelReply={() => setReplyTo(null)}
          textOnly
          placeholder="Message Chatgram AI"
          busy={busy}
          notice={null}
          onDismissNotice={() => setNotice(null)}
        />
      </div>

      {historyOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setHistoryOpen(false)}>
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-ink-800"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-label="Previous Chatgram AI conversations"
          >
            <h3 className="text-lg font-bold">Previous conversations</h3>
            <div className="mt-3 max-h-80 overflow-y-auto">
              {conversations.length === 0 ? <p className="text-sm text-ink-500">No saved conversations yet.</p> : null}
              <ul className="space-y-1">
                {conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-ink-100 dark:hover:bg-white/5 ${conversation.id === conversationId ? 'bg-brand-600/10' : ''}`}
                      onClick={() => void loadConversation(conversation.id)}
                    >
                      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium">{conversation.title}</span>
                        <span className="block truncate text-[11.5px] text-ink-500 dark:text-ink-400">{conversation.lastMessage}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-3 flex justify-between">
              <button type="button" className="btn-ghost" onClick={newConversation}>
                New conversation
              </button>
              <button type="button" className="btn-ghost" onClick={() => setHistoryOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </section>
  );
}
