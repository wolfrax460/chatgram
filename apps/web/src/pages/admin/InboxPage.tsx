import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, FileText, Inbox as InboxIcon, RefreshCw, Save, Send, Sparkles, ThumbsDown, X, type LucideIcon } from 'lucide-react';
import {
  adminFetch,
  copyToClipboard,
  formatDateTime,
  relativeTime,
  type AdminSessionInfo,
  type InboxCombineResult,
  type InboxPayload,
  type InboxRow,
} from './api';
import { Chip, EmptyState, PageHead, Select, Skeleton, Toast, useToast } from './ui';

interface TypeMeta {
  label: string;
  emoji: string;
  /** Optional lucide glyph (same icon set the page already uses) shown instead of the emoji. */
  Icon?: LucideIcon;
}

const TYPE_META: Record<string, TypeMeta> = {
  bug_report: { label: 'Bug report', emoji: '🐞' },
  feature_request: { label: 'Feature request', emoji: '✨' },
  support_request: { label: 'Support request', emoji: '🛟' },
  complaint: { label: 'Complaint', emoji: '😠' },
  abuse_report: { label: 'Abuse report', emoji: '🚨' },
  unknown_question: { label: 'Unknown question', emoji: '❓' },
  chatgram_unknown: { label: 'Unknown answer', emoji: '❓' },
  low_confidence: { label: 'Low confidence', emoji: '🟡' },
  support_timeout: { label: 'Support no reply', emoji: '⏱️' },
  negative_feedback: { label: 'Thumbs down', emoji: '👎' },
  request: { label: 'Question', emoji: '💬' },
  // System-generated media/push health events (no user content, no asker).
  call_quality: { label: 'Call quality', emoji: '📞', Icon: RefreshCw },
  push_failure: { label: 'Push failure', emoji: '🔔', Icon: Send },
};

const REPORT_TYPE_SET = new Set(['bug_report', 'feature_request', 'support_request', 'complaint', 'abuse_report', 'unknown_question']);

const STATUS_LABEL: Record<string, string> = {
  new: 'New',
  in_progress: 'In progress',
  answered: 'Answered',
  fixed: 'Fixed',
  ignored: 'Ignored',
};

const TYPE_FILTER_OPTIONS = [
  { value: 'all', label: 'All types' },
  { value: 'bug_report', label: 'Bug reports' },
  { value: 'feature_request', label: 'Feature requests' },
  { value: 'support_request', label: 'Support requests' },
  { value: 'complaint', label: 'Complaints' },
  { value: 'abuse_report', label: 'Abuse reports' },
  { value: 'unknown_question', label: 'Unknown questions' },
  { value: 'chatgram_unknown', label: 'Unknown answers (legacy)' },
  { value: 'low_confidence', label: 'Low confidence' },
  { value: 'support_timeout', label: 'Support no reply' },
  { value: 'negative_feedback', label: 'Thumbs down' },
  { value: 'call_quality', label: 'Call quality' },
  { value: 'push_failure', label: 'Push failures' },
];

const STATUS_FILTER_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'answered', label: 'Answered' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'ignored', label: 'Ignored' },
  { value: 'all', label: 'All' },
];

function typeMeta(type: string): TypeMeta {
  return TYPE_META[type] ?? { label: type, emoji: '📩' };
}

/** The type chip glyph: a lucide icon for types that have one, the legacy emoji otherwise. */
function TypeGlyph({ meta }: { meta: TypeMeta }) {
  const Icon = meta.Icon;
  return Icon ? <Icon className="h-3 w-3" aria-hidden="true" /> : <span aria-hidden="true">{meta.emoji}</span>;
}

/** True for 1A report records (they store a reference/title); legacy rows do not. */
function isReportRow(row: InboxRow): boolean {
  return Boolean(row.ref || row.title || REPORT_TYPE_SET.has(row.type));
}

function toneForType(type: string): 'default' | 'accent' | 'warning' | 'danger' {
  if (type === 'abuse_report') return 'danger';
  if (type === 'support_timeout') return 'warning';
  if (type === 'negative_feedback') return 'danger';
  if (type === 'low_confidence') return 'warning';
  if (type === 'call_quality') return 'warning';
  if (type === 'push_failure') return 'danger';
  if (type === 'complaint' || type === 'bug_report') return 'warning';
  if (type === 'feature_request' || type === 'support_request' || type === 'unknown_question') return 'accent';
  return type === 'chatgram_unknown' ? 'accent' : 'default';
}

function toneForStatus(status: string): 'default' | 'accent' | 'success' | 'warning' {
  if (status === 'answered' || status === 'fixed') return 'success';
  if (status === 'in_progress') return 'warning';
  if (status === 'ignored') return 'default';
  return 'accent';
}

/**
 * Inbox: master-detail review of AI reports, what Chatgram AI could not answer
 * and what the support watchdog escalated. Reports expose the exact user words,
 * the source, the asker (admin only), a copyable fix prompt, multi-select
 * combine and a copyable transcript. j/k move, a focuses the answer, i ignores.
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [combineBusy, setCombineBusy] = useState(false);
  const [combined, setCombined] = useState<InboxCombineResult | null>(null);
  const [sentReplyIds, setSentReplyIds] = useState<string[]>([]);
  const answerRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await adminFetch<InboxPayload>(`/api/admin/ai/inbox?status=${encodeURIComponent(status)}&limit=50`);
      setPayload(data);
      setSelectedId((current) => (data.items.some((row) => row.id === current) ? current : data.items[0]?.id ?? null));
      setSelectedIds((current) => {
        const valid = new Set(data.items.map((row) => row.id));
        const next = current.filter((id) => valid.has(id));
        return next.length === current.length ? current : next;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the inbox.');
    }
  }, [status]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  // A change of filter invalidates the previous multi-selection.
  useEffect(() => {
    setSelectedIds([]);
  }, [status, type]);

  const items = useMemo(
    () => (payload?.items ?? []).filter((row) => type === 'all' || row.type === type),
    [payload?.items, type],
  );
  const selected: InboxRow | null = useMemo(() => items.find((row) => row.id === selectedId) ?? null, [items, selectedId]);
  const selectableOnPage = useMemo(() => items.filter((row) => isReportRow(row)).length, [items]);

  useEffect(() => {
    setAnswer(selected?.answer || '');
  }, [selected?.id, selected?.answer]);

  useEffect(() => {
    if (!combined) return undefined;
    function onModalKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setCombined(null);
    }
    document.addEventListener('keydown', onModalKey);
    return () => document.removeEventListener('keydown', onModalKey);
  }, [combined]);

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
      if (combined) return;
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
  }, [move, selected, combined]);

  function toggleSelected(id: string) {
    if (!selectedIds.includes(id) && selectedIds.length >= 25) {
      toast.show('You can combine up to 25 reports at a time.');
      return;
    }
    setSelectedIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }

  async function copyText(text: string | undefined, label: string) {
    if (!text) {
      toast.show(`There is no ${label.toLowerCase()} to copy.`);
      return;
    }
    const copied = await copyToClipboard(text);
    toast.show(
      copied
        ? `${label} copied to the clipboard.`
        : `Could not copy the ${label.toLowerCase()} automatically. Select the text and copy it manually.`,
    );
  }

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

  async function sendReplyToUser(item: InboxRow) {
    const reply = item.telegramReply;
    if (!reply?.text) return;
    setBusy(true);
    setError('');
    try {
      const result = await adminFetch<{ message?: string }>(`/api/admin/ai/inbox/${encodeURIComponent(item.id)}/answer`, {
        method: 'POST',
        csrf: session.csrfToken,
        body: { answer: reply.text },
      });
      setSentReplyIds((current) => (current.includes(item.id) ? current : [...current, item.id]));
      toast.show(result?.message || 'Reply saved to the knowledge base and sent to the user.');
      await load();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send the reply to the user.');
    } finally {
      setBusy(false);
    }
  }

  async function combineSelected() {
    if (selectedIds.length < 2) return;
    setCombineBusy(true);
    setError('');
    try {
      const result = await adminFetch<InboxCombineResult>('/api/admin/ai/inbox/combine', {
        method: 'POST',
        csrf: session.csrfToken,
        body: { ids: selectedIds },
      });
      if (!result?.prompt) throw new Error('The server did not return a combined prompt.');
      setCombined(result);
    } catch (combineError) {
      setError(combineError instanceof Error ? combineError.message : 'Could not combine the selected reports.');
    } finally {
      setCombineBusy(false);
    }
  }

  async function mergeDuplicates(item: InboxRow) {
    setBusy(true);
    setError('');
    try {
      const result = await adminFetch<{ message: string }>(`/api/admin/ai/inbox/${encodeURIComponent(item.id)}/merge`, {
        method: 'POST',
        csrf: session.csrfToken,
        body: {},
      });
      toast.show(result.message);
      await load();
    } catch (mergeError) {
      setError(mergeError instanceof Error ? mergeError.message : 'Could not merge the duplicates.');
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

  const selectedMeta = selected ? typeMeta(selected.type) : null;
  const selectedReport = selected ? isReportRow(selected) : false;
  const selectedTelegramReply = selected?.telegramReply && selected.telegramReply.text ? selected.telegramReply : null;
  // sentToUser is the honest server flag; the local list covers the moment right
  // after this admin sends it in the same session (the server flags it on reload).
  const replyAlreadySent = selectedTelegramReply
    ? selectedTelegramReply.sentToUser || sentReplyIds.includes(selected?.id ?? '')
    : false;

  return (
    <div>
      <PageHead
        title="Chatgram AI inbox"
        subtitle="AI reports, questions the assistant could not answer, low-confidence answers and support timeouts."
        actions={
          <>
            <Select label="Inbox status" value={status} onChange={setStatus} options={STATUS_FILTER_OPTIONS} />
            <Select label="Inbox type" value={type} onChange={setType} options={TYPE_FILTER_OPTIONS} />
            <button type="button" className="admin-btn min-h-[44px] sm:min-h-0" onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </>
        }
      />
      {error ? <p role="alert" className="admin-chip admin-chip-danger mb-3">{error}</p> : null}

      <div className="grid gap-3 lg:grid-cols-[360px_1fr]">
        <div className="admin-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ad-border)] px-3 py-2">
            <div className="min-w-0">
              <p className="admin-card-title">
                <InboxIcon className="h-4 w-4" /> {payload?.total ?? 0} items
              </p>
              <p className="mt-0.5 hidden text-[10.5px] text-[var(--ad-faint)] sm:block">
                <span className="admin-kbd">j</span>/<span className="admin-kbd">k</span> move · <span className="admin-kbd">a</span> answer · <span className="admin-kbd">i</span> ignore
                {selectableOnPage ? ` · ${selectableOnPage} combinable` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {selectedIds.length > 0 ? (
                <>
                  <span className="text-[10.5px] font-semibold text-[var(--ad-muted)]">{selectedIds.length} selected</span>
                  <button type="button" className="admin-btn admin-btn-sm min-h-[44px] sm:min-h-0" onClick={() => setSelectedIds([])}>
                    Clear
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="admin-btn admin-btn-primary admin-btn-sm min-h-[44px] sm:min-h-0"
                onClick={() => void combineSelected()}
                disabled={combineBusy || selectedIds.length < 2}
                title={
                  selectedIds.length < 2
                    ? 'Select at least 2 report rows to combine them into one prompt.'
                    : 'Merge the selected reports into one coding-assistant prompt, grouped by feature area.'
                }
              >
                <Copy className="h-3.5 w-3.5" />
                {combineBusy ? 'Combining…' : `Combine selected into one prompt${selectedIds.length ? ` (${selectedIds.length})` : ''}`}
              </button>
            </div>
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
              items.map((item) => {
                const report = isReportRow(item);
                const meta = typeMeta(item.type);
                const headline = item.title || item.question;
                return (
                  <div
                    key={item.id}
                    className={`flex items-stretch border-b border-[var(--ad-border)] last:border-b-0 ${
                      item.id === selectedId ? 'bg-[var(--ad-accent-soft)]' : ''
                    }`}
                  >
                    {report ? (
                      <label className="flex w-11 shrink-0 cursor-pointer items-center justify-center" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[var(--ad-accent)]"
                          checked={selectedIds.includes(item.id)}
                          onChange={() => toggleSelected(item.id)}
                          aria-label={`Select ${item.ref || item.title || 'report'} for combining`}
                        />
                      </label>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      aria-current={item.id === selectedId ? 'true' : undefined}
                      className={`block min-w-0 flex-1 py-2.5 pr-3 text-left transition-colors hover:bg-[var(--ad-sunken)] ${report ? 'pl-1' : 'pl-3'}`}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <Chip tone={toneForType(item.type)}>
                          <TypeGlyph meta={meta} /> {meta.label}
                        </Chip>
                        {item.ref ? <span className="font-mono text-[10.5px] font-semibold text-[var(--ad-faint)]">{item.ref}</span> : null}
                        {item.count > 1 ? <span className="text-[10.5px] font-bold text-[var(--ad-muted)]">×{item.count}</span> : null}
                        <span className="ml-auto text-[10.5px] text-[var(--ad-faint)]">{relativeTime(item.lastSeenAt)}</span>
                      </span>
                      <span className="mt-1 line-clamp-2 block text-[12.5px] font-medium">{headline}</span>
                      {item.summary && item.summary !== headline ? (
                        <span className="mt-0.5 line-clamp-2 block text-[11.5px] text-[var(--ad-muted)]">{item.summary}</span>
                      ) : null}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="admin-card admin-card-pad">
          {!selected || !selectedMeta ? (
            <EmptyState title="Pick an item" body="Select a question on the left to read the context and answer it." icon={<Sparkles className="h-6 w-6" />} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={toneForType(selected.type)}>
                  <TypeGlyph meta={selectedMeta} /> {selectedMeta.label}
                </Chip>
                {selected.ref ? <Chip tone="accent"><span className="font-mono">{selected.ref}</span></Chip> : null}
                <Chip tone={toneForStatus(selected.status)}>{STATUS_LABEL[selected.status] || selected.status}</Chip>
                {selected.providerKey ? <Chip>provider: {selected.providerKey}</Chip> : null}
                <span className="ml-auto text-[11px] text-[var(--ad-faint)]">
                  {formatDateTime(selected.createdAt)} · {relativeTime(selected.createdAt)}
                </span>
              </div>

              {selectedReport ? (
                <>
                  <h2 className="mt-3 text-[16px] font-semibold">{selected.title || 'Chatgram AI report'}</h2>
                  {selected.summary ? (
                    <p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-[var(--ad-muted)]">{selected.summary}</p>
                  ) : null}

                  <div className="mt-3 grid grid-cols-1 gap-2 text-[11.5px] sm:grid-cols-2">
                    <p>
                      <span className="admin-section-label">Source / group </span>
                      <span className="text-[var(--ad-muted)]">{selected.source || 'Chatgram AI'}</span>
                    </p>
                    <p>
                      <span className="admin-section-label">Asker (admin only) </span>
                      <span className="text-[var(--ad-muted)]">{selected.askerName || 'Unknown asker'}</span>
                      {selected.askerId ? <span className="ml-1 break-all font-mono text-[10.5px] text-[var(--ad-faint)]">{selected.askerId}</span> : null}
                    </p>
                    <p>
                      <span className="admin-section-label">First seen </span>
                      <span className="text-[var(--ad-muted)]">{formatDateTime(selected.createdAt)}</span>
                    </p>
                    <p>
                      <span className="admin-section-label">Duplicates </span>
                      <span className="text-[var(--ad-muted)]">
                        ×{selected.count}
                        {selected.duplicateCount > 0 ? ` · ${selected.duplicateCount} duplicate row${selected.duplicateCount === 1 ? '' : 's'}` : ''}
                      </span>
                    </p>
                  </div>

                  <p className="admin-section-label mt-4">What the user wrote</p>
                  <blockquote className="mt-1 whitespace-pre-wrap break-words border-l-2 border-[var(--ad-accent)]/60 pl-3 text-[13px] text-[var(--ad-text)]">
                    {selected.userText || selected.question}
                  </blockquote>

                  {selected.fixPrompt ? (
                    <section className="mt-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex flex-wrap items-center gap-2">
                          <p className="admin-section-label">Fix prompt for your coding assistant</p>
                          {selected.fixPromptSource === 'ai' ? <Chip tone="accent">AI-written</Chip> : null}
                          {selected.fixPromptSource === 'template' ? <Chip>Template</Chip> : null}
                        </span>
                        <button
                          type="button"
                          className="admin-btn admin-btn-sm min-h-[44px] sm:min-h-0"
                          onClick={() => void copyText(selected.fixPrompt, 'Fix prompt')}
                          aria-label={`Copy the fix prompt for ${selected.ref || 'this report'}`}
                        >
                          <Copy className="h-3.5 w-3.5" /> Copy fix prompt
                        </button>
                      </div>
                      {selected.fixPromptQuestions?.length ? (
                        <div className="mt-2 rounded-lg border border-[var(--ad-warning)]/40 bg-[var(--ad-warning)]/10 px-3 py-2 text-[12px] text-[var(--ad-text)]">
                          <p className="font-semibold text-[var(--ad-warning)]">Needs clarification from the reporter</p>
                          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[var(--ad-muted)]">
                            {selected.fixPromptQuestions.map((question, index) => (
                              <li key={`${index}-${question}`}>{question}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[11.5px] text-[var(--ad-muted)]">Show the full prompt</summary>
                        <pre className="admin-input mt-1 max-h-[280px] overflow-auto whitespace-pre-wrap break-words !p-2.5 font-mono text-[11.5px] leading-relaxed">
                          {selected.fixPrompt}
                        </pre>
                      </details>
                    </section>
                  ) : null}

                  {selected.transcript ? (
                    <section className="mt-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="admin-section-label">Conversation transcript</p>
                        <button
                          type="button"
                          className="admin-btn admin-btn-sm min-h-[44px] sm:min-h-0"
                          onClick={() => void copyText(selected.transcript, 'Transcript')}
                          aria-label={`Copy the transcript for ${selected.ref || 'this conversation'}`}
                        >
                          <FileText className="h-3.5 w-3.5" /> Copy transcript
                        </button>
                      </div>
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[11.5px] text-[var(--ad-muted)]">Show the transcript</summary>
                        <pre className="admin-input mt-1 max-h-[280px] overflow-auto whitespace-pre-wrap break-words !p-2.5 font-mono text-[11.5px] leading-relaxed">
                          {selected.transcript}
                        </pre>
                      </details>
                    </section>
                  ) : null}

                  {selectedTelegramReply ? (
                    <section className="mt-4 rounded-lg border border-[var(--ad-border)] bg-[var(--ad-sunken)] p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="admin-section-label">Your reply from Telegram</p>
                        {selectedTelegramReply.at ? (
                          <span className="text-[10.5px] text-[var(--ad-faint)]">{formatDateTime(selectedTelegramReply.at)}</span>
                        ) : null}
                        {replyAlreadySent ? <Chip tone="success">Sent to user</Chip> : null}
                      </div>
                      <blockquote className="mt-1 whitespace-pre-wrap break-words border-l-2 border-[var(--ad-accent)]/60 pl-3 text-[13px] text-[var(--ad-text)]">
                        {selectedTelegramReply.text}
                      </blockquote>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="admin-btn admin-btn-primary admin-btn-sm min-h-[44px] sm:min-h-0"
                          onClick={() => void sendReplyToUser(selected)}
                          disabled={busy || replyAlreadySent || !selected.canAnswerUser}
                          title={
                            replyAlreadySent
                              ? 'This reply was already delivered to the user; resending could duplicate it.'
                              : !selected.canAnswerUser
                                ? 'This report has no signed-in asker, so there is nobody to deliver the reply to.'
                                : 'Send this reply from the Chatgram Support account and save it to the knowledge base.'
                          }
                        >
                          <Send className="h-3.5 w-3.5" /> Send to user
                        </button>
                        {!selected.canAnswerUser ? (
                          <span className="text-[11px] text-[var(--ad-muted)]">
                            No signed-in asker on this report, so there is nobody to deliver it to. The reply still appears in the
                            knowledge base if you save it below.
                          </span>
                        ) : replyAlreadySent ? (
                          <span className="text-[11px] text-[var(--ad-muted)]">Already delivered to the user; resending is disabled to avoid duplicates.</span>
                        ) : (
                          <span className="text-[11px] text-[var(--ad-muted)]">Sends to the asker from the Chatgram Support account.</span>
                        )}
                      </div>
                    </section>
                  ) : null}
                </>
              ) : (
                <>
                  <p className="admin-section-label mt-4">Question</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-[14px] font-medium">{selected.question}</p>
                </>
              )}

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
                <button type="button" className="admin-btn admin-btn-primary min-h-[44px] sm:min-h-0" onClick={() => void answerItem(selected)} disabled={busy || !answer.trim()}>
                  <Save className="h-3.5 w-3.5" /> Save to knowledge base
                </button>
                <button type="button" className="admin-btn min-h-[44px] sm:min-h-0" onClick={() => void ignore(selected)} disabled={busy}>
                  <X className="h-3.5 w-3.5" /> Ignore
                </button>
                <button
                  type="button"
                  className="admin-btn min-h-[44px] sm:min-h-0"
                  onClick={() => void mergeDuplicates(selected)}
                  disabled={busy || !selected.duplicateCount}
                  title={selected.duplicateCount ? `Merge ${selected.duplicateCount} duplicate record${selected.duplicateCount === 1 ? '' : 's'} of this question` : 'No duplicate records for this question'}
                >
                  Merge duplicates{selected.duplicateCount ? ` (${selected.duplicateCount})` : ''}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {combined ? (
        <div
          className="fixed inset-0 z-[88] grid place-items-center bg-black/60 p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="combined-prompt-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) setCombined(null);
          }}
        >
          <div className="admin-card w-full max-w-3xl p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="combined-prompt-title" className="text-[15px] font-bold">Combined fix prompt</h2>
                <p className="mt-0.5 text-[11.5px] text-[var(--ad-muted)]">
                  {combined.records.length} report{combined.records.length === 1 ? '' : 's'} merged into one prompt, grouped by feature area
                  {combined.records.length ? ` (${combined.records.map((record) => record.ref).join(', ')})` : ''}.
                </p>
              </div>
              <button type="button" className="admin-btn admin-btn-sm min-h-[44px] sm:min-h-0" onClick={() => setCombined(null)} aria-label="Close the combined prompt">
                <X className="h-3.5 w-3.5" /> Close
              </button>
            </div>
            <pre
              className="admin-input mt-3 max-h-[50vh] overflow-auto whitespace-pre-wrap break-words !p-3 font-mono text-[11.5px] leading-relaxed"
              tabIndex={0}
              aria-label="Combined prompt text"
            >
              {combined.prompt}
            </pre>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button type="button" className="admin-btn admin-btn-primary min-h-[44px] sm:min-h-0" onClick={() => void copyText(combined.prompt, 'Combined prompt')}>
                <Copy className="h-3.5 w-3.5" /> Copy combined prompt
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <Toast message={toast.message} />
    </div>
  );
}
