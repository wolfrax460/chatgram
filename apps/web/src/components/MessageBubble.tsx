import { useState } from 'react';
import { Reply, Copy, Trash2, MoreVertical, Smile, Pin, Eye, Pencil, Star, Forward, Flag, Check, X, Lock, Share2 } from 'lucide-react';
import type { CallCardInfo, Message, MessageStatus } from '@chatgram/core';
import { MessageMedia } from './MessageMedia';
import { MessageTicks } from './MessageTicks';
import { CallMessageCard } from './CallMessageCard';
import { formatTime, type TimeFormat } from '../lib/ui';

export interface BubbleActions {
  onReply: (message: Message) => void;
  onDelete: (message: Message, scope: 'me' | 'everyone') => void;
  onReact: (message: Message, emoji: string) => void;
  /** Open the sender's profile panel (used in groups). */
  onOpenProfile?: (userId: string) => void;
  /** Pin this message in a group. */
  onPin?: (message: Message) => void;
  /** Show who has seen one of my messages. */
  onSeenBy?: (message: Message) => void;
  /** Edit my own text message. */
  onEdit?: (message: Message, content: string) => void;
  /** Star / unstar for me. */
  onStar?: (message: Message) => void;
  /** Forward to another chat. */
  onForward?: (message: Message) => void;
  /** Report this message to the moderation team. */
  onReport?: (message: Message) => void;
  /** Reveal a private group AI answer to the whole group (asker only). */
  onShareWithGroup?: (message: Message) => void;
  /** Group call card: join the live room. */
  onCallJoin?: (call: CallCardInfo) => void;
  /** Group call card: decline the ring. */
  onCallDecline?: (call: CallCardInfo) => void;
  /** The call I am currently in (so the card hides Join for that room). */
  activeCallId?: string | null;
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/**
 * One message bubble: grouping, hover actions (react / reply / copy / delete),
 * reaction chips and delivery ticks.
 */
export function MessageBubble({
  message,
  meId,
  status,
  timeFormat,
  firstInGroup,
  lastInGroup,
  actions,
}: {
  message: Message;
  meId: string;
  status: MessageStatus;
  timeFormat: TimeFormat;
  firstInGroup: boolean;
  lastInGroup: boolean;
  actions: BubbleActions;
}) {
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const mine = message.senderId === meId;
  const senderName = message.sender?.displayName;
  // Chunk 1C: hidden AI questions/answers only ever reach the asker, so a
  // non-empty visibleTo means "only you can see this".
  const isPrivate = message.private === true || (message.visibleTo?.length ?? 0) > 0;

  const grouped = message.reactions.reduce<Record<string, number>>((acc, reaction) => {
    acc[reaction.emoji] = (acc[reaction.emoji] ?? 0) + 1;
    return acc;
  }, {});

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content ?? message.mediaUrl ?? '');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
    setMenuOpen(false);
  }

  const hoverBtn =
    'grid h-7 w-7 place-items-center rounded-full text-ink-500 hover:bg-ink-200/60 dark:text-ink-300 dark:hover:bg-white/10';

  // Group events ("Alice left", "Bob is now an admin") are rendered as a
  // centred pill, never as a normal bubble.
  if (message.type === 'system') {
    return (
      <div className="my-2 flex justify-center" data-testid="system-message">
        <span className="max-w-[85%] rounded-full bg-ink-200/70 px-3 py-1 text-center text-[11.5px] font-medium text-ink-700 dark:bg-white/10 dark:text-ink-200">
          {message.content}
        </span>
      </div>
    );
  }

  // Call cards are their own centred card (live state comes from the server).
  if (message.type === 'call' && message.call) {
    return (
      <CallMessageCard
        message={message}
        timeFormat={timeFormat}
        meId={meId}
        activeCallId={actions.activeCallId}
        onJoin={actions.onCallJoin}
        onDecline={actions.onCallDecline}
      />
    );
  }

  /** Highlight @mentions in the message text. */
  function renderContent(text: string) {
    const parts = text.split(/(@[\w.\-]+)/g);
    return parts.map((part, index) =>
      /^@[\w.\-]+$/.test(part) ? (
        <span key={index} className={`font-semibold ${mine ? 'text-white underline' : 'text-brand-600 dark:text-brand-300'}`}>
          {part}
        </span>
      ) : (
        <span key={index}>{part}</span>
      ),
    );
  }

  return (
    <div
      className={`group flex w-full ${mine ? 'justify-end' : 'justify-start'} ${
        firstInGroup ? 'mt-2' : 'mt-[3px]'
      }`}
    >
      <div className={`relative flex max-w-[65%] items-center gap-1 ${mine ? 'flex-row' : 'flex-row-reverse'}`}>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
          <button type="button" className={hoverBtn} title="React" onClick={() => setReactOpen((v) => !v)}>
            <Smile className="h-4 w-4" />
          </button>
          <button type="button" className={hoverBtn} title="Reply" onClick={() => actions.onReply(message)}>
            <Reply className="h-4 w-4" />
          </button>
          <button type="button" className={hoverBtn} title={copied ? 'Copied' : 'Copy'} onClick={copy}>
            <Copy className="h-4 w-4" />
          </button>
          <button type="button" className={hoverBtn} title="More" onClick={() => setMenuOpen((v) => !v)}>
            <MoreVertical className="h-4 w-4" />
          </button>
        </div>

        {reactOpen ? (
          <div
            className={`absolute -top-9 z-20 flex gap-0.5 rounded-full border border-ink-200 bg-white px-1.5 py-1 shadow-lg dark:border-white/10 dark:bg-ink-700 ${
              mine ? 'right-0' : 'left-0'
            }`}
          >
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="rounded-full px-1 text-lg hover:bg-ink-100 dark:hover:bg-white/10"
                onClick={() => {
                  actions.onReact(message, emoji);
                  setReactOpen(false);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}

        {menuOpen ? (
          <div
            className={`absolute top-8 z-20 w-48 overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-ink-700 ${
              mine ? 'right-full mr-1' : 'left-full ml-1'
            }`}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
              onClick={() => {
                actions.onDelete(message, 'me');
                setMenuOpen(false);
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete for me
            </button>
            {mine ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                onClick={() => {
                  actions.onDelete(message, 'everyone');
                  setMenuOpen(false);
                }}
              >
                <Trash2 className="h-4 w-4" /> Delete for everyone
              </button>
            ) : null}
            {actions.onSeenBy ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-100 dark:hover:bg-white/10"
                onClick={() => {
                  actions.onSeenBy?.(message);
                  setMenuOpen(false);
                }}
              >
                <Eye className="h-4 w-4" /> Who has seen this
              </button>
            ) : null}
            {actions.onPin ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-100 dark:hover:bg-white/10"
                onClick={() => {
                  actions.onPin?.(message);
                  setMenuOpen(false);
                }}
              >
                <Pin className="h-4 w-4" /> Pin message
              </button>
            ) : null}
            {mine && actions.onEdit && message.type === 'text' ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-100 dark:hover:bg-white/10"
                onClick={() => {
                  setEditing(message.content ?? '');
                  setMenuOpen(false);
                }}
              >
                <Pencil className="h-4 w-4" /> Edit message
              </button>
            ) : null}
            {actions.onStar ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-100 dark:hover:bg-white/10"
                onClick={() => {
                  actions.onStar?.(message);
                  setMenuOpen(false);
                }}
              >
                <Star className={`h-4 w-4 ${message.starred ? 'fill-amber-400 text-amber-500' : ''}`} />
                {message.starred ? 'Remove star' : 'Star message'}
              </button>
            ) : null}
            {actions.onForward ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-100 dark:hover:bg-white/10"
                onClick={() => {
                  actions.onForward?.(message);
                  setMenuOpen(false);
                }}
              >
                <Forward className="h-4 w-4" /> Forward
              </button>
            ) : null}
            {!mine && actions.onReport ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                onClick={() => {
                  actions.onReport?.(message);
                  setMenuOpen(false);
                }}
              >
                <Flag className="h-4 w-4" /> Report message
              </button>
            ) : null}
          </div>
        ) : null}

        <div className={`min-w-0 ${message.reactions.length > 0 ? 'pb-4' : ''}`}>
          <div
            className={`relative rounded-2xl px-3.5 py-2 text-[14.5px] shadow-sm ${
              mine
                ? `bg-brand-600 text-white ${lastInGroup ? 'rounded-br-md' : 'rounded-br-2xl'}`
                : `border border-ink-200/70 bg-white text-ink-800 dark:border-white/[.06] dark:bg-ink-700 dark:text-ink-100 ${
                    lastInGroup ? 'rounded-bl-md' : 'rounded-bl-2xl'
                  }`
            } ${message.failed ? 'opacity-60' : ''}`}
          >
            {!mine && firstInGroup && senderName ? (
              <button
                type="button"
                className="mb-0.5 block text-[12px] font-semibold text-brand-600 hover:underline dark:text-brand-300"
                onClick={() => actions.onOpenProfile?.(message.senderId)}
                title={`Open ${senderName}'s profile`}
              >
                {senderName}
              </button>
            ) : null}

            <MessageMedia message={message} mine={mine} />

            {isPrivate ? (
              <span
                className={`mb-1 flex items-center gap-1 text-[10.5px] font-semibold ${
                  mine ? 'text-white/80' : 'text-ink-500 dark:text-ink-400'
                }`}
                data-testid="private-ai-label"
              >
                <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                Only visible to you
              </span>
            ) : null}

            {editing !== null ? (
              <div className="min-w-[220px]">
                <textarea
                  className="w-full resize-none rounded-lg px-2 py-1 text-[14px] text-ink-900"
                  rows={2}
                  value={editing}
                  maxLength={4000}
                  onChange={(event) => setEditing(event.target.value)}
                  aria-label="Edit message"
                  autoFocus
                />
                <div className="mt-1 flex justify-end gap-1">
                  <button
                    type="button"
                    className="rounded px-2 py-0.5 text-[11.5px] font-semibold text-white/90 hover:bg-white/15"
                    onClick={() => {
                      const next = editing.trim();
                      if (!next) return;
                      actions.onEdit?.(message, next);
                      setEditing(null);
                    }}
                  >
                    <Check className="mr-0.5 inline h-3 w-3" /> Save
                  </button>
                  <button
                    type="button"
                    className="rounded px-2 py-0.5 text-[11.5px] font-semibold text-white/80 hover:bg-white/15"
                    onClick={() => setEditing(null)}
                  >
                    <X className="mr-0.5 inline h-3 w-3" /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                {message.content && message.type !== 'file' ? (
                  <span className="whitespace-pre-wrap break-words">{renderContent(message.content)}</span>
                ) : null}
                {message.starred ? (
                  <Star className={`ml-1 inline h-3 w-3 align-baseline ${mine ? 'fill-amber-300 text-amber-300' : 'fill-amber-400 text-amber-500'}`} aria-label="Starred" />
                ) : null}
              </>
            )}

            <span
              className={`ml-2 inline-flex translate-y-[2px] items-center gap-1 align-bottom text-[10.5px] ${
                mine ? 'text-white/70' : 'text-ink-500 dark:text-ink-400'
              }`}
            >
              {message.editedAt ? <span className="italic opacity-80">edited</span> : null}
              {formatTime(message.sentAt, timeFormat)}
              {mine ? <MessageTicks status={status} /> : null}
            </span>
          </div>

          {isPrivate && actions.onShareWithGroup ? (
            <div className={`mt-1 ${mine ? 'text-right' : 'text-left'}`}>
              <button
                type="button"
                onClick={() => actions.onShareWithGroup?.(message)}
                aria-label="Share this AI answer with the group"
                title="Share this AI answer with the group"
                data-testid="share-with-group"
                className="inline-flex items-center gap-1 rounded-full border border-ink-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-brand-700 shadow-sm transition hover:bg-brand-50 dark:border-white/15 dark:bg-ink-700 dark:text-brand-200 dark:hover:bg-white/10"
              >
                <Share2 className="h-3 w-3" aria-hidden="true" />
                Share with group
              </button>
            </div>
          ) : null}

          {message.reactions.length > 0 ? (
            <div className={`absolute -bottom-3 flex flex-wrap gap-1 ${mine ? 'right-2' : 'left-2'}`}>
              {Object.entries(grouped).map(([emoji, count]) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => actions.onReact(message, emoji)}
                  className="rounded-full border border-ink-200 bg-white px-1.5 py-0.5 text-[11px] leading-none shadow-sm dark:border-white/15 dark:bg-ink-600"
                  title={count > 1 ? `${count} reactions` : 'React'}
                >
                  {emoji}
                  {count > 1 ? ` ${count}` : ''}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
