import { Lock, Pause, Play, Send, X } from 'lucide-react';
import { formatDuration } from '../lib/useVoiceRecorder';

/**
 * The recording bar shown over the composer while a voice note is being
 * recorded. Mirrors WhatsApp: X / slide-to-cancel on the left, a pulsing dot and
 * the live timer in the middle, then lock, pause/resume and send.
 *
 * `holding` is true while the mic button is physically held (slide gestures are
 * possible); after a tap (hands-free) or a lock there is nothing to slide, so
 * the hint changes.
 */
export function VoiceRecorderBar({
  seconds,
  paused,
  locked,
  holding,
  cancelArmed,
  onCancel,
  onTogglePause,
  onLock,
  onSend,
}: {
  seconds: number;
  paused: boolean;
  locked: boolean;
  holding: boolean;
  /** True while the finger has been dragged over the cancel target. */
  cancelArmed: boolean;
  onCancel: () => void;
  onTogglePause: () => void;
  onLock: () => void;
  onSend: () => void;
}) {
  const hint = cancelArmed
    ? 'Release to cancel'
    : holding
      ? 'Slide to cancel'
      : paused
        ? 'Paused'
        : locked
          ? 'Locked'
          : 'Tap to send';

  return (
    <div
      data-testid="voice-recording-bar"
      tabIndex={-1}
      className="absolute inset-0 z-20 flex items-center gap-1.5 bg-white px-2.5 py-2 outline-none dark:bg-ink-900"
    >
      <button
        type="button"
        data-testid="voice-slide-cancel"
        aria-label="Cancel recording"
        title="Cancel recording"
        onClick={onCancel}
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition active:scale-95 ${
          cancelArmed
            ? 'bg-rose-600 text-white'
            : 'text-ink-500 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-white/10'
        }`}
      >
        <X className="h-5 w-5" />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-rose-500/10 px-2.5 py-1.5">
        <span
          aria-hidden="true"
          className={`h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500 ${
            paused ? 'opacity-60' : 'animate-pulse'
          }`}
        />
        <span
          data-testid="voice-timer"
          aria-live="polite"
          aria-atomic="true"
          className="shrink-0 text-sm font-semibold tabular-nums text-rose-600 dark:text-rose-300"
        >
          {formatDuration(seconds)}
        </span>
        <span
          className={`min-w-0 truncate text-[11px] ${
            cancelArmed ? 'font-semibold text-rose-600 dark:text-rose-300' : 'text-ink-500 dark:text-ink-400'
          }`}
        >
          {hint}
        </span>
      </div>

      {!locked ? (
        <button
          type="button"
          data-testid="voice-lock"
          aria-label="Lock recording"
          title="Lock recording"
          onClick={onLock}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-500 transition hover:bg-ink-100 active:scale-95 dark:text-ink-300 dark:hover:bg-white/10"
        >
          <Lock className="h-4 w-4" />
        </button>
      ) : null}

      <button
        type="button"
        data-testid="voice-pause"
        aria-label={paused ? 'Resume recording' : 'Pause recording'}
        title={paused ? 'Resume recording' : 'Pause recording'}
        onClick={onTogglePause}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-500 transition hover:bg-ink-100 active:scale-95 dark:text-ink-300 dark:hover:bg-white/10"
      >
        {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
      </button>

      <button
        type="button"
        aria-label="Send voice message"
        title="Stop recording and send"
        onClick={onSend}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-white transition hover:bg-brand-700 active:scale-95"
      >
        <Send className="h-4 w-4" />
      </button>
    </div>
  );
}
