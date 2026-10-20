import type { Message, MessageStatus, User } from '@chatgram/core';

/* ------------------------------------------------------------------- time */

export type TimeFormat = '12h' | '24h';

export function formatTime(iso: string | undefined, format: TimeFormat = '12h'): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: format === '12h',
  });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "Today" / "Yesterday" / a locale date. */
export function dateSeparatorLabel(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (isSameDay(date, now)) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'Yesterday';

  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

export function sameDay(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return isSameDay(new Date(a), new Date(b));
}

/** "last seen today at 9:19 AM" */
export function lastSeenLabel(iso: string | undefined, format: TimeFormat): string {
  if (!iso) return 'offline';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'offline';
  const now = new Date();
  const time = formatTime(iso, format);

  if (isSameDay(date, now)) return `last seen today at ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return `last seen yesterday at ${time}`;

  const day = date.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return `last seen ${day} at ${time}`;
}

/* ---------------------------------------------------------------- avatars */

/**
 * Initials from the first and last word: "Chatgram Support" -> "CS".
 * Falls back to the first two characters for single-word names.
 */
export function initialsFor(name: string | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  const first = words[0]![0] ?? '';
  const last = words[words.length - 1]![0] ?? '';
  return `${first}${last}`.toUpperCase();
}

const AVATAR_COLORS = [
  'from-emerald-500 to-teal-700',
  'from-sky-500 to-indigo-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-violet-500 to-purple-700',
  'from-cyan-500 to-blue-600',
  'from-fuchsia-500 to-rose-600',
  'from-lime-500 to-green-700',
];

/** Stable colour per user id — same person always gets the same avatar colour. */
export function avatarGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

/* ------------------------------------------------------------ message meta */

/** Delivery state of a message from the current user's perspective. */
export function statusOf(
  message: Message,
  meId: string,
  participantIds: string[],
): MessageStatus {
  if (message.failed) return 'failed';
  if (message.id.startsWith('tmp-')) return 'sending';

  const others = participantIds.filter((id) => id !== meId);
  if (others.length === 0) return 'sent';
  if (message.readBy.some((id) => others.includes(id))) return 'read';
  if (message.deliveredTo.some((id) => others.includes(id))) return 'delivered';
  return 'sent';
}

/** Text preview for the chat list, with a "You:" prefix for own messages. */
export function previewText(message: Message | undefined, meId: string): string {
  if (!message) return 'No messages yet';
  const body =
    message.content?.trim() ||
    (message.type === 'image'
      ? 'Photo'
      : message.type === 'video'
        ? 'Video'
        : message.type === 'audio'
          ? 'Voice message'
          : message.type === 'file'
            ? 'Document'
            : '');
  const mine = message.senderId === meId;
  return mine ? `You: ${body}` : body;
}

export function partnerOf(
  participants: User[],
  meId: string,
): User | undefined {
  return participants.find((p) => p.id !== meId);
}
