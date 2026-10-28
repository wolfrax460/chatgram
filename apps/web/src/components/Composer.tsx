import { useEffect, useRef, useState } from 'react';
import { Smile, Paperclip, Send, Mic, Image as ImageIcon, FileText, Camera, X } from 'lucide-react';
import { useRealtime } from '@chatgram/core';
import { formatDuration, useVoiceRecorder } from '../lib/useVoiceRecorder';
import { READ_ONLY_BANNER } from '../lib/readOnly';

const EMOJIS = [
  '😀', '😂', '😊', '😍', '😎', '🤔', '😅', '🙃',
  '😢', '😭', '😡', '👍', '👎', '🙏', '👏', '💪',
  '🔥', '❤️', '💚', '🎉', '✅', '❌', '⭐', '💯',
  '☕', '🍕', '⚽', '🎵', '📷', '📎', '💬', '🚀',
];

export interface ComposerProps {
  chatId: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onSendText: (text: string) => void;
  onSendFile: (file: File, type?: 'image' | 'file' | 'audio') => void;
  onTyping: (typing: boolean) => void;
  replyTo: { name: string; preview: string } | null;
  onCancelReply: () => void;
  busy?: boolean;
  notice?: string | null;
  onDismissNotice: () => void;
  /**
   * Text-only conversation (Chatgram AI): no attach menu, no file inputs and no
   * voice note button, because the configured AI providers read text only.
   */
  textOnly?: boolean;
  placeholder?: string;
  /**
   * Read-only maintenance mode: the input and every send/upload/record action
   * are disabled, with the same banner message used at the top of the app.
   */
  readOnly?: boolean;
}

/**
 * Composer: emoji picker, attach menu, auto-growing textarea with per-chat
 * drafts, and a mic that swaps to send once there is text.
 */
export default function Composer({
  chatId,
  draft,
  onDraftChange,
  onSendText,
  onSendFile,
  onTyping,
  replyTo,
  onCancelReply,
  busy,
  notice,
  onDismissNotice,
  textOnly = false,
  placeholder,
  readOnly = false,
}: ComposerProps) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<number | null>(null);
  const connected = useRealtime((s) => s.connected);

  const recorder = useVoiceRecorder((file) => onSendFile(file, 'audio'));

  // Auto-grow up to ~5 lines.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 24 * 5)}px`;
  }, [draft]);

  // Focus the textarea when switching chats.
  useEffect(() => {
    textRef.current?.focus();
  }, [chatId]);

  useEffect(() => {
    if (recorder.error) onDismissNotice();
  }, [recorder.error, onDismissNotice]);

  function change(value: string) {
    if (readOnly) return;
    onDraftChange(value);
    if (value.trim()) onTyping(true);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => onTyping(false), 1500);
  }

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (readOnly) return;
    const value = draft.trim();
    if (!value || busy) return;
    onTyping(false);
    onSendText(value);
    onCancelReply();
    setEmojiOpen(false);
    requestAnimationFrame(() => textRef.current?.focus());
  }

  /** Dismiss the reply preview without stealing focus from the input. */
  function cancelReply() {
    onCancelReply();
    requestAnimationFrame(() => textRef.current?.focus());
  }

  function pick(ref: React.RefObject<HTMLInputElement>) {
    ref.current?.click();
    setAttachOpen(false);
  }

  if (recorder.recording) {
    return (
      <div className="border-t border-ink-200 p-3 dark:border-white/10">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn-ghost !px-2 text-rose-600"
            onClick={() => recorder.stop(true)}
            title="Cancel"
          >
            ✕
          </button>
          <div className="flex flex-1 items-center gap-2 rounded-xl bg-rose-500/10 px-3 py-2">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
            <span className="text-sm font-semibold text-rose-600 dark:text-rose-300">
              Recording {formatDuration(recorder.seconds)}
            </span>
            <span className="ml-auto text-xs text-ink-500 dark:text-ink-400">tap ✓ to send</span>
          </div>
          <button type="button" className="btn-primary !px-3" onClick={() => recorder.stop(false)} title="Send">
            ✓
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative border-t border-ink-200 dark:border-white/10">
      {/* reply preview — WhatsApp-style bar above the input */}
      {replyTo ? (
        <div
          data-testid="reply-preview"
          className="mx-3 mt-2 flex items-stretch gap-2 overflow-hidden rounded-lg bg-ink-100 dark:bg-white/5"
        >
          <span
            aria-hidden="true"
            className="w-1 shrink-0 rounded-full bg-brand-600 dark:bg-brand-400"
          />
          <div className="min-w-0 flex-1 py-1.5">
            <p
              data-testid="reply-preview-author"
              className="text-[12px] font-bold leading-tight text-brand-700 dark:text-brand-300"
            >
              {replyTo.name}
            </p>
            <p className="truncate text-[12.5px] text-ink-600 dark:text-ink-300">{replyTo.preview}</p>
          </div>
          <button
            type="button"
            data-testid="reply-preview-close"
            aria-label="Cancel reply"
            title="Cancel reply"
            onClick={cancelReply}
            className="shrink-0 px-2 text-ink-500 transition hover:text-ink-800 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {notice ? (
        <p className="px-3 pt-2 text-xs text-rose-500">
          {notice}{' '}
          <button type="button" className="underline" onClick={onDismissNotice}>
            dismiss
          </button>
        </p>
      ) : null}

      {readOnly ? (
        <p
          className="border-b border-amber-300/60 bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          data-testid="composer-read-only"
        >
          {READ_ONLY_BANNER}
        </p>
      ) : null}

      {/* emoji picker */}
      {emojiOpen ? (
        <div className="absolute bottom-full left-3 z-30 mb-1 grid w-64 grid-cols-8 gap-1 rounded-xl border border-ink-200 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-ink-700">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="rounded-md p-1 text-lg hover:bg-ink-100 dark:hover:bg-white/10"
              onClick={() => {
                change(draft + emoji);
                textRef.current?.focus();
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}

      {/* attach menu (hidden in text-only conversations) */}
      {!textOnly && attachOpen ? (
        <div className="absolute bottom-full left-3 z-30 mb-1 w-44 overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-ink-700">
          <button type="button" className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-ink-100 dark:hover:bg-white/10" onClick={() => pick(imageRef)}>
            <ImageIcon className="h-4 w-4" /> Photo
          </button>
          <button type="button" className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-ink-100 dark:hover:bg-white/10" onClick={() => pick(fileRef)}>
            <FileText className="h-4 w-4" /> Document
          </button>
          <button type="button" className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-ink-100 dark:hover:bg-white/10" onClick={() => pick(cameraRef)}>
            <Camera className="h-4 w-4" /> Camera
          </button>
        </div>
      ) : null}

      <form onSubmit={submit} className="flex items-end gap-1.5 p-2.5">
        <button
          type="button"
          className="btn-ghost !px-2"
          title="Emoji"
          disabled={readOnly}
          onClick={() => {
            setEmojiOpen((v) => !v);
            setAttachOpen(false);
          }}
        >
          <Smile className="h-5 w-5" />
        </button>

        {!textOnly ? (
          <button
            type="button"
            className="btn-ghost !px-2"
            title="Attach"
            onClick={() => {
              setAttachOpen((v) => !v);
              setEmojiOpen(false);
            }}
            disabled={busy || readOnly}
          >
            {busy ? <span className="text-xs">…</span> : <Paperclip className="h-5 w-5" />}
          </button>
        ) : null}

        {!textOnly ? (
          <>
            <input ref={imageRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onSendFile(f, 'image'); }} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onSendFile(f, 'image'); }} />
            <input ref={fileRef} type="file" multiple accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip" className="hidden" onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; for (const f of files) onSendFile(f); }} />
          </>
        ) : null}

        <textarea
          ref={textRef}
          rows={1}
          value={draft}
          disabled={readOnly}
          onChange={(e) => change(e.target.value)}
          // Used by the version-refresh banner (Chunk 7D) to keep a typed draft
          // across the reload: it saves this value in localStorage.
          data-chatgram-composer="1"
          data-chat-id={chatId}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && replyTo) {
              e.preventDefault();
              cancelReply();
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={readOnly ? READ_ONLY_BANNER : (placeholder ?? (connected ? 'Type a message' : 'Reconnecting…'))}
          className="field max-h-[120px] min-h-[42px] flex-1 resize-none py-2.5 leading-6 disabled:cursor-not-allowed disabled:opacity-60"
        />

        {draft.trim() || textOnly ? (
          <button type="submit" className="btn-primary !px-3" disabled={busy || readOnly || !draft.trim()} title={readOnly ? READ_ONLY_BANNER : 'Send'} aria-label={readOnly ? READ_ONLY_BANNER : 'Send message'}>
            <Send className="h-5 w-5" />
          </button>
        ) : (
          <button
            type="button"
            className="btn-ghost !px-3"
            onClick={() => void recorder.start()}
            disabled={busy || readOnly}
            title={readOnly ? READ_ONLY_BANNER : 'Record a voice note'}
          >
            <Mic className="h-5 w-5" />
          </button>
        )}
      </form>
    </div>
  );
}
