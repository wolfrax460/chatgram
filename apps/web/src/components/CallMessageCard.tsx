import { Phone, PhoneCall, Video, PhoneMissed, PhoneOff, Users } from 'lucide-react';
import type { CallCardInfo, Message } from '@chatgram/core';
import { formatTime, type TimeFormat } from '../lib/ui';

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

const STATUS_LABELS: Record<CallCardInfo['status'], string> = {
  ringing: 'Ringing',
  completed: 'Ended',
  missed: 'Missed',
  declined: 'Declined',
  busy: 'Busy',
  failed: 'Failed to connect',
  cancelled: 'Cancelled',
};

function callKind(call: CallCardInfo): string {
  const mode = call.video ? 'video' : 'voice';
  if (call.isGroup) return `Group ${mode} call`;
  return call.video ? 'Video call' : 'Voice call';
}

function headline(call: CallCardInfo): string {
  const starter = call.startedBy?.displayName || 'Someone';
  if (call.isGroup) {
    if (call.state === 'ringing') return `${starter} started a ${call.video ? 'video' : 'voice'} call`;
    if (call.state === 'active') return `Ongoing · ${call.participantCount} ${call.participantCount === 1 ? 'person' : 'people'}`;
    if (call.status === 'completed') {
      return `Ended · ${call.participantCount} ${call.participantCount === 1 ? 'person' : 'people'}${
        call.durationSeconds > 0 ? ` · ${formatDuration(call.durationSeconds)}` : ''
      }`;
    }
    return STATUS_LABELS[call.status];
  }
  if (call.state === 'ringing') return `${call.video ? 'Video' : 'Voice'} call started`;
  if (call.state === 'active') return `Ongoing${call.durationSeconds > 0 ? ` · ${formatDuration(call.durationSeconds)}` : ''}`;
  if (call.status === 'completed') {
    return `Ended${call.durationSeconds > 0 ? ` · ${formatDuration(call.durationSeconds)}` : ''}`;
  }
  return STATUS_LABELS[call.status];
}

function StatusIcon({ call }: { call: CallCardInfo }) {
  const className = 'h-4 w-4 shrink-0';
  if (call.status === 'missed' || call.status === 'declined') return <PhoneMissed className={`${className} text-rose-500`} aria-hidden="true" />;
  if (call.status === 'failed') return <PhoneOff className={`${className} text-rose-500`} aria-hidden="true" />;
  if (call.status === 'cancelled' || call.status === 'busy') return <PhoneOff className={`${className} text-amber-500`} aria-hidden="true" />;
  if (call.state === 'ringing') return <PhoneCall className={`${className} text-brand-500`} aria-hidden="true" />;
  return call.video ? <Video className={`${className} text-brand-500`} aria-hidden="true" /> : <Phone className={`${className} text-brand-500`} aria-hidden="true" />;
}

/**
 * A persisted call card inside the conversation (server message type 'call').
 *
 * It is rendered from the server's call metadata, so the same card shows
 * "Ringing · Join / Decline", then "Ongoing · N people · Join", then the right
 * ending (Ended + duration, Missed, Declined, Busy, Failed to connect …).
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
  // Joining from a card is a group-room affordance; a 1:1 card is just history.
  const canJoin = call.isGroup && Boolean(onJoin) && live && !iAmInThisCall && !full;
  const canDecline = call.isGroup && Boolean(onDecline) && call.state === 'ringing' && !startedByMe && !iAmInThisCall;

  return (
    <div className="my-2 flex justify-center" data-testid="call-card">
      <div className="w-full max-w-[420px] rounded-2xl border border-ink-200 bg-white px-3.5 py-2.5 text-ink-800 shadow-sm dark:border-white/10 dark:bg-ink-700 dark:text-ink-100">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600/10 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
            <StatusIcon call={call} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold" data-testid="call-card-title">
              {callKind(call)}
              {call.isGroup ? <Users className="ml-1 inline h-3.5 w-3.5 opacity-60" aria-label="Group call" /> : null}
            </p>
            <p className="mt-0.5 text-[12.5px] text-ink-600 dark:text-ink-300" data-testid="call-card-status">
              {headline(call)}
            </p>
            <p className="mt-0.5 text-[11px] text-ink-500 dark:text-ink-400">
              {formatTime(message.sentAt, timeFormat)}
              {call.startedBy?.displayName && call.isGroup ? ` · started by ${call.startedBy.displayName}` : ''}
            </p>
          </div>
        </div>
        {canJoin || canDecline ? (
          <div className="mt-2 flex items-center gap-2">
            {canJoin ? (
              <button
                type="button"
                onClick={() => onJoin?.(call)}
                aria-label={`Join the ${callKind(call).toLowerCase()}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-emerald-700"
              >
                <PhoneCall className="h-3.5 w-3.5" aria-hidden="true" /> Join
              </button>
            ) : null}
            {canDecline ? (
              <button
                type="button"
                onClick={() => onDecline?.(call)}
                aria-label="Decline the call"
                className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 px-3.5 py-1.5 text-[12px] font-semibold text-ink-700 transition hover:bg-ink-100 dark:border-white/15 dark:text-ink-200 dark:hover:bg-white/10"
              >
                <PhoneOff className="h-3.5 w-3.5" aria-hidden="true" /> Decline
              </button>
            ) : null}
            {full && live ? (
              <span className="text-[11.5px] text-amber-600 dark:text-amber-300">Call is full · {call.participantCount}/{call.capacity}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
