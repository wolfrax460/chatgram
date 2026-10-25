import { useCallback, useEffect, useState } from 'react';
import { Bot, Inbox, RefreshCw, Search, Send, Ticket } from 'lucide-react';
import { adminFetch, relativeTime, shortDate, type AdminSessionInfo } from './api';
import { Chip, EmptyState, PageHead, Skeleton, Toast, useToast } from './ui';

type TicketRow = {
  ticketId: string;
  status: string;
  contact: string;
  contactType: string;
  summary: string;
  createdAt: string;
  replyCount: number;
  lastReply: string;
  hasChat: boolean;
};
type SupportStats = { counts: { open: number; answered: number; closed: number; total: number }; recent: { ticketId: string; status: string; contact: string; summary: string; createdAt: string }[] };
type SupportSettings = { settings: Record<string, unknown>; status: { ai?: { provider?: string; model?: string; configured?: boolean; enabled?: boolean }; aiError?: string | null; channels?: Record<string, unknown> }; presets?: string[] };
type TicketDetail = {
  ticket: {
    ticketId: string;
    status: string;
    contact: string;
    contactType: string;
    summary: string;
    createdAt: string;
    hasChat: boolean;
    transcript: { role: string; text: string; at: string }[];
    replies: { text: string; at: string }[];
  };
};

const STATUS_FILTERS = [
  ['open', 'Open'],
  ['answered', 'Answered'],
  ['closed', 'Closed'],
] as const;

function statusTone(status: string) {
  if (status === 'open') return 'warning' as const;
  if (status === 'answered') return 'accent' as const;
  return 'success' as const;
}

/** Support operations: ticket queue, read-only transcript and an audited reply box. */
export default function SupportPage({ session }: { session: AdminSessionInfo }) {
  const toast = useToast();
  const [stats, setStats] = useState<SupportStats | null>(null);
  const [settings, setSettings] = useState<SupportSettings | null>(null);
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [status, setStatus] = useState('open');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [statsPayload, settingsPayload, ticketsPayload] = await Promise.all([
        adminFetch<SupportStats>('/api/admin/support/stats'),
        adminFetch<SupportSettings>('/api/admin/support/settings'),
        adminFetch<{ tickets: TicketRow[] }>(`/api/admin/support/tickets?status=${status}&q=${encodeURIComponent(search)}`),
      ]);
      setStats(statsPayload);
      setSettings(settingsPayload);
      setTickets(ticketsPayload.tickets);
      setSelected((current) => {
        if (current && ticketsPayload.tickets.some((row) => row.ticketId === current)) return current;
        return ticketsPayload.tickets[0]?.ticketId ?? null;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the support desk.');
    }
  }, [search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    adminFetch<TicketDetail>(`/api/admin/support/tickets/${encodeURIComponent(selected)}`)
      .then((payload) => {
        if (!cancelled) setDetail(payload);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load the ticket.');
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  async function sendReply() {
    if (!selected || !reply.trim()) return;
    setBusy(true);
    setError('');
    try {
      await adminFetch(`/api/admin/support/tickets/${encodeURIComponent(selected)}/reply`, {
        method: 'POST',
        csrf: session.csrfToken,
        body: { text: reply },
      });
      setReply('');
      toast.show('Reply sent to the conversation.');
      await load();
      const refreshed = await adminFetch<TicketDetail>(`/api/admin/support/tickets/${encodeURIComponent(selected)}`);
      setDetail(refreshed);
    } catch (replyError) {
      setError(replyError instanceof Error ? replyError.message : 'Could not send the reply.');
    } finally {
      setBusy(false);
    }
  }

  const ai = settings?.status?.ai;
  const channelEntries = Object.entries(settings?.status?.channels || {});

  return (
    <div>
      <PageHead
        title="Support"
        subtitle={stats ? `${stats.counts.open} open · ${stats.counts.answered} answered · ${stats.counts.closed} closed · ${stats.counts.total} total` : 'Ticket queue and the support account'}
        actions={
          <button type="button" className="admin-btn" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        }
      />
      {error ? <p role="alert" className="admin-chip admin-chip-danger mb-3">{error}</p> : null}

      <div className="admin-grid sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Open tickets', value: stats?.counts.open ?? 0, icon: Inbox, tone: 'warning' as const },
          { label: 'Answered', value: stats?.counts.answered ?? 0, icon: Ticket, tone: 'accent' as const },
          { label: 'Closed', value: stats?.counts.closed ?? 0, icon: Ticket, tone: 'success' as const },
          { label: 'Support AI', value: ai?.enabled === false ? 'off' : ai?.configured ? 'ready' : 'not set', icon: Bot, tone: ai?.enabled === false ? ('default' as const) : ai?.configured ? ('success' as const) : ('warning' as const) },
        ].map((card) => (
          <div key={card.label} className="admin-card admin-card-pad">
            <p className="admin-kpi-label flex items-center gap-1.5"><card.icon className="h-3.5 w-3.5" /> {card.label}</p>
            <p className="admin-kpi-value mt-1">{card.value}</p>
            <div className="mt-1"><Chip tone={card.tone}>{card.label === 'Support AI' ? (ai?.provider || 'no provider') : 'tickets'}</Chip></div>
          </div>
        ))}
      </div>

      {settings ? (
        <div className="admin-card admin-card-pad mt-3">
          <p className="admin-card-title">Support channels</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {channelEntries.length === 0 ? <span className="text-[12px] text-[var(--ad-muted)]">No notification channels reported.</span> : null}
            {channelEntries.map(([key, value]) => (
              <Chip key={key} tone={value ? 'success' : 'default'}>{key}: {String(value)}</Chip>
            ))}
            {settings.status.aiError ? <Chip tone="danger">AI error: {String(settings.status.aiError).slice(0, 80)}</Chip> : null}
          </div>
          <p className="mt-2 text-[11.5px] text-[var(--ad-muted)]">
            The support account replies through the normal chat; replies are sent from the official Chatgram Support account
            and mirrored to the ticket. A 60-second no-reply watchdog raises an Inbox alert (9e).
          </p>
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
        <div className="admin-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ad-border)] p-3">
            {STATUS_FILTERS.map(([key, label]) => (
              <button key={key} type="button" className={`admin-btn admin-btn-sm ${status === key ? 'admin-btn-primary' : ''}`} onClick={() => { setStatus(key); setSelected(null); }}>
                {label}
              </button>
            ))}
            <div className="relative ml-auto min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ad-faint)]" />
              <input
                className="admin-input admin-input-with-icon"
                placeholder="Search ticket id, contact or summary"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search support tickets"
              />
            </div>
          </div>
          <div className="admin-scroll max-h-[56vh] overflow-y-auto">
            {!tickets ? (
              <div className="p-4"><Skeleton lines={5} /></div>
            ) : tickets.length === 0 ? (
              <div className="p-3"><EmptyState title="No tickets here" body="Support requests from the help widget and Chatgram Support chats appear in this queue." icon={<Ticket className="h-6 w-6" />} /></div>
            ) : (
              <table className="admin-table">
                <thead><tr><th>Ticket</th><th>Status</th><th>Contact</th><th>Opened</th></tr></thead>
                <tbody>
                  {tickets.map((ticket) => (
                    <tr key={ticket.ticketId} onClick={() => setSelected(ticket.ticketId)} aria-selected={selected === ticket.ticketId} className={selected === ticket.ticketId ? 'admin-row-active' : undefined}>
                      <td>
                        <p className="font-mono text-[12px] font-semibold">{ticket.ticketId}</p>
                        <p className="mt-0.5 truncate text-[11.5px] text-[var(--ad-muted)]">{ticket.summary || 'No summary'}</p>
                      </td>
                      <td><Chip tone={statusTone(ticket.status)}>{ticket.status}</Chip>{ticket.replyCount > 0 ? <span className="ml-1 text-[10.5px] text-[var(--ad-faint)]">{ticket.replyCount} repl{ticket.replyCount === 1 ? 'y' : 'ies'}</span> : null}</td>
                      <td className="text-[12px]">{ticket.contact}</td>
                      <td className="whitespace-nowrap text-[11.5px] text-[var(--ad-muted)]">{relativeTime(ticket.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="admin-card admin-card-pad">
          {!detail ? (
            <Skeleton lines={6} />
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="admin-card-title font-mono">{detail.ticket.ticketId}</p>
                <Chip tone={statusTone(detail.ticket.status)}>{detail.ticket.status}</Chip>
              </div>
              <p className="mt-1 text-[12px] text-[var(--ad-muted)]">
                {detail.ticket.contact} · {detail.ticket.contactType} · opened {shortDate(detail.ticket.createdAt)}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-[13px]">{detail.ticket.summary}</p>

              <p className="admin-section-label mt-3">Conversation</p>
              <div className="admin-scroll mt-1 max-h-[30vh] space-y-2 overflow-y-auto">
                {(detail.ticket.transcript || []).length === 0 && (detail.ticket.replies || []).length === 0 ? (
                  <p className="text-[12px] text-[var(--ad-muted)]">No transcript for this ticket.</p>
                ) : null}
                {(detail.ticket.transcript || []).map((entry, index) => (
                  <div key={`t-${index}`} className={`rounded-lg p-2 text-[12px] ${entry.role === 'agent' || entry.role === 'assistant' ? 'bg-[var(--ad-accent)]/10' : 'bg-[var(--ad-sunken)]'}`}>
                    <p className="text-[10px] uppercase tracking-wide text-[var(--ad-faint)]">{entry.role === 'agent' || entry.role === 'assistant' ? 'Chatgram Support' : 'Guest'} · {relativeTime(entry.at)}</p>
                    <p className="mt-0.5 whitespace-pre-wrap">{entry.text}</p>
                  </div>
                ))}
                {(detail.ticket.replies || []).map((entry, index) => (
                  <div key={`r-${index}`} className="rounded-lg bg-[var(--ad-accent)]/10 p-2 text-[12px]">
                    <p className="text-[10px] uppercase tracking-wide text-[var(--ad-faint)]">Dashboard reply · {relativeTime(entry.at)}</p>
                    <p className="mt-0.5 whitespace-pre-wrap">{entry.text}</p>
                  </div>
                ))}
              </div>

              <label className="mt-3 block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                Reply as Chatgram Support
                <textarea
                  className="admin-input mt-1 min-h-[80px] resize-y"
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  placeholder={detail.ticket.hasChat ? 'Type the reply…' : 'This ticket has no conversation attached (contact only).'}
                  disabled={!detail.ticket.hasChat}
                />
              </label>
              <button type="button" className="admin-btn admin-btn-primary mt-2" onClick={() => void sendReply()} disabled={busy || !detail.ticket.hasChat || !reply.trim()}>
                <Send className="h-3.5 w-3.5" /> Send reply
              </button>
              <p className="mt-2 text-[11px] text-[var(--ad-faint)]">Admins cannot send as a user — this is the official support account replying in the ticket chat.</p>
            </>
          )}
        </div>
      </div>
      <Toast message={toast.message} />
    </div>
  );
}
