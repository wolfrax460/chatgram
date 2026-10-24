import { useEffect, useRef, useState } from 'react';
import { Bot, Copy, Loader2, Plus, Send, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../lib/api';

/**
 * Chatgram AI (item 3 UI): general assistant with streaming answers, per-user
 * conversation history, suggestion chips, copy, new chat and delete.
 * Markdown is rendered safely (React text nodes, never dangerouslySetInnerHTML).
 */
type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; streaming?: boolean };
type Conversation = { id: string; title: string; updatedAt: string; lastMessage: string };

const SUGGESTIONS = [
  'Explain photosynthesis in simple words',
  'Translate "good morning" to Kinyarwanda, French and Swahili',
  'Write a short polite message asking a client for a meeting',
  'Help me fix a JavaScript bug: my array filter returns undefined',
  'What are the current Chatgram status features?',
];

function renderInline(text: string, keyPrefix: string) {
  // Split on **bold** and `code`, keeping plain text as React text nodes (XSS-safe).
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('**')) nodes.push(<strong key={`${keyPrefix}-b-${index}`}>{token.slice(2, -2)}</strong>);
    else nodes.push(<code key={`${keyPrefix}-c-${index}`} className="rounded bg-ink-200/60 px-1 py-0.5 font-mono text-[12px] dark:bg-white/10">{token.slice(1, -1)}</code>);
    last = match.index + token.length;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-1.5">
      {text.split('\n').map((line, index) =>
        line.trim().startsWith('- ') || line.trim().startsWith('* ') ? (
          <p key={index} className="pl-3">• {renderInline(line.trim().slice(2), `l${index}`)}</p>
        ) : (
          <p key={index}>{renderInline(line, `l${index}`)}</p>
        ),
      )}
    </div>
  );
}

export default function AiChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api
      .request<{ conversations: Conversation[] }>('/api/ai/conversations')
      .then((data) => setConversations(data.conversations ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send(text: string) {
    const body = text.trim();
    if (!body || busy) return;
    setError('');
    setNotice('');
    setInput('');
    setBusy(true);
    const userMessage: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: body };
    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [...prev, userMessage, { id: assistantId, role: 'assistant', content: '', streaming: true }]);

    try {
      const token = api.accessToken;
      const response = await fetch('/api/ai/messages/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ conversationId: conversationId ?? undefined, text: body }),
      });
      if (!response.ok || !response.body) throw new Error('Chatgram AI is unavailable right now.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const event of events) {
          const line = event.split('\n').find((entry) => entry.startsWith('data: '));
          if (!line) continue;
          const payload = JSON.parse(line.slice(6));
          if (payload.error) throw new Error(payload.error);
          if (payload.delta) {
            setMessages((prev) =>
              prev.map((message) => (message.id === assistantId ? { ...message, content: message.content + payload.delta } : message)),
            );
          }
          if (payload.done) {
            setConversationId(payload.conversationId ?? null);
            setMessages((prev) => prev.map((message) => (message.id === assistantId ? { ...message, streaming: false } : message)));
            const list = await api.request<{ conversations: Conversation[] }>('/api/ai/conversations');
            setConversations(list.conversations ?? []);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chatgram AI is unavailable right now.');
      setMessages((prev) => prev.filter((message) => message.id !== assistantId));
    } finally {
      setBusy(false);
    }
  }

  function newChat() {
    setMessages([]);
    setConversationId(null);
    setNotice('');
    setError('');
  }

  async function loadConversation(id: string) {
    setBusy(true);
    setError('');
    try {
      const data = await api.request<{ messages: { id: string; role: 'user' | 'assistant'; content: string }[] }>(`/api/ai/conversations/${id}/messages`);
      setConversationId(id);
      setMessages(data.messages.map((message) => ({ id: message.id, role: message.role, content: message.content })));
    } catch {
      setError('Could not open that conversation.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteConversation() {
    if (!conversationId) {
      newChat();
      return;
    }
    try {
      await api.request(`/api/ai/conversations/${conversationId}`, { method: 'DELETE' });
      newChat();
      const list = await api.request<{ conversations: Conversation[] }>('/api/ai/conversations');
      setConversations(list.conversations ?? []);
    } catch {
      setError('Could not delete the conversation.');
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-ink-200 px-3 py-2 dark:border-white/10">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white"><Sparkles className="h-5 w-5" /></span>
        <div className="mr-auto">
          <h2 className="font-bold leading-tight">Chatgram AI</h2>
          <p className="text-[11px] text-ink-500 dark:text-ink-300">Powered by WOLFSEC · Chatgram AI can make mistakes</p>
        </div>
        {conversations.length > 0 ? (
          <select
            className="field h-9 max-w-[200px] text-[12px]"
            value={conversationId ?? ''}
            onChange={(event) => (event.target.value ? void loadConversation(event.target.value) : newChat())}
            aria-label="Conversation history"
          >
            <option value="">New chat</option>
            {conversations.map((conversation) => (
              <option key={conversation.id} value={conversation.id}>{conversation.title}</option>
            ))}
          </select>
        ) : null}
        <button type="button" className="btn-ghost !px-2" onClick={newChat} aria-label="New chat" title="New chat"><Plus className="h-4 w-4" /></button>
        <button type="button" className="btn-ghost !px-2 text-rose-500" onClick={() => void deleteConversation()} aria-label="Delete conversation" title="Delete conversation"><Trash2 className="h-4 w-4" /></button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          {messages.length === 0 ? (
            <div className="rounded-2xl border border-ink-200 bg-white p-5 text-center dark:border-white/10 dark:bg-white/[.03]">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-600 text-white"><Bot className="h-7 w-7" /></div>
              <h3 className="mt-3 text-lg font-bold">Ask Chatgram AI anything</h3>
              <p className="mx-auto mt-1 max-w-md text-[13px] text-ink-500 dark:text-ink-300">
                General questions, writing, translations (English, Kinyarwanda, French, Swahili), summaries, code help and Chatgram questions.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="rounded-full border border-ink-200 px-3 py-1.5 text-left text-[12px] hover:border-brand-500 dark:border-white/15"
                    onClick={() => void send(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((message) => (
            <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[14px] ${
                  message.role === 'user'
                    ? 'bg-brand-600 text-white'
                    : 'border border-ink-200 bg-white text-ink-800 dark:border-white/10 dark:bg-ink-700 dark:text-ink-100'
                }`}
                data-testid={`ai-message-${message.role}`}
              >
                {message.role === 'assistant' ? (
                  <>
                    <Markdown text={message.content || (message.streaming ? '…' : '')} />
                    {message.role === 'assistant' && message.content ? (
                      <button
                        type="button"
                        className="mt-1 inline-flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-700 dark:text-ink-400"
                        onClick={() => void navigator.clipboard?.writeText(message.content)}
                        aria-label="Copy answer"
                      >
                        <Copy className="h-3 w-3" /> Copy
                      </button>
                    ) : null}
                  </>
                ) : (
                  <p className="whitespace-pre-wrap break-words">{message.content}</p>
                )}
              </div>
            </div>
          ))}
          {busy && messages.length > 0 && messages[messages.length - 1]?.role === 'assistant' && !messages[messages.length - 1]?.content ? (
            <p className="flex items-center gap-2 text-[12px] text-ink-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Chatgram AI is typing…</p>
          ) : null}
          {error ? <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p> : null}
          {notice ? <p role="status" className="text-center text-[11px] text-ink-500">{notice}</p> : null}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl px-3 pb-3">
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
        >
          <textarea
            className="field max-h-[140px] min-h-[44px] flex-1 resize-none py-2.5"
            placeholder="Message Chatgram AI…"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send(input);
              }
            }}
            aria-label="Message Chatgram AI"
          />
          <button type="submit" className="btn-primary h-11 px-4" disabled={busy || !input.trim()} aria-label="Send to Chatgram AI">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
        <p className="mt-1.5 text-center text-[11px] text-ink-500 dark:text-ink-400">
          Chatgram AI can make mistakes. Check important info. Messages to Chatgram AI are processed by a third-party AI provider.
        </p>
      </div>
    </div>
  );
}
