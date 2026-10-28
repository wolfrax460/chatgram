import { useEffect, useRef, useState } from 'react';
import { Smile, Paperclip, Send, Mic, Image as ImageIcon, FileText, Camera, X } from 'lucide-react';
import { useRealtime } from '@chatgram/core';
import { useVoiceRecorder } from '../lib/useVoiceRecorder';
import { READ_ONLY_BANNER } from '../lib/readOnly';
import { VoiceRecorderBar } from './VoiceRecorderBar';

const EMOJIS = [
  '😀', '😂', '😊', '😍', '😎', '🤔', '😅', '🙃',
  '😢', '😭', '😡', '👍', '👎', '🙏', '👏', '💪',
  '🔥', '❤️', '💚', '🎉', '✅', '❌', '⭐', '💯',
  '☕', '🍕', '⚽', '🎵', '📷', '📎', '💬', '🚀',
];

/** Presses longer than this are "hold to record": releasing sends the clip. */
const HOLD_TO_SEND_MS = 350;
/** Slide this far left from the mic to arm the cancel target. */
const CANCEL_DRAG_PX = 90;
/** Slide this far up from the mic to lock the recording (hands-free). */
const LOCK_DRAG_PX = 64;

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
  // Voice-note gestures: `holding` is true while the mic is pressed (slide
  // gestures possible); `cancelArmed` turns the bar's X red once the finger is
  // over the cancel target.
  const [holding, setHolding] = useState(false);
  const [cancelArmed, setCancelArmed] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<number | null>(null);
  const pressRef = useRef<{ pointerId: number; x: number; y: number; at: number; cancelArmed: boolean } | null>(null);
  const clickHandledByPointer = useRef(false);
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

  // Move focus into the recording bar when it opens: the composer underneath is
  // hidden from assistive tech, and cancel/lock/pause/send are keyboard
  // reachable from the bar. When recording ends, hand focus back to the input.
  const wasRecording = useRef(false);
  useEffect(() => {
    if (!recorder.recording && wasRecording.current) {
      requestAnimationFrame(() => textRef.current?.focus());
    }
    wasRecording.current = recorder.recording;
    if (!recorder.recording || typeof document === 'undefined') return;
    const bar = document.querySelector<HTMLElement>('[data-testid="voice-recording-bar"]');
    bar?.focus({ preventScroll: true });
  }, [recorder.recording]);

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

  /* ------------------------------------------------- voice-note gestures */

  function startHandsFreeRecording() {
    if (busy || readOnly || recorder.recording) return;
    void recorder.start();
  }

  /** Pointer down on the mic: start recording immediately (hold or tap). */
  function onMicPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (busy || readOnly) return;
    event.preventDefault();
    // The compatibility click that follows this gesture must not start a
    // second recording; keyboard activation (no pointerdown) still works.
    clickHandledByPointer.current = true;
    pressRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      at: Date.now(),
      cancelArmed: false,
    };
    setHolding(true);
    setCancelArmed(false);
    try {
      // Keep receiving moves/up even when the finger leaves the button.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* older WebViews: the bar's buttons still work */
    }
    void recorder.start();
  }

  /** Drag left to cancel, drag up to lock (WhatsApp gestures). */
  function onMicPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const press = pressRef.current;
    if (!press || press.pointerId !== event.pointerId || recorder.locked) return;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;

    if (dy <= -LOCK_DRAG_PX) {
      pressRef.current = null;
      setHolding(false);
      setCancelArmed(false);
      recorder.setLocked(true);
      return;
    }

    const armed = dx <= -CANCEL_DRAG_PX;
    if (armed !== press.cancelArmed) {
      press.cancelArmed = armed;
      setCancelArmed(armed);
    }
  }

  function onMicPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    // The click fired by this release is not a keyboard activation. Clear the
    // flag shortly after, in case the browser does not send the click at all.
    window.setTimeout(() => {
      clickHandledByPointer.current = false;
    }, 500);
    const press = pressRef.current;
    setHolding(false);
    setCancelArmed(false);
    if (press && press.pointerId === event.pointerId) {
      pressRef.current = null;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
    }
    if (!press || press.pointerId !== event.pointerId) return;

    if (recorder.locked) return;
    if (press.cancelArmed) {
      recorder.cancel();
      return;
    }
    if (Date.now() - press.at >= HOLD_TO_SEND_MS) {
      // Held long enough: release sends. A clip under 1 s is discarded by the
      // recorder itself, so a slip of the finger never uploads an empty note.
      recorder.stop(false);
    }
    // A quick tap keeps recording hands-free (the bar's send button finishes).
  }

  function onMicPointerCancel(event: React.PointerEvent<HTMLButtonElement>) {
    const press = pressRef.current;
    clickHandledByPointer.current = false;
    pressRef.current = null;
    setHolding(false);
    setCancelArmed(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
    if (press && recorder.recording) recorder.cancel();
  }

  /** Click from keyboard activation (Enter/Space); pointer taps are handled above. */
  function onMicClick() {
    if (clickHandledByPointer.current) return;
    startHandsFreeRecording();
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

      <form
        onSubmit={submit}
        aria-hidden={recorder.recording ? true : undefined}
        className="flex items-end gap-1.5 p-2.5"
      >
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
            data-testid="voice-record-button"
            className="btn-ghost touch-none !px-3"
            onClick={onMicClick}
            onPointerDown={onMicPointerDown}
            onPointerMove={onMicPointerMove}
            onPointerUp={onMicPointerUp}
            onPointerCancel={onMicPointerCancel}
            disabled={busy || readOnly}
            title={readOnly ? READ_ONLY_BANNER : 'Record voice message'}
            aria-label={readOnly ? READ_ONLY_BANNER : 'Record voice message'}
          >
            <Mic className="h-5 w-5" />
          </button>
        )}
      </form>

      {/* The composer stays mounted under the bar so the mic keeps its pointer
          capture while the recording UI replaces the row visually. */}
      {recorder.recording ? (
        <VoiceRecorderBar
          seconds={recorder.seconds}
          paused={recorder.paused}
          locked={recorder.locked}
          holding={holding}
          cancelArmed={cancelArmed}
          onCancel={recorder.cancel}
          onTogglePause={recorder.togglePause}
          onLock={() => recorder.setLocked(true)}
          onSend={() => recorder.stop(false)}
        />
      ) : null}
    </div>
  );
}
