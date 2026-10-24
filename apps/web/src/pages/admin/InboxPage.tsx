import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Inbox as InboxIcon, RefreshCw, Save, Sparkles, ThumbsDown, X } from 'lucide-react';
import { adminFetch, relativeTime, type AdminSessionInfo, type InboxPayload, type InboxRow } from './api';
import { Chip, EmptyState, PageHead, Select, Skeleton, Toast, useToast } from './ui';

const TYPE_LABEL: Record<string, string> = {
  chatgram_unknown: 'Unknown answer',
  low_confidence: 'Low confidence',
  support_timeout: 'Support no reply',
  negative_feedback: 'Thumbs down',
  request: 'Question',
};

function toneForType(type: string): 'default' | 'accent' | 'warning' | 'danger' {
  if (type === 'support_timeout') return 'warning';
  if (type === 'negative_feedback') return 'danger';
  if (type === 'low_confidence') return 'warning';
  return 'accent';
}

/**
 * Inbox: master-detail review of what Chatgram AI could not answer (and what the
 * support watchdog escalated). j/k move, a focuses the answer, i ignores.
 */
export default function InboxPage({ session }: { session: AdminSessionInfo }) {
  const toast = useToast();
  const [payload, setPayload] = useState<InboxPayload | null>(null);
  const [status, setStatus] = useState('new');
  const [type, setType] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const answerRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await adminFetch<InboxPayload>(`/api/admin/ai/inbox?status=${encodeURIComponent(status)}&limit=50`);
      setPayload(data);
      setSelectedId((current) => (data.items.some((row) => row.id === current) ? current : data.items[0]?.id ?? null));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the inbox.');
    }
  }, [status]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const items = useMemo(
    () => (payload?.items ?? []).filter((row) => type === 'all' || row.type === type),
    [payload?.items, type],
  );
  const selected: InboxRow | null = useMemo(() => items.find((row) => row.id === selectedId) ?? null, [items, selectedId]);

  useEffect(() => {
    setAnswer(selected?.answer || '');
  }, [selected?.id, selected?.answer]);

  const move = useCallback(
    (delta: number) => {
      if (!items.length) return;
      const index = Math.max(0, items.findIndex((row) => row.id === selectedId));
      const next = items[(index + delta + items.length) % items.length]!;
      setSelectedId(next.id);
    },
    [items, selectedId],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === 'j') {
        event.preventDefault();
        move(1);
      } else if (event.key === 'k') {
        event.preventDefault();
        move(-1);
      } else if (event.key === 'a') {
        event.preventDefault();
        answerRef.current?.focus();
      } else if (event.key === 'i' && selected) {
        event.preventDefault();
        void ignore(selected);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [move, selected]);

  async function answerItem(item: InboxRow) {
    if (!answer.trim()) return;
    setBusy(true);
    setError('');
    try {
      await adminFetch(`/api/admin/ai/inbox/${encodeURIComponent(item.id)}/answer`, {
        method: 'POST',
        csrf: session.csrfToken,
        body: { answer: answer.trim() },
      });
      toast.show('Answer saved to the knowledge base.');
      await load();
    } catch (answerError) {
      setError(answerError instanceof Error ? answerError.message : 'Could not save the answer.');
    } finally {
      setBusy(false);
    }
  }

  async function ignore(item: InboxRow) {
    setBusy(true);
    setError('');
    try {
      await adminFetch(`/api/admin/ai/inbox/${encodeURIComponent(item.id)}/ignore`, {
        method: 'POST',
        csrf: session.csrfToken,
        body: {},
      });
      toast.show('Inbox item ignored.');
      await load();
    } catch (ignoreError) {
      setError(ignoreError instanceof Error ? ignoreError.message : 'Could not ignore the item.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHead
        title="Chatgram AI inbox"
        subtitle="Questions the assistant could not answer, low-confidence answers and support timeouts."
        actions={
          <>
            <Select
              label="Inbox status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'new', label: 'New' },
                { value: 'answered', label: 'Answered' },
                { value: 'ignored', label: 'Ignored' },
                { value: 'all', label: 'All' },
              ]}
            />
            <Select
              label="Inbox type"
              value={type}
              onChange={setType}
              options={[
                { value: 'all', label: 'All types' },
                { value: 'chatgram_unknown', label: 'Unknown answer' },
                { value: 'low_confidence', label: 'Low confidence' },
                { value: 'support_timeout', label: 'Support no reply' },
                { value: 'negative_feedback', label: 'Thumbs down' },
              ]}
            />
            <button type="button" className="admin-btn" onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </>
        }
      />
      {error ? <p role="alert" className="admin-chip admin-chip-danger mb-3">{error}</p> : null}

      <div className="grid gap-3 lg:grid-cols-[360px_1fr]">
        <div className="admin-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--ad-border)] px-3 py-2">
            <p className="admin-card-title">
              <InboxIcon className="h-4 w-4" /> {payload?.total ?? 0} items
            </p>
            <span className="text-[10.5px] text-[var(--ad-faint)]">
              <span className="admin-kbd">j</span>/<span className="admin-kbd">k</span> move · <span className="admin-kbd">a</span> answer · <span className="admin-kbd">i</span> ignore
            </span>
          </div>
          <div className="max-h-[64vh] overflow-y-auto">
            {!payload ? (
              <div className="p-3">
                <Skeleton lines={5} />
              </div>
            ) : items.length === 0 ? (
              <div className="p-3">
                <EmptyState title="Inbox zero" body="Nothing to review for this filter. New questions appear here automatically." icon={<Check className="h-6 w-6" />} />
              </div>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  aria-current={item.id === selectedId ? 'true' : undefined}
                  className={`block w-full border-b border-[var(--ad-border)] px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-[var(--ad-sunken)] ${
                    item.id === selectedId ? 'bg-[var(--ad-accent-soft)]' : ''
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Chip tone={toneForType(item.type)}>{TYPE_LABEL[item.type] || item.type}</Chip>
                    {item.count > 1 ? <span className="text-[10.5px] font-bold text-[var(--ad-muted)]">×{item.count}</span> : null}
                    <span className="ml-auto text-[10.5px] text-[var(--ad-faint)]">{relativeTime(item.lastSeenAt)}</span>
                  </span>
                  <span className="mt-1 line-clamp-2 block text-[12.5px] font-medium">{item.question}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="admin-card admin-card-pad">
          {!selected ? (
            <EmptyState title="Pick an item" body="Select a question on the left to read the context and answer it." icon={<Sparkles className="h-6 w-6" />} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={toneForType(selected.type)}>{TYPE_LABEL[selected.type] || selected.type}</Chip>
                <Chip>{selected.status}</Chip>
                {selected.providerKey ? <Chip>provider: {selected.providerKey}</Chip> : null}
                <span className="ml-auto text-[11px] text-[var(--ad-faint)]">
                  asked {relativeTime(selected.createdAt)} · seen {relativeTime(selected.lastSeenAt)} · ×{selected.count}
                </span>
              </div>
              <p className="admin-section-label mt-4">Question</p>
              <p className="mt-1 text-[14px] font-medium">{selected.question}</p>
              {selected.errorReason ? (
                <p className="mt-2 rounded-lg border border-[var(--ad-warning)]/40 bg-[var(--ad-warning)]/10 px-3 py-2 text-[12px] text-[var(--ad-warning)]">{selected.errorReason}</p>
              ) : null}
              {selected.answer ? (
                <div className="mt-3 rounded-lg border border-[var(--ad-success)]/40 bg-[var(--ad-success)]/10 px-3 py-2 text-[12.5px] text-[var(--ad-success)]">
                  <p className="flex items-center gap-1.5 font-semibold"><ThumbsDown className="h-3.5 w-3.5 rotate-180" /> Current answer</p>
                  <p className="mt-1 text-[var(--ad-text)]">{selected.answer}</p>
                </div>
              ) : null}
              <label className="admin-section-label mt-4 block" htmlFor="inbox-answer">
                Your answer (added to the Chatgram AI knowledge base)
              </label>
              <textarea
                id="inbox-answer"
                ref={answerRef}
                className="admin-input mt-1 min-h-[120px] resize-y"
                placeholder="Write the reply the assistant should give next time…"
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
              />
              <p className="mt-1 text-[11px] text-[var(--ad-muted)]">
                {selected.canAnswerUser ? 'Saving also sends this answer to the person in-app.' : 'No signed-in asker to notify — only the knowledge base is updated.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="admin-btn admin-btn-primary" onClick={() => void answerItem(selected)} disabled={busy || !answer.trim()}>
                  <Save className="h-3.5 w-3.5" /> Save to knowledge base
                </button>
                <button type="button" className="admin-btn" onClick={() => void ignore(selected)} disabled={busy}>
                  <X className="h-3.5 w-3.5" /> Ignore
                </button>
                <button type="button" className="admin-btn" disabled title="Merging duplicate questions is part of the next dashboard chunk">
                  Merge duplicates (soon)
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <Toast message={toast.message} />
    </div>
  );
}
