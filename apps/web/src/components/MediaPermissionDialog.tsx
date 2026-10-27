import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { AlertTriangle, RotateCcw, ShieldAlert, X } from 'lucide-react';
import {
  dismissMediaIssue,
  getMediaIssue,
  retryMediaIssue,
  subscribeMediaIssue,
  type MediaIssue,
} from '../lib/mediaPermissions';

/**
 * The single explanation for "the microphone/camera did not open".
 *
 * A bare "permission denied" toast is useless on a phone: the user needs the
 * exact taps for their platform, and a button that re-runs the call once the
 * permission is granted. The engine publishes the issue (lib/mediaPermissions)
 * and this dialog renders it, so calls and voice notes share one surface.
 */
export function MediaPermissionDialog() {
  const issue = useSyncExternalStore<MediaIssue | null>(
    useCallback((listener: () => void) => subscribeMediaIssue(() => listener()), []),
    getMediaIssue,
    getMediaIssue,
  );
  const retryRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => dismissMediaIssue(), []);

  useEffect(() => {
    if (!issue) return;
    retryRef.current?.focus();
  }, [issue]);

  useEffect(() => {
    if (!issue) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [issue, close]);

  const steps = useMemo(() => issue?.steps ?? [], [issue]);

  if (!issue) return null;

  return (
    <div
      className="fixed inset-0 z-[95] grid place-items-center bg-black/60 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="media-permission-title"
      data-testid="media-permission-dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-ink-900 dark:text-ink-100">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
            {issue.insecureContext ? <ShieldAlert className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="media-permission-title" className="text-[15px] font-bold leading-snug" data-testid="media-permission-title">
              {issue.title}
            </h2>
            <p className="mt-1 text-[13px] leading-snug text-ink-600 dark:text-ink-300" data-testid="media-permission-message">
              {issue.message}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded-full p-1.5 text-ink-500 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-white/10"
            data-testid="media-permission-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ol className="mt-4 space-y-2" data-testid="media-permission-steps">
          {steps.map((step, index) => (
            <li key={step} className="flex gap-2 text-[12.5px] leading-snug text-ink-700 dark:text-ink-200">
              <span className="mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-ink-100 text-[10.5px] font-bold text-ink-600 dark:bg-white/10 dark:text-ink-300">
                {index + 1}
              </span>
              <span className="min-w-0">{step}</span>
            </li>
          ))}
        </ol>

        <div className="mt-5 flex items-center gap-2">
          {issue.canRetry ? (
            <button
              ref={retryRef}
              type="button"
              className="btn-primary flex-1 !py-2 text-[13px]"
              onClick={() => retryMediaIssue()}
              data-testid="media-permission-try"
            >
              <RotateCcw className="mr-1.5 inline h-4 w-4" />
              Try again
            </button>
          ) : null}
          <button
            type="button"
            className={issue.canRetry ? 'btn-ghost !py-2 text-[13px]' : 'btn-primary flex-1 !py-2 text-[13px]'}
            onClick={close}
            data-testid="media-permission-dismiss"
          >
            {issue.canRetry ? 'Not now' : 'OK'}
          </button>
        </div>

        <p className="mt-3 truncate text-[10.5px] text-ink-400 dark:text-ink-500" data-testid="media-permission-diagnostic">
          {issue.platform} · {issue.errorName}
        </p>
      </div>
    </div>
  );
}
