import { useEffect, useRef, useState } from 'react';
import { Bug, Check, Copy, Loader2, Send } from 'lucide-react';
import {
  MAX_ERROR_REPORT_CHARS,
  copyErrorReportText,
  defaultErrorReportContext,
  queueLocalErrorReport,
  submitErrorReport,
} from '../../lib/errorReport';
import { SettingsDialog, SettingsNotice, focusRing } from './ui';

interface ReportView {
  kind: 'bug' | 'feature';
  prompt: string;
  summary: string;
  local: boolean;
}

/**
 * "Report a problem" / "Report a bad AI answer" — the same Help error-report
 * flow used by the Errors tab (POST /api/help/error-report, local template
 * fallback with an honest "saved locally" state). Rendered as a dialog here so
 * Settings does not have to leave its own navigation.
 */
export function ReportProblemDialog({
  onClose,
  title = 'Report a problem',
  initialMessage = '',
  lastAction,
}: {
  onClose: () => void;
  title?: string;
  initialMessage?: string;
  lastAction?: string;
}) {
  const [message, setMessage] = useState(initialMessage);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [result, setResult] = useState<ReportView | null>(null);
  const [copied, setCopied] = useState(false);
  const promptRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (result) promptRef.current?.focus();
  }, [result]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setErrorText('');
    try {
      const context = { ...defaultErrorReportContext(), lastAction };
      const outcome = await submitErrorReport({ message: text, context });
      if (outcome.status === 'sent') {
        setResult({ kind: outcome.result.kind, prompt: outcome.result.prompt, summary: outcome.result.summary, local: false });
      } else if (outcome.status === 'queued') {
        setResult({ kind: outcome.report.kind, prompt: outcome.report.prompt, summary: outcome.report.summary, local: true });
      } else {
        // A rejected report is still saved locally with the same prompt, so the
        // user never loses what they typed.
        const queued = queueLocalErrorReport({ message: text, context });
        setResult({ kind: queued.kind, prompt: queued.prompt, summary: queued.summary, local: true });
        setErrorText(outcome.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyPrompt() {
    if (!result) return;
    const ok = await copyErrorReportText(result.prompt);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <SettingsDialog
      title={title}
      description="Tell us what went wrong. We turn it into a precise debugging prompt for the team."
      onClose={onClose}
      testId="settings-report-dialog"
      footer={
        result ? (
          <button type="button" className={`btn-primary flex-1 ${focusRing}`} onClick={() => void copyPrompt()}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy prompt'}
          </button>
        ) : (
          <>
            <button type="submit" form="settings-report-form" className={`btn-primary flex-1 ${focusRing}`} disabled={busy || !message.trim()} aria-busy={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {busy ? 'Preparing prompt…' : 'Report problem'}
            </button>
            <button type="button" className={`btn-ghost ${focusRing}`} onClick={onClose}>
              Cancel
            </button>
          </>
        )
      }
    >
      {result ? (
        <div aria-live="polite">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-rose-700 dark:text-rose-300">
              <Bug className="h-3 w-3" /> {result.kind === 'feature' ? 'Feature request' : 'Bug'}
            </span>
            <span className={`ml-auto text-[11px] font-semibold ${result.local ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
              {result.local ? 'Saved locally' : 'Sent to the team'}
            </span>
          </div>
          <p className="mt-1.5 text-[12.5px] font-semibold">{result.summary}</p>
          <pre
            ref={promptRef}
            tabIndex={-1}
            data-testid="settings-report-prompt"
            aria-label="Generated debugging prompt"
            className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ink-100 p-2 text-[11.5px] leading-snug outline-none focus:ring-2 focus:ring-brand-500/60 dark:bg-white/10"
          >
            {result.prompt}
          </pre>
          <p className={`mt-1.5 text-[11.5px] leading-snug ${result.local ? 'text-amber-700 dark:text-amber-300' : 'text-ink-500 dark:text-ink-400'}`}>
            {result.local
              ? 'Saved locally — the team server did not accept the report. It will be retried when Help opens.'
              : 'Sent to the team. You can paste this prompt into your coding tool.'}
          </p>
          {errorText ? <div className="mt-1.5"><SettingsNotice tone="warning">{errorText}</SettingsNotice></div> : null}
        </div>
      ) : (
        <form id="settings-report-form" onSubmit={(event) => void submit(event)} noValidate>
          <label className="label" htmlFor="settings-report-input">
            What went wrong?
          </label>
          <textarea
            id="settings-report-input"
            className="field min-h-[96px] resize-y"
            maxLength={MAX_ERROR_REPORT_CHARS}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="e.g. The Chatgram AI answer was wrong: it said … but actually …"
          />
          <p className="mt-1 text-right text-[11px] text-ink-500 dark:text-ink-400">
            {MAX_ERROR_REPORT_CHARS - message.length} characters left
          </p>
          <p className="mt-1 text-[11px] leading-snug text-ink-500 dark:text-ink-400">
            Only this text and safe details (app version, platform, current screen) are sent. Never include
            passwords, codes, other people&apos;s messages, phone numbers or email addresses.
          </p>
        </form>
      )}
    </SettingsDialog>
  );
}
