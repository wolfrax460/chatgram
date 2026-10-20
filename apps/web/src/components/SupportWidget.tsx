import { useCallback, useEffect, useRef, useState } from 'react';
import { LifeBuoy, X, Send, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import { io } from 'socket.io-client';
import { api, APP_VERSION, SOCKET_URL } from '../lib/api';

/**
 * Public help widget.
 *
 * Answers from a small local knowledge base (mirrors docs/support-kb.md). When
 * the guest is not satisfied it collects a contact and files a real ticket via
 * POST /api/support/tickets, which lands in the Chatgram Support inbox.
 */

type Msg = { role: 'guest' | 'assistant'; text: string };

const CHIPS = [
  { id: 'signin', label: "Can't sign in" },
  { id: 'forgot', label: 'Forgot password' },
  { id: 'code', label: "Didn't get a code" },
  { id: 'register', label: "Can't register" },
  { id: 'other', label: 'Something else' },
];

const ANSWERS: Record<string, string> = {
  signin:
    "A few common causes:\n• Wrong password — use “Forgot password?” to reset it rather than retrying.\n• Too many attempts — the account locks briefly; wait for the countdown.\n• Phone numbers need the +250 format.\n\nStill stuck? I can send this to support.",
  forgot:
    'On the sign-in screen choose “Forgot password?”, enter the email or phone on your account and press Send code. We email a 6-digit code that expires quickly. Enter it with a new password and sign in again.',
  code:
    'Check these in order: (1) the spam/junk folder; (2) that the address has no typo; (3) wait up to 5 minutes; (4) press Resend once — repeated requests are rate limited; (5) try another email provider. If nothing arrives after 10 minutes, send a report and we will verify manually.',
  register:
    'Choose Create account, enter your full name, an email address, a password twice, tick the Terms box, then press Send code and enter the 6-digit code we email you.\n\nPhone sign-up is not available yet — please use an email address.',
  other: 'Tell me what happened in a sentence or two, and I can pass it to Chatgram Support.',
};

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
    return `g-${Math.random().toString(36).slice(2, 12)}`;
  }
}

export default function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [stage, setStage] = useState<'chat' | 'form' | 'done' | 'status'>('chat');
  const [contact, setContact] = useState('');
  const [includeTech, setIncludeTech] = useState(true);
  const [ticketId, setTicketId] = useState('');
  const [lookupId, setLookupId] = useState('');
  const [lookupResult, setLookupResult] = useState<string | null>(null);
  const [guestToken, setGuestToken] = useState('');
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Seed the conversation the first time the panel opens.
  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([
        {
          role: 'assistant',
          text: "Hi — I'm Chatgram's help assistant. Pick what you're stuck with, or describe the problem.",
        },
      ]);
    }
  }, [open, messages.length]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Esc closes; focus moves into the panel when it opens.
  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const push = useCallback((msg: Msg) => setMessages((prev) => [...prev, msg]), []);

  function answerChip(id: string) {
    const chip = CHIPS.find((c) => c.id === id);
    if (!chip) return;
    push({ role: 'guest', text: chip.label });
    push({ role: 'assistant', text: ANSWERS[id] ?? ANSWERS.other ?? '' });
    window.setTimeout(
      () => push({ role: 'assistant', text: 'Did that solve it? If not, I can send your report to support.' }),
      400,
    );
  }

  async function sendFreeText(e: React.FormEvent) {
    e.preventDefault();
    const raw = input.trim();
    if (!raw || busy) return;
    const text = maskSecrets(raw);
    setInput('');
    const next: Msg[] = [...messages, { role: 'guest', text }];
    setMessages(next);
    setBusy(true);
    try {
      // Server-side assistant: uses the configured AI provider, or the
      // knowledge base when AI is disabled/unavailable.
      const result = await api.askSupportAssistant({
        guestId: guestId(),
        messages: next.slice(-12),
      });
      push({ role: 'assistant', text: result.answer });
    } catch {
      // Offline or rate limited: answer locally from the same knowledge base.
      const lower = text.toLowerCase();
      const hit = CHIPS.find((c) => answersMatch(lower, c.id));
      push({
        role: 'assistant',
        text: (hit ? ANSWERS[hit.id] : ANSWERS.other) ?? ANSWERS.other ?? '',
      });
    } finally {
      setBusy(false);
    }
  }

  function answersMatch(text: string, id: string): boolean {
    const map: Record<string, string[]> = {
      signin: ['sign in', 'login', 'log in', "can't sign", 'cant sign', 'wrong password'],
      forgot: ['forgot', 'reset', 'change password'],
      code: ['code', 'otp', 'verification', 'email not', "didn't get", 'didnt get'],
      register: ['register', 'sign up', 'signup', 'create account'],
    };
    return (map[id] ?? []).some((k) => text.includes(k));
  }

  // While a ticket is open, listen on the guest namespace for support replies.
  useEffect(() => {
    if (!guestToken) return undefined;
    const socket = io(`${SOCKET_URL}/support-guest`, {
      auth: { token: guestToken },
      transports: ['websocket', 'polling'],
      reconnection: true,
    });
    socket.on('guest:ready', () => setLive(true));
    socket.on('ticket:reply', (payload: { replies?: { text: string }[] }) => {
      const latest = payload?.replies?.[payload.replies.length - 1];
      if (latest?.text) push({ role: 'assistant', text: `Support: ${latest.text}` });
    });
    socket.on('ticket:closed', () => {
      push({ role: 'assistant', text: 'This ticket was closed by support.' });
      setLive(false);
    });
    socket.on('connect_error', () => setLive(false));
    socket.on('disconnect', () => setLive(false));
    return () => {
      socket.disconnect();
    };
  }, [guestToken, push]);

  async function deleteTicket() {
    if (!ticketId || !contact.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteSupportTicket(ticketId, contact.trim());
      setTicketId('');
      setGuestToken('');
      setStage('chat');
      push({ role: 'assistant', text: 'Your ticket was deleted.' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the ticket.');
    } finally {
      setBusy(false);
    }
  }

  async function submitReport(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const value = contact.trim();
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
    const isPhone = /^\+?\d{8,15}$/.test(value.replace(/[\s-]/g, ''));
    if (!isEmail && !isPhone) {
      setError('Enter a valid email address or phone number (e.g. +250788123456).');
      return;
    }
    setBusy(true);
    try {
      const summary =
        messages
          .filter((m) => m.role === 'guest')
          .map((m) => m.text)
          .join(' | ')
          .slice(0, 1500) || 'Support request from the help widget';
      const result = await api.createSupportTicket({
        guestId: guestId(),
        contact: value,
        summary,
        transcript: messages.slice(-30),
        page: includeTech ? window.location.pathname : '',
        userAgent: includeTech ? navigator.userAgent : '',
        appVersion: APP_VERSION,
      });
      setTicketId(result.ticketId);
      if (result.guestToken) setGuestToken(result.guestToken);
      setStage('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the report. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function checkStatus(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLookupResult(null);
    setBusy(true);
    try {
      const result = await api.getSupportTicket(lookupId.trim().toUpperCase(), contact.trim());
      setLookupResult(
        result.replies.length
          ? `${result.status.toUpperCase()} — ${result.replies.map((r) => r.text).join('\n')}`
          : `${result.status.toUpperCase()} — no reply yet. We'll email you.`,
      );
    } catch {
      setError('No ticket found for that ID and contact.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* launcher */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close help' : 'Open help'}
        aria-expanded={open}
        className="fixed bottom-5 right-5 z-[60] grid h-14 w-14 place-items-center rounded-full bg-brand-600 text-white shadow-2xl transition hover:bg-brand-700 active:scale-95"
      >
        {open ? <X className="h-6 w-6" /> : <LifeBuoy className="h-6 w-6" />}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[59] bg-black/40 sm:bg-transparent"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Chatgram Help"
          className="fixed inset-x-0 bottom-0 z-[61] flex h-[86vh] flex-col rounded-t-2xl border border-ink-200 bg-white shadow-2xl dark:border-white/10 dark:bg-ink-800 sm:inset-auto sm:bottom-24 sm:right-5 sm:h-[560px] sm:w-[380px] sm:rounded-2xl"
        >
          <header className="flex items-start gap-3 rounded-t-2xl bg-brand-700 px-4 py-3 text-white">
            <LifeBuoy className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-bold leading-tight">Chatgram Help</p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-white/80">
                AI assistant — your report may be sent to Chatgram Support. Never share your password.
              </p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="shrink-0 rounded-lg p-1 hover:bg-white/15">
              <X className="h-5 w-5" />
            </button>
          </header>

          {error ? (
            <p role="alert" className="flex items-start gap-2 border-b border-rose-200 bg-rose-50 px-4 py-2 text-[12.5px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </p>
          ) : null}

          {stage === 'chat' ? (
            <>
              <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3" aria-live="polite">
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'guest' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] ${
                        m.role === 'guest'
                          ? 'rounded-br-md bg-brand-600 text-white'
                          : 'rounded-bl-md bg-ink-100 text-ink-800 dark:bg-ink-700 dark:text-ink-100'
                      }`}
                    >
                      {m.text}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-1.5 border-t border-ink-200 px-3 py-2 dark:border-white/10">
                {CHIPS.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => answerChip(chip.id)}
                    className="rounded-full border border-ink-200 px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-700 hover:border-brand-600 hover:text-brand-700 dark:border-white/15 dark:text-ink-200 min-h-[32px]"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              <form onSubmit={sendFreeText} className="flex items-center gap-2 border-t border-ink-200 p-2.5 dark:border-white/10">
                <input
                  ref={inputRef}
                  className="field h-11 flex-1"
                  placeholder="Describe the problem…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                />
                <button type="submit" className="btn-primary h-11 !px-3" aria-label="Send">
                  <Send className="h-4 w-4" />
                </button>
              </form>

              <div className="flex items-center justify-between border-t border-ink-200 px-3 py-2 text-[12px] dark:border-white/10">
                <button type="button" onClick={() => setStage('form')} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
                  Not solved — contact support
                </button>
                <button type="button" onClick={() => setStage('status')} className="font-semibold text-ink-600 hover:underline dark:text-ink-300">
                  Check ticket status
                </button>
              </div>
            </>
          ) : null}

          {stage === 'form' ? (
            <form onSubmit={submitReport} className="flex-1 space-y-3 overflow-y-auto p-4">
              <p className="text-[13px] text-ink-600 dark:text-ink-300">
                Send your report to Chatgram Support. We reply by email.
              </p>
              <div>
                <label htmlFor="sw-contact" className="label">Email or phone</label>
                <input id="sw-contact" className="field h-11" placeholder="you@example.com or +250…" value={contact} onChange={(e) => setContact(e.target.value)} required />
              </div>
              <label className="flex items-start gap-2 text-[12.5px] text-ink-700 dark:text-ink-200">
                <input type="checkbox" checked={includeTech} onChange={(e) => setIncludeTech(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600" />
                Include technical details (browser, page)
              </label>
              <button type="submit" className="btn-primary h-11 w-full" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {busy ? 'Sending…' : 'Send report to support'}
              </button>
              <button type="button" className="btn-ghost h-10 w-full text-[12.5px]" onClick={() => setStage('chat')}>
                Back to chat
              </button>
            </form>
          ) : null}

          {stage === 'done' ? (
            <div className="flex-1 space-y-3 overflow-y-auto p-4" role="status">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
              <p className="text-center text-sm font-semibold">Report sent</p>
              <p className="rounded-xl bg-ink-100 px-3 py-2 text-center font-mono text-base font-bold dark:bg-white/10">{ticketId}</p>
              <p className="text-center text-[12.5px] text-ink-600 dark:text-ink-300">
                We&apos;ll reply by email, or you can check the status with this ticket ID.
              </p>
              <button type="button" className="btn-ghost h-10 w-full" onClick={() => setStage('status')}>
                Check ticket status
              </button>
              <p
                className={`text-center text-[11.5px] font-semibold ${
                  live ? 'text-emerald-600 dark:text-emerald-400' : 'text-ink-500 dark:text-ink-400'
                }`}
              >
                {live ? 'Live — support replies appear here' : 'Live updates unavailable (check status instead)'}
              </p>
              <button type="button" className="btn-ghost h-10 w-full text-rose-600" onClick={deleteTicket} disabled={busy}>
                Delete this ticket
              </button>
              <button type="button" className="btn-primary h-10 w-full" onClick={() => setOpen(false)}>
                Done
              </button>
            </div>
          ) : null}

          {stage === 'status' ? (
            <form onSubmit={checkStatus} className="flex-1 space-y-3 overflow-y-auto p-4">
              <p className="text-[13px] text-ink-600 dark:text-ink-300">Enter your ticket ID and the contact you used.</p>
              <div>
                <label htmlFor="sw-ticket" className="label">Ticket ID</label>
                <input id="sw-ticket" className="field h-11 font-mono uppercase" placeholder="CG-XXXXX" value={lookupId} onChange={(e) => setLookupId(e.target.value)} required />
              </div>
              <div>
                <label htmlFor="sw-contact2" className="label">Email or phone</label>
                <input id="sw-contact2" className="field h-11" value={contact} onChange={(e) => setContact(e.target.value)} required />
              </div>
              <button type="submit" className="btn-primary h-11 w-full" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Check status
              </button>
              {lookupResult ? (
                <p className="whitespace-pre-wrap rounded-xl bg-ink-100 px-3 py-2 text-[12.5px] dark:bg-white/10">{lookupResult}</p>
              ) : null}
              <button type="button" className="btn-ghost h-10 w-full text-[12.5px]" onClick={() => setStage('chat')}>
                Back to chat
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
