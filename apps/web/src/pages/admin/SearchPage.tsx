import { useEffect, useRef, useState } from 'react';
import { Calendar, Eye, Search as SearchIcon, ShieldCheck, Timer, X } from 'lucide-react';
import { adminFetch, type AdminSessionInfo, type ReviewRow } from './api';
import { Chip, PageHead, Skeleton, useToast } from './ui';

type SearchResult = {
  id: string;
  chatId: string;
  chatTitle: string;
  chatType: 'direct' | 'group';
  senderId: string;
  senderName: string;
  content: string;
  type: string;
  sentAt: string;
  editedAt: string | null;
};

type SearchPayload = {
  review: ReviewRow;
  results: SearchResult[];
  keyword: string;
  page: number;
  limit: number;
  total: number;
  capped: boolean;
  cap: number;
};

/**
 * 9d: global message search across every account for abuse hunting.
 *
 * A search review must be started with a written reason first; only then does
 * the search form appear. Every search is audited, the session expires after 15
 * minutes of inactivity, results are capped/paginated and there is no way to
 * send, edit or delete anything from here.
 */
export default function SearchPage({ session }: { session: AdminSessionInfo }) {
  const toast = useToast();
  const [review, setReview] = useState<ReviewRow | null>(null);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const [keyword, setKeyword] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [payload, setPayload] = useState<SearchPayload | null>(null);
  const [page, setPage] = useState(0);
  const [searching, setSearching] = useState(false);
  const [lastQuery, setLastQuery] = useState<{ q: string; user: string; group: string; from: string; to: string } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!review) return;
    tick.current = setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => {
      if (tick.current) clearInterval(tick.current);
      tick.current = null;
    };
  }, [review?.id]);

  async function startReview() {
    setStarting(true);
    setError('');
    try {
      const started = await adminFetch<{ review: ReviewRow }>('/api/admin/reviews', {
        method: 'POST',
        csrf: session.csrfToken,
        body: { scope: 'search', reason: reason.trim(), reference: reference.trim() || undefined },
      });
      setReview(started.review);
      setSecondsLeft(started.review.secondsLeft);
      toast.show('Message search unlocked — every search is audited and the session ends after 15 minutes idle.');
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Could not start the search review.');
    } finally {
      setStarting(false);
    }
  }

  async function runSearch(nextPage = 0) {
    if (!review) return;
    if (keyword.trim().length < 2) {
      setError('Enter at least 2 characters to search.');
      return;
    }
    setSearching(true);
    setError('');
    try {
      const query = new URLSearchParams({ q: keyword.trim(), page: String(nextPage), limit: '25' });
      if (userFilter.trim()) query.set('user', userFilter.trim());
      if (groupFilter.trim()) query.set('group', groupFilter.trim());
      if (from) query.set('from', new Date(from).toISOString());
      if (to) query.set('to', new Date(`${to}T23:59:59`).toISOString());
      const result = await adminFetch<SearchPayload>(`/api/admin/reviews/${review.id}/search?${query.toString()}`);
      setPayload(result);
      setPage(result.page);
      setSecondsLeft(result.review.secondsLeft);
      setLastQuery({ q: keyword.trim(), user: userFilter.trim(), group: groupFilter.trim(), from, to });
    } catch (searchError) {
      const message = searchError instanceof Error ? searchError.message : 'The search failed.';
      setError(message);
      if (/review session ended|expired/i.test(message)) setReview(null);
    } finally {
      setSearching(false);
    }
  }

  async function endReview() {
    if (!review) return;
    try {
      await adminFetch(`/api/admin/reviews/${review.id}/end`, { method: 'POST', csrf: session.csrfToken, body: {} });
      toast.show('Search review ended.');
    } catch (endError) {
      setError(endError instanceof Error ? endError.message : 'Could not end the review.');
    }
    setReview(null);
    setPayload(null);
    setLastQuery(null);
    setReason('');
    setReference('');
  }

  const pageCount = payload ? Math.max(1, Math.ceil(Math.min(payload.total, payload.cap) / payload.limit)) : 1;

  return (
    <div>
      <PageHead
        title="Message search"
        subtitle="Search message text across every account for abuse and security investigations. A written reason is required first, every search is audited, and results are read-only."
        actions={review ? <Chip tone="warning"><Timer className="h-3 w-3" /> ends in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</Chip> : undefined}
      />

      {!review ? (
        <div className="admin-card admin-card-pad review-gate">
          <div className="review-gate-head">
            <span className="review-lock"><Eye className="h-5 w-5" /></span>
            <div>
              <h2 className="text-[15px] font-semibold">Security review required before searching</h2>
              <p className="text-[12.5px] text-[var(--ad-muted)]">
                Message search reaches every account on Chatgram. Record the reason for the investigation (a report or
                ticket reference helps). The session expires after 15 minutes of inactivity and each search is written
                to the append-only audit log.
              </p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
              Reason (required, minimum 10 characters)
              <textarea
                className="admin-input mt-1 h-24 w-full resize-y"
                value={reason}
                maxLength={500}
                placeholder="e.g. Report #1234: locating abusive messages sent to several accounts."
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
              Report or ticket reference (optional)
              <input className="admin-input mt-1 w-full" value={reference} maxLength={120} placeholder="REPORT-1234" onChange={(event) => setReference(event.target.value)} />
            </label>
          </div>
          <div className="mt-3">
            <button type="button" className="admin-btn admin-btn-primary" disabled={starting || reason.trim().length < 10} onClick={() => void startReview()}>
              <ShieldCheck className="h-3.5 w-3.5" /> {starting ? 'Starting…' : 'Start search review'}
            </button>
          </div>
          {error ? <p className="admin-chip admin-chip-danger mt-3">{error}</p> : null}
        </div>
      ) : (
        <>
          <div className="admin-card review-banner">
            <span className="review-badge"><ShieldCheck className="h-4 w-4" /> Security review mode · read-only search</span>
            <span className="review-timer"><Timer className="h-3.5 w-3.5" /> ends in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')} of inactivity</span>
            <button type="button" className="admin-btn admin-btn-sm" onClick={() => void endReview()}>
              <X className="h-3.5 w-3.5" /> End review
            </button>
          </div>
          <p className="text-[11.5px] text-[var(--ad-muted)]">Reason: “{review.reason}”{review.reference ? ` · reference ${review.reference}` : ''}</p>

          <form
            className="admin-card admin-card-pad mt-3"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch(0);
            }}
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)] xl:col-span-2">
                Message contains
                <input className="admin-input mt-1 w-full" value={keyword} maxLength={80} placeholder="keyword or phrase (2+ characters)" onChange={(event) => setKeyword(event.target.value)} />
              </label>
              <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                From user (name, email or id)
                <input className="admin-input mt-1 w-full" value={userFilter} maxLength={120} placeholder="any user" onChange={(event) => setUserFilter(event.target.value)} />
              </label>
              <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                In group (name or id)
                <input className="admin-input mt-1 w-full" value={groupFilter} maxLength={120} placeholder="any conversation" onChange={(event) => setGroupFilter(event.target.value)} />
              </label>
              <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
                Date range
                <span className="mt-1 flex gap-1">
                  <input type="date" className="admin-input w-full" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From date" />
                  <input type="date" className="admin-input w-full" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To date" />
                </span>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="submit" className="admin-btn admin-btn-primary" disabled={searching}>
                <SearchIcon className="h-3.5 w-3.5" /> {searching ? 'Searching…' : 'Search messages'}
              </button>
              {lastQuery ? (
                <span className="text-[11.5px] text-[var(--ad-muted)]">
                  <Calendar className="mr-1 inline h-3 w-3" /> “{lastQuery.q}” · {payload?.total ?? 0} match{payload?.total === 1 ? '' : 'es'}
                  {payload?.capped ? ` (first ${payload.cap} cap)` : ''}
                </span>
              ) : null}
            </div>
            {error ? <p className="admin-chip admin-chip-danger mt-3">{error}</p> : null}
          </form>

          {payload ? (
            <div className="admin-card mt-3">
              {payload.results.length === 0 ? (
                <div className="admin-empty p-6 text-center">
                  <SearchIcon className="mx-auto mb-2 h-6 w-6 text-[var(--ad-muted)]" />
                  <p className="text-[13px] font-semibold">No messages matched</p>
                  <p className="text-[12px] text-[var(--ad-muted)]">Try a shorter phrase or remove a filter.</p>
                </div>
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Sent</th>
                        <th>Sender</th>
                        <th>Conversation</th>
                        <th>Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payload.results.map((row) => (
                        <tr key={row.id}>
                          <td title={new Date(row.sentAt).toLocaleString()}>{new Date(row.sentAt).toLocaleDateString()}</td>
                          <td>{row.senderName}</td>
                          <td>
                            <span className="flex items-center gap-1.5">
                              <Chip tone={row.chatType === 'group' ? 'accent' : 'default'}>{row.chatType}</Chip>
                              <span className="max-w-[180px] truncate" title={row.chatTitle}>{row.chatTitle}</span>
                            </span>
                          </td>
                          <td className="max-w-[420px]">
                            <span className="block truncate" title={row.content}>
                              {row.content || `[${row.type}]`}
                            </span>
                            {row.editedAt ? <span className="text-[11px] text-[var(--ad-muted)]">edited</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 p-3">
                <button type="button" className="admin-btn admin-btn-sm" disabled={page === 0 || searching} onClick={() => void runSearch(Math.max(0, page - 1))}>
                  Previous
                </button>
                <span className="text-[11.5px] text-[var(--ad-muted)]">
                  {payload.results.length ? `${page * payload.limit + 1}–${page * payload.limit + payload.results.length}` : '0'} of {payload.total} · page {page + 1} of {pageCount} · capped at {payload.cap}
                </span>
                <button type="button" className="admin-btn admin-btn-sm" disabled={page + 1 >= pageCount || searching} onClick={() => void runSearch(page + 1)}>
                  Next
                </button>
              </div>
            </div>
          ) : searching ? (
            <div className="admin-card admin-card-pad mt-3">
              <Skeleton lines={4} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
