import { useState } from 'react';
import { Reply, Copy, Trash2, MoreVertical } from 'lucide-react';
import type { Message, MessageStatus } from '@chatgram/core';
import { MessageMedia } from './MessageMedia';
import { MessageTicks } from './MessageTicks';
import { formatTime, type TimeFormat } from '../lib/ui';

export interface BubbleActions {
  onReply: (message: Message) => void;
  onDelete: (message: Message) => void;
}

/**
 * One message bubble.
 *
 * Handles grouping (tighter spacing and a single timestamp for a run of
 * messages from the same sender), hover actions and delivery ticks.
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
  const mine = message.senderId === meId;
  const senderName = (message as Message & { senderName?: string }).senderName;

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

  return (
    <div
      className={`group flex w-full ${mine ? 'justify-end' : 'justify-start'} ${
        firstInGroup ? 'mt-2' : 'mt-[3px]'
      }`}
    >
      <div className={`relative flex max-w-[65%] items-center gap-1 ${mine ? 'flex-row' : 'flex-row-reverse'}`}>
        {/* hover actions */}
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            className="grid h-7 w-7 place-items-center rounded-full text-ink-500 hover:bg-ink-200/60 dark:text-ink-300 dark:hover:bg-white/10"
            title="Reply"
            onClick={() => actions.onReply(message)}
          >
            <Reply className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="grid h-7 w-7 place-items-center rounded-full text-ink-500 hover:bg-ink-200/60 dark:text-ink-300 dark:hover:bg-white/10"
            title={copied ? 'Copied' : 'Copy'}
            onClick={copy}
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="grid h-7 w-7 place-items-center rounded-full text-ink-500 hover:bg-ink-200/60 dark:text-ink-300 dark:hover:bg-white/10"
            title="More"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </div>

        {menuOpen ? (
          <div
            className={`absolute top-8 z-20 w-40 overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-ink-700 ${
              mine ? 'right-full mr-1' : 'left-full ml-1'
            }`}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
              onClick={() => {
                actions.onDelete(message);
                setMenuOpen(false);
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          </div>
        ) : null}

        {/* bubble */}
        <div
          className={`min-w-0 rounded-2xl px-3.5 py-2 text-[14.5px] shadow-sm ${
            mine
              ? `bg-brand-600 text-white ${lastInGroup ? 'rounded-br-md' : 'rounded-br-2xl'}`
              : `border border-ink-200/70 bg-white text-ink-800 dark:border-white/[.06] dark:bg-ink-700 dark:text-ink-100 ${
                  lastInGroup ? 'rounded-bl-md' : 'rounded-bl-2xl'
                }`
          } ${message.failed ? 'opacity-60' : ''}`}
        >
          {!mine && firstInGroup && senderName ? (
            <p className="mb-0.5 text-[12px] font-semibold text-brand-600 dark:text-brand-300">{senderName}</p>
          ) : null}

          <MessageMedia message={message} mine={mine} />

          {message.content && message.type !== 'file' ? (
            <span className="whitespace-pre-wrap break-words">{message.content}</span>
          ) : null}

          <span
            className={`ml-2 inline-flex translate-y-[2px] items-center gap-1 align-bottom text-[10.5px] ${
              mine ? 'text-white/70' : 'text-ink-500 dark:text-ink-400'
            }`}
          >
            {formatTime(message.sentAt, timeFormat)}
            {mine ? <MessageTicks status={status} /> : null}
          </span>
        </div>
      </div>
    </div>
  );
}
