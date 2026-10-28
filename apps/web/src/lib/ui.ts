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

/* ---------------------------------------------------------------- replies */

/**
 * WhatsApp-style replies are carried as text markup on the message itself
 * (`> Author: snippet\n` + the reply text) — the API has no reply field. These
 * helpers keep that one contract in a single place: the composer preview, the
 * quoted card in the bubble and the "jump to the original" lookup all use them.
 */
export interface ReplyQuote {
  /** Display name of the original sender ("You" for my own messages). */
  author: string;
  /** One-line snippet of the original message (media labels included). */
  text: string;
}

function collapse(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * What a quoted reply should show for `message`: the media label instead of a
 * URL/markup, the file name for documents, otherwise the text itself.
 * Single line, so it is safe to embed in the `> Author: snippet` markup.
 */
export function quoteSnippetOf(message: Message): string {
  switch (message.type) {
    case 'image':
      return 'Photo';
    case 'video':
      return 'Video';
    case 'audio':
      return 'Voice message';
    case 'file': {
      const name = collapse(message.content);
      return name ? `Document · ${name}` : 'Document';
    }
    case 'call':
      return 'Call';
    case 'system':
      return collapse(message.content);
    default: {
      const quoted = splitReplyMarkup(message.content);
      if (!quoted) return collapse(message.content);
      // Replying to a reply quotes what *that* message said, not its own quote
      // (and never the raw `> Author: snippet` markup).
      return collapse(quoted.body) || quoted.text;
    }
  }
}

/**
 * Split the reply markup off a message's text.
 * Returns null when the message is not a reply.
 */
export function splitReplyMarkup(
  content: string | undefined,
): (ReplyQuote & { body: string }) | null {
  const value = content ?? '';
  const match = value.match(/^> ([^:\n]{1,120}): (.*)(?:\n([\s\S]*))?$/);
  if (!match) return null;
  const author = collapse(match[1]);
  const text = collapse(match[2]);
  const body = (match[3] ?? '').replace(/^\n/, '');
  if (!author) return null;
  return { author, text, body };
}

/**
 * Find the loaded message a quote points at. The markup carries no id, so the
 * author + snippet are matched against the loaded page (newest match wins).
 */
export function findQuotedMessage(
  messages: Message[],
  quote: ReplyQuote,
  meId: string,
): Message | undefined {
  const wanted = collapse(quote.text).toLowerCase();
  if (!wanted) return undefined;
  const author = collapse(quote.author).toLowerCase();
  const sameAuthor = (message: Message): boolean => {
    if (author === 'you') return message.senderId === meId;
    const name = collapse(message.sender?.displayName).toLowerCase();
    return Boolean(name) && name === author;
  };
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || !sameAuthor(message)) continue;
    const snippet = collapse(quoteSnippetOf(message)).toLowerCase();
    if (!snippet) continue;
    // The snippet was capped when the reply was written, so compare prefixes.
    if (snippet === wanted || snippet.startsWith(wanted) || wanted.startsWith(snippet)) {
      return message;
    }
  }
  return undefined;
}

