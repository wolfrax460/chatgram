/**
 * "Viewed by" sheet for the owner of a status.
 *
 * Owner-only by construction: it calls `GET /api/status/:id/viewers`, which the
 * server answers with 403 for anybody who is not the author and 404 for a status
 * that is gone (deleted or older than 24 h). Both cases render a quiet message
 * instead of throwing, and the component is only mounted from the "My status"
 * section — never for somebody else's status.
 *
 * The list is a bottom sheet on phones (full width, scrollable inside a capped
 * height, so it is never clipped at 360 px) and a centred dialog from `sm` up.
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@chatgram/api-client';
import { EyeOff, X } from 'lucide-react';
import { statusViewers } from '../../lib/api';
import { Avatar, timeAgo } from '../../components/status/Parts';

export function StatusViewersPanel({
  statusId,
  initialCount = 0,
  onClose,
}: {
  statusId: string;
  /** Viewer count already known from the status feed, shown while loading. */
  initialCount?: number;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ['status-viewers', statusId],
    queryFn: () => statusViewers(statusId),
    retry: false,
    staleTime: 15_000,
  });

  // Escape closes the sheet.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The page behind the sheet must not scroll while it is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const error = query.error;
  const errorStatus = error instanceof ApiError ? error.status : 0;
  const errorMessage =
    errorStatus === 403
      ? 'Only you can see who viewed your status.'
      : errorStatus === 404
        ? 'This status is no longer available.'
        : 'Could not load the viewers. Please try again.';

  // The feed's count is shown until the authoritative response arrives.
  const count = query.data?.count ?? initialCount;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="status-viewers-title"
      data-testid="status-viewers-panel"
    >
      <button
        type="button"
        className="absolute inset-0 h-full w-full bg-black/60"
        aria-label="Close viewers"
        onClick={onClose}
      />

      <div className="relative flex max-h-[85vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-ink-800 sm:max-h-[80vh] sm:max-w-md sm:rounded-2xl">
        <header className="flex shrink-0 items-center gap-2 border-b border-ink-200 px-4 py-3 dark:border-white/10">
          <h2 id="status-viewers-title" className="min-w-0 flex-1 truncate font-bold">
            Viewed by {count}
          </h2>
          <button
            type="button"
            className="btn-ghost !px-2"
            onClick={onClose}
            aria-label="Close viewers"
            autoFocus
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
          {query.isLoading ? (
            <p className="px-2 py-8 text-center text-sm text-ink-500 dark:text-ink-400" role="status">
              Loading viewers…
            </p>
          ) : null}

          {query.isError ? (
            <p className="px-2 py-8 text-center text-sm text-ink-500 dark:text-ink-400" role="status">
              {errorMessage}
            </p>
          ) : null}

          {query.data && query.data.viewers.length === 0 ? (
            <div data-testid="status-viewers-empty" className="grid place-items-center px-4 py-10 text-center">
              <EyeOff className="h-8 w-8 text-ink-300 dark:text-ink-600" aria-hidden="true" />
              <p className="mt-2 font-semibold">Nobody has viewed this status yet</p>
              <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                People who open your status appear here.
              </p>
            </div>
          ) : null}

          {(query.data?.viewers ?? []).map((viewer) => (
            <div
              key={viewer.id}
              data-testid="status-viewers-row"
              className="flex items-center gap-3 rounded-xl px-2 py-2"
            >
              <Avatar name={viewer.displayName} src={viewer.avatarUrl || undefined} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{viewer.displayName}</p>
                <p className="text-[11px] text-ink-500 dark:text-ink-400">
                  {viewer.viewedAt ? timeAgo(viewer.viewedAt) : 'Earlier'}
                </p>
              </div>
              {viewer.isContact ? (
                <span className="shrink-0 rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500 dark:bg-white/10 dark:text-ink-300">
                  Contact
                </span>
              ) : null}
            </div>
          ))}

          {query.data?.truncated ? (
            <p className="px-2 py-3 text-center text-[11px] text-ink-400">
              Showing the {query.data.viewers.length} most recent of {query.data.count} viewers.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
