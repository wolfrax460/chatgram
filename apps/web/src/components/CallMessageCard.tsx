import { Phone, PhoneMissed, PhoneOff, Video } from 'lucide-react';
import type { CallCardInfo, Message } from '@chatgram/core';
import { startCall } from '../lib/calls';
import { formatTime, type TimeFormat } from '../lib/ui';

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

/** The compact one-liner's leading label: what kind of call it was. */
function callLabel(call: CallCardInfo): string {
  const mode = call.video ? 'video' : 'voice';
  const group = call.isGroup ? 'group ' : '';
  if (call.status === 'missed') return `Missed ${group}${mode} call`;
  if (call.status === 'declined') return `Declined ${group}${mode} call`;
  return `${group ? 'Group ' : ''}${call.video ? 'Video' : 'Voice'} call`;
}

/** The secondary segment after the dot: state, duration or the failure reason. */
function callDetail(call: CallCardInfo): string | null {
  if (call.state === 'active') return call.durationSeconds > 0 ? `Ongoing · ${formatDuration(call.durationSeconds)}` : 'Ongoing';
  if (call.status === 'completed') return call.durationSeconds > 0 ? formatDuration(call.durationSeconds) : 'Ended';
  if (call.status === 'ringing') return 'Ringing';
  if (call.status === 'busy') return 'Busy';
  if (call.status === 'failed') return 'Failed to connect';
  if (call.status === 'cancelled') return 'Cancelled';
  return null;
}

function StatusIcon({ call }: { call: CallCardInfo }) {
  const className = 'h-[18px] w-[18px] shrink-0';
  if (call.status === 'missed' || call.status === 'declined') return <PhoneMissed className={`${className} text-rose-500`} aria-hidden="true" />;
  if (call.status === 'failed') return <PhoneOff className={`${className} text-rose-500`} aria-hidden="true" />;
  if (call.status === 'cancelled' || call.status === 'busy') return <PhoneOff className={`${className} text-amber-500`} aria-hidden="true" />;
  return call.video ? <Video className={`${className} text-brand-500`} aria-hidden="true" /> : <Phone className={`${className} text-brand-500`} aria-hidden="true" />;
}

/**
 * A persisted call row inside the conversation (server message type 'call').
 *
 * Compact one-line history row: leading status icon, the call text, the message
 * time on the right. Tap the row to join a live group room or to call back.
 * The server keeps the metadata live through `call:card-updated`.
 */
export function CallMessageCard({
  message,
  timeFormat,
  meId,
  activeCallId,
  onJoin,
  onDecline,
}: {
  message: Message;
  timeFormat: TimeFormat;
  meId: string;
  /** The call I am currently in (hides Join for that same room). */
  activeCallId?: string | null;
  onJoin?: (call: CallCardInfo) => void;
  onDecline?: (call: CallCardInfo) => void;
}) {
  const call = message.call;
  if (!call) return null;

  const startedByMe = call.startedBy?.id === meId;
  const iAmInThisCall = activeCallId === call.callId;
  const live = call.state !== 'ended' && call.status !== 'completed';
  const full = call.capacity > 0 && call.participantCount >= call.capacity;
  // A live group room can be joined from the row; a 1:1 row is just history.
  const canJoin = call.isGroup && Boolean(onJoin) && live && !iAmInThisCall && !full;
  const canDecline = call.isGroup && Boolean(onDecline) && call.state === 'ringing' && !startedByMe && !iAmInThisCall;

  const label = callLabel(call);
  const detail = callDetail(call);
  const actionLabel = canJoin ? `Join the ${label.toLowerCase()}` : live ? label : `Call back · ${label}`;

  const activate = (): void => {
    if (live) {
      // A ringing/active room: join it when possible, never dial a second call.
      if (canJoin) onJoin?.(call);
      return;
    }
    // History row: dial the same chat again, voice or video as before. When the
    // caller passed no call actions at all (read-only surfaces), nothing happens.
    if (!onJoin && !onDecline) return;
    void startCall(
      { chatId: call.chatId, title: call.title, isGroup: call.isGroup, participantCount: call.participantCount },
      { video: call.video },
    );
  };

  // "Message" focuses the conversation composer; the call card itself must not
  // navigate or send anything (the composer owns sending).
  const focusComposer = (): void => {
    const input = document.querySelector<HTMLElement>('[data-testid="composer-input"], textarea, [contenteditable="true"]');
    if (!input) return;
    input.focus();
    input.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  };

  const showSummary = !live && call.status === 'completed' && Boolean(onJoin);

  return (
    <div className="my-1 flex justify-center" data-testid="call-card">
      <div className="flex w-full max-w-[420px] flex-col gap-1">
        <div className="flex w-full items-center gap-1">
          <button
            type="button"
            onClick={activate}
            aria-label={actionLabel}
            title={actionLabel}
            data-testid="call-history-row"
            className="group flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-full px-2.5 py-1 text-left transition hover:bg-ink-100/80 dark:hover:bg-white/5"
          >
            <StatusIcon call={call} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-800 dark:text-ink-100" data-testid="call-card-title">
              {label}
            </span>
            {detail ? (
              <span className="shrink-0 text-[12px] text-ink-500 dark:text-ink-400" data-testid="call-card-status">
                · {detail}
              </span>
            ) : null}
            <span className="shrink-0 text-[11px] text-ink-500 dark:text-ink-400">{formatTime(message.sentAt, timeFormat)}</span>
          </button>
          {canDecline ? (
            <button
              type="button"
              onClick={() => onDecline?.(call)}
              aria-label="Decline the call"
              title="Decline"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-rose-500 transition hover:bg-rose-500/10"
            >
              <PhoneOff className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {showSummary ? (
          <div className="flex items-center gap-2 pl-8 text-[12px]" data-testid="call-summary-actions">
            <span className="text-ink-500 dark:text-ink-400">
              {call.durationSeconds > 0 ? `Duration ${formatDuration(call.durationSeconds)}` : 'No answer'}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              data-testid="call-summary-back"
              onClick={activate}
              className="rounded-full bg-brand-600 px-3 py-1 font-semibold text-white transition hover:bg-brand-700"
            >
              Call back
            </button>
            <button
              type="button"
              data-testid="call-summary-message"
              onClick={focusComposer}
              className="rounded-full bg-ink-100 px-3 py-1 font-semibold text-ink-700 transition hover:bg-ink-200 dark:bg-white/10 dark:text-ink-100 dark:hover:bg-white/20"
            >
              Message
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
