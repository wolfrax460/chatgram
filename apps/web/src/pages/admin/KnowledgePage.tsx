import { useCallback, useEffect, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Plus, Save, Search, Trash2 } from 'lucide-react';
import { adminFetch, formatNumber, relativeTime, type AdminSessionInfo } from './api';
import { Chip, ConfirmDialog, Drawer, EmptyState, PageHead, Skeleton, Toast, useToast } from './ui';

type KnowledgeEntry = {
  id: string;
  question: string;
  answer: string;
  keywords: string[];
  uses: number;
  source: string;
  approvedAt: string;
};
type KnowledgePayload = { entries: KnowledgeEntry[]; total: number; page: number; limit: number; pageCount: number };
type Draft = { id: string | null; question: string; answer: string; keywords: string };

const EMPTY_DRAFT: Draft = { id: null, question: '', answer: '', keywords: '' };

/** Knowledge base editor: the answers Chatgram AI uses for Chatgram questions. */
export default function KnowledgePage({ session }: { session: AdminSessionInfo }) {
  const toast = useToast();
  const [data, setData] = useState<KnowledgePayload | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeEntry | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await adminFetch<KnowledgePayload>(`/api/admin/ai/knowledge?search=${encodeURIComponent(search)}&page=${page}&limit=20`));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the knowledge base.');
    }
  }, [page, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const body = { question: draft.question, answer: draft.answer, keywords: draft.keywords };
      if (draft.id) {
        await adminFetch(`/api/admin/ai/knowledge/${draft.id}`, { method: 'PUT', csrf: session.csrfToken, body });
      } else {
        await adminFetch('/api/admin/ai/knowledge', { method: 'POST', csrf: session.csrfToken, body });
      }
      toast.show(draft.id ? 'Knowledge entry saved.' : 'Knowledge entry added.');
      setDraft(null);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the entry.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await adminFetch(`/api/admin/ai/knowledge/${deleteTarget.id}`, { method: 'DELETE', csrf: session.csrfToken });
      toast.show('Knowledge entry removed.');
      setDeleteTarget(null);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete the entry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHead
        title="Knowledge base"
        subtitle={data ? `${formatNumber(data.total)} answers Chatgram AI uses for Chatgram-specific questions` : 'Answers the assistant is allowed to reuse'}
        actions={
          <button type="button" className="admin-btn admin-btn-primary" onClick={() => setDraft(EMPTY_DRAFT)}>
            <Plus className="h-3.5 w-3.5" /> Add entry
          </button>
        }
      />
      {error ? <p role="alert" className="admin-chip admin-chip-danger mb-3">{error}</p> : null}

      <div className="admin-card admin-card-pad">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ad-faint)]" />
          <input
            className="admin-input admin-input-with-icon"
            placeholder="Search questions, answers or keywords"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            aria-label="Search the knowledge base"
          />
        </div>

        <div className="admin-scroll mt-3 max-h-[58vh] overflow-y-auto rounded-xl border border-[var(--ad-border)]">
          {!data ? (
            <div className="p-4"><Skeleton lines={6} /></div>
          ) : data.entries.length === 0 ? (
            <div className="p-3">
              <EmptyState title="No knowledge entries" body="Save an answer from the AI Inbox, or add one here — the assistant will reuse it." icon={<BookOpen className="h-6 w-6" />} />
            </div>
          ) : (
            <table className="admin-table">
              <thead><tr><th>Question</th><th>Answer</th><th>Keywords</th><th>Uses</th><th>Source</th><th /></tr></thead>
              <tbody>
                {data.entries.map((entry) => (
                  <tr key={entry.id} onClick={() => setDraft({ id: entry.id, question: entry.question, answer: entry.answer, keywords: entry.keywords.join(', ') })}>
                    <td className="max-w-[280px]"><p className="truncate text-[12.5px] font-medium">{entry.question}</p></td>
                    <td className="max-w-[360px]"><p className="truncate text-[12px] text-[var(--ad-muted)]">{entry.answer}</p></td>
                    <td className="max-w-[180px]">
                      <span className="flex flex-wrap gap-1">
                        {entry.keywords.slice(0, 3).map((word) => <Chip key={word}>{word}</Chip>)}
                        {entry.keywords.length > 3 ? <Chip>+{entry.keywords.length - 3}</Chip> : null}
                      </span>
                    </td>
                    <td className="tabular-nums">{formatNumber(entry.uses)}</td>
                    <td className="text-[11.5px] text-[var(--ad-muted)]">{entry.source} · {relativeTime(entry.approvedAt)}</td>
                    <td>
                      <button
                        type="button"
                        className="admin-btn admin-btn-sm admin-btn-danger"
                        aria-label={`Delete ${entry.question}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeleteTarget(entry);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {data && data.pageCount > 1 ? (
          <div className="mt-3 flex items-center justify-between">
            <p className="text-[11.5px] text-[var(--ad-muted)]">Page {data.page} of {data.pageCount} · {data.total} entries</p>
            <div className="flex gap-1.5">
              <button type="button" className="admin-btn admin-btn-sm" disabled={data.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                <ChevronLeft className="h-3.5 w-3.5" /> Previous
              </button>
              <button type="button" className="admin-btn admin-btn-sm" disabled={data.page >= data.pageCount} onClick={() => setPage((current) => current + 1)}>
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {draft ? (
        <Drawer title={draft.id ? 'Edit knowledge entry' : 'Add knowledge entry'} onClose={() => setDraft(null)}>
          <div className="space-y-3">
            <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
              Question (as a user would ask it)
              <input className="admin-input mt-1" value={draft.question} onChange={(event) => setDraft({ ...draft, question: event.target.value })} />
            </label>
            <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
              Answer the assistant should give
              <textarea className="admin-input mt-1 min-h-[140px] resize-y" value={draft.answer} onChange={(event) => setDraft({ ...draft, answer: event.target.value })} />
            </label>
            <label className="block text-[11.5px] font-semibold text-[var(--ad-muted)]">
              Keywords (comma separated)
              <input className="admin-input mt-1" value={draft.keywords} onChange={(event) => setDraft({ ...draft, keywords: event.target.value })} placeholder="password, two-step, sign-in" />
            </label>
            <button type="button" className="admin-btn admin-btn-primary w-full" onClick={() => void save()} disabled={busy || !draft.question.trim() || !draft.answer.trim()}>
              <Save className="h-3.5 w-3.5" /> {draft.id ? 'Save entry' : 'Add entry'}
            </button>
          </div>
        </Drawer>
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete this knowledge entry?"
          body={`"${deleteTarget.question}" will no longer be used by Chatgram AI. This is audited.`}
          confirmLabel="Delete entry"
          danger
          busy={busy}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void remove()}
        />
      ) : null}
      <Toast message={toast.message} />
    </div>
  );
}
