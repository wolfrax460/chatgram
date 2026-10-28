import { useCallback, useEffect, useRef, useState } from 'react';
import { Bug, Check, Copy, Lightbulb, Loader2, Send, X } from 'lucide-react';
import {
  MAX_ERROR_REPORT_CHARS,
  copyErrorReportText,
  defaultErrorReportContext,
  loadPendingErrorReports,
  platformLabel,
  queueLocalErrorReport,
  removePendingErrorReport,
  submitErrorReport,
  type ErrorReportContext,
  type ErrorReportKind,
  type PendingErrorReport,
} from '../lib/errorReport';

/** One auto-collected fact, rendered as a removable chip. */
type ChipKey = 'appVersion' | 'platform' | 'screen' | 'lastAction';

interface ContextChip {
  key: ChipKey;
  label: string;
  value: string;
  /** Screen and last action can be corrected inline; version/platform cannot. */
  editable: boolean;
}

interface ReportResultView {
  kind: ErrorReportKind;
  prompt: string;
  summary: string;
  /** True when the server did not take it and the prompt was built locally. */
  local: boolean;
}

function KindBadge({ kind, testId }: { kind: ErrorReportKind; testId?: string }) {
  const feature = kind === 'feature';
  return (
    <span
      data-testid={testId}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ${
        feature
          ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300'
          : 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
      }`}
    >
      {feature ? <Lightbulb className="h-3 w-3" /> : <Bug className="h-3 w-3" />}
      {feature ? 'Feature request' : 'Bug'}
    </span>
  );
}

/**
 * Help → Errors: describe a problem, attach safe context, and receive a precise
 * debugging / feature-request prompt (from the server when available, from the
 * local template otherwise).
 */
export default function HelpErrorsTab({
  signedIn,
  lastAction,
  refreshKey,
}: {
  signedIn: boolean;
  /** Last meaningful action in the help widget, attached when available. */
  lastAction?: string;
  /** Bumped by the widget after a background retry delivered saved reports. */
  refreshKey: number;
}) {
  const [message, setMessage] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [context, setContext] = useState<ErrorReportContext>(() => defaultErrorReportContext());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReportResultView | null>(null);
  const [errorText, setErrorText] = useState('');
  const [copied, setCopied] = useState(false);
  const [copiedPendingId, setCopiedPendingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingErrorReport[]>(() => loadPendingErrorReports());
  const promptRef = useRef<HTMLPreElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  // The widget knows the last place the user was; keep it in the context.
  useEffect(() => {
    if (!lastAction) return;
    setContext((previous) => ({ ...previous, lastAction }));
  }, [lastAction]);

  useEffect(() => {
    setPending(loadPendingErrorReports());
  }, [refreshKey]);

  // Focus moves to the generated prompt when it appears.
  useEffect(() => {
    if (result) promptRef.current?.focus();
  }, [result]);

  const remaining = MAX_ERROR_REPORT_CHARS - message.length;

  const removeChip = useCallback((key: ChipKey) => {
    setContext((previous) => {
      const next: ErrorReportContext = { ...previous };
      delete next[key];
      return next;
    });
  }, []);

  function updateChip(key: 'screen' | 'lastAction', value: string) {
    setContext((previous) => ({ ...previous, [key]: value }));
  }

  const chips: ContextChip[] = [];
  if (context.appVersion) {
    chips.push({ key: 'appVersion', label: 'App version', value: context.appVersion, editable: false });
  }
  if (context.platform) {
    chips.push({ key: 'platform', label: 'Platform', value: platformLabel(context.platform), editable: false });
  }
  if (context.screen !== undefined) {
    chips.push({ key: 'screen', label: 'Screen', value: context.screen, editable: true });
  }
  if (context.lastAction) {
    chips.push({ key: 'lastAction', label: 'Last action', value: context.lastAction, editable: true });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setErrorText('');
    setCopied(false);
    const finalContext: ErrorReportContext = {
      ...context,
      lastAction: actionNote.trim() || context.lastAction,
    };
    try {
      if (!signedIn) {
        // The endpoint requires a signed-in session: keep the report locally and
        // say so, instead of firing a request that is certain to fail.
        const report = queueLocalErrorReport({ message: text, context: finalContext });
        setResult({ kind: report.kind, prompt: report.prompt, summary: report.summary, local: true });
        setPending(loadPendingErrorReports());
        return;
      }
      const outcome = await submitErrorReport({ message: text, context: finalContext });
      if (outcome.status === 'sent') {
        setResult({
          kind: outcome.result.kind,
          prompt: outcome.result.prompt,
          summary: outcome.result.summary,
          local: false,
        });
      } else if (outcome.status === 'queued') {
        setResult({
          kind: outcome.report.kind,
          prompt: outcome.report.prompt,
          summary: outcome.report.summary,
          local: true,
        });
        setPending(loadPendingErrorReports());
      } else {
        setErrorText(outcome.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function reportAnother() {
    setResult(null);
    setMessage('');
    setActionNote('');
    setErrorText('');
    setCopied(false);
    setContext(defaultErrorReportContext());
    window.requestAnimationFrame(() => messageRef.current?.focus());
  }

  async function copyPrompt() {
    if (!result) return;
    const ok = await copyErrorReportText(result.prompt);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1500);
  }

  async function copyPending(report: PendingErrorReport) {
    const ok = await copyErrorReportText(report.prompt);
    setCopiedPendingId(ok ? report.localId : null);
    if (ok) window.setTimeout(() => setCopiedPendingId(null), 1500);
  }

  function discardPending(localId: string) {
    setPending(removePendingErrorReport(localId));
  }

  return (
    <div className="p-3" data-testid="help-errors-panel">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">
        Errors &amp; feature requests
      </p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-600 dark:text-ink-300">
        Tell us what went wrong. We turn it into a precise debugging prompt for the team.
      </p>

      {result ? (
        <div
          aria-live="polite"
          className="mt-3 rounded-xl border border-ink-200 p-3 dark:border-white/10"
          data-testid="error-report-result"
        >
          <div className="flex items-center gap-2">
            <KindBadge kind={result.kind} testId="error-report-kind" />
            <span
              className={`ml-auto text-[11px] font-semibold ${
                result.local ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'
              }`}
            >
              {result.local ? 'Saved locally' : 'Sent to the team'}
            </span>
          </div>
          <p className="mt-1.5 text-[12.5px] font-semibold">{result.summary}</p>
          <pre
            ref={promptRef}
            tabIndex={-1}
            data-testid="error-report-prompt"
            aria-label="Generated debugging prompt"
            className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ink-100 p-2 text-[11.5px] leading-snug text-ink-800 outline-none focus:ring-2 focus:ring-brand-500/60 dark:bg-white/5 dark:text-ink-100"
          >
            {result.prompt}
          </pre>
          <p
            className={`mt-1.5 text-[11.5px] leading-snug ${
              result.local ? 'text-amber-700 dark:text-amber-300' : 'text-ink-500 dark:text-ink-400'
            }`}
          >
            {result.local
              ? 'Saved locally — the team server did not accept the report.'
              : 'Sent to the team. You can paste this prompt into your coding tool.'}
            {result.local && signedIn ? ' We will retry when you open Help again.' : ''}
            {result.local && !signedIn ? ' Sign in and open Help again to send it.' : ''}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              data-testid="error-report-copy"
              onClick={() => void copyPrompt()}
              className="btn-primary flex-1 !py-1.5 text-[12px]"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy prompt'}
            </button>
            <button
              type="button"
              data-testid="error-report-another"
              onClick={reportAnother}
              className="btn-ghost text-[12px]"
            >
              Report another
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="mt-3 space-y-2" noValidate>
          <label htmlFor="error-report-input" className="label">
            What went wrong?
          </label>
          <textarea
            id="error-report-input"
            data-testid="error-report-input"
            ref={messageRef}
            className="field min-h-[92px] resize-y"
            maxLength={MAX_ERROR_REPORT_CHARS}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            aria-describedby="error-report-count"
            placeholder="e.g. I replied to a message and my reply showed for a second, then disappeared."
          />
          <p
            id="error-report-count"
            className={`text-right text-[11px] ${
              remaining < 100 ? 'text-amber-600 dark:text-amber-300' : 'text-ink-500 dark:text-ink-400'
            }`}
          >
            {remaining} characters left
          </p>

          <label htmlFor="error-report-action" className="label">
            What were you doing? <span className="font-normal text-ink-500 dark:text-ink-400">(optional)</span>
          </label>
          <input
            id="error-report-action"
            data-testid="error-report-action"
            className="field"
            value={actionNote}
            onChange={(event) => setActionNote(event.target.value)}
            placeholder="e.g. Replying in a group on the Android app"
          />

          <div>
            <p className="label">Details we attach automatically</p>
            <div data-testid="error-report-context" className="flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <span
                  key={chip.key}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-ink-200 bg-ink-50 px-2 py-0.5 text-[11px] text-ink-700 dark:border-white/10 dark:bg-white/5 dark:text-ink-200"
                >
                  <span className="shrink-0 font-semibold">{chip.label}:</span>
                  {chip.editable ? (
                    <input
                      aria-label={chip.label}
                      value={chip.value}
                      onChange={(event) =>
                        updateChip(chip.key === 'screen' ? 'screen' : 'lastAction', event.target.value)
                      }
                      className="w-32 min-w-0 appearance-none rounded-none border-0 bg-transparent p-0 text-[11px] text-inherit outline-none focus:ring-0"
                    />
                  ) : (
                    <span className="truncate">{chip.value}</span>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${chip.label}`}
                    onClick={() => removeChip(chip.key)}
                    className="shrink-0 rounded-full p-0.5 text-ink-500 hover:bg-ink-200/60 hover:text-ink-800 dark:hover:bg-white/10 dark:hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <p className="mt-1 text-[11px] leading-snug text-ink-500 dark:text-ink-400">
              Only this text and the details above are sent. Never include passwords, verification codes, other
              people&apos;s messages, phone numbers or email addresses — they are not collected automatically.
            </p>
          </div>

          {errorText ? (
            <p
              role="alert"
              className="rounded-xl border border-rose-300/50 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
            >
              {errorText}
            </p>
          ) : null}

          <button
            type="submit"
            data-testid="error-report-submit"
            disabled={busy || !message.trim()}
            aria-busy={busy}
            className="btn-primary w-full"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {busy ? 'Preparing prompt…' : 'Report error'}
          </button>
        </form>
      )}

      {pending.length > 0 ? (
        <div className="mt-4" data-testid="error-report-pending">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">
            Saved reports ({pending.length})
          </p>
          <p className="text-[11px] text-ink-500 dark:text-ink-400">
            Kept on this device and retried when Help opens.
          </p>
          {pending.map((report) => (
            <div
              key={report.localId}
              className="mt-2 rounded-xl border border-amber-300/50 bg-amber-50/60 p-2 dark:border-amber-500/30 dark:bg-amber-500/10"
            >
              <div className="flex items-start gap-2">
                <KindBadge kind={report.kind} />
                <span className="min-w-0 flex-1 truncate text-[12px]">{report.summary}</span>
                <button
                  type="button"
                  aria-label="Discard saved report"
                  onClick={() => discardPending(report.localId)}
                  className="shrink-0 rounded-full p-0.5 text-ink-500 hover:bg-ink-200/60 hover:text-ink-800 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <button
                  type="button"
                  className="btn-ghost !px-2 !py-1 text-[11px]"
                  onClick={() => void copyPending(report)}
                >
                  {copiedPendingId === report.localId ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {copiedPendingId === report.localId ? 'Copied' : 'Copy prompt'}
                </button>
                <span className="text-[10.5px] text-ink-500 dark:text-ink-400">
                  {new Date(report.createdAt).toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
