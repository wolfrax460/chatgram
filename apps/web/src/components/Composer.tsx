import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Mic, Paperclip, Send, X, Check } from 'lucide-react';
import { useRealtime, useSession, type Message, type MessageType } from '@chatgram/core';
import { api, realtime } from '../lib/api';
import { formatDuration, MAX_UPLOAD_BYTES, useVoiceRecorder } from '../lib/useVoiceRecorder';

function typeFromMime(mimetype: string): MessageType {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  return 'file';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Message composer: text, file attachments and voice notes.
 *
 * Media always goes over REST (upload, then create the message); text prefers
 * the socket with a REST fallback so it still works while reconnecting.
 */
export default function Composer({ chatId }: { chatId: string }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const typingTimer = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const me = useSession((s) => s.user);
  const connected = useRealtime((s) => s.connected);

  const appendMessage = useCallback(
    (message: Message) => {
      queryClient.setQueryData<Message[]>(['messages', chatId], (prev) => [...(prev ?? []), message]);
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
    [chatId, queryClient],
  );

  /* ---------------------------------------------------------- attachments */

  const sendMedia = useCallback(
    async (file: File, forcedType?: MessageType) => {
      if (file.size > MAX_UPLOAD_BYTES) {
        setNotice(`"${file.name}" is ${formatBytes(file.size)} — the limit is 10 MB.`);
        return;
      }
      setBusy(true);
      setNotice(null);
      try {
        const uploaded = await api.uploadMedia(file);
        const type = forcedType ?? typeFromMime(uploaded.mimetype);
        const saved = await api.sendMessage({
          chatId,
          type,
          mediaUrl: uploaded.url,
          content: type === 'file' ? uploaded.originalname || file.name : undefined,
        });
        appendMessage(saved);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setBusy(false);
      }
    },
    [chatId, appendMessage],
  );

  async function pickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    for (const file of files) {
      await sendMedia(file);
    }
  }

  /* -------------------------------------------------------------- voice */

  const recorder = useVoiceRecorder((file) => {
    void sendMedia(file, 'audio');
  });

  useEffect(() => {
    if (recorder.error) setNotice(recorder.error);
  }, [recorder.error]);

  /* -------------------------------------------------------------- text */

  const stopTyping = useCallback(() => {
    if (typingTimer.current) {
      window.clearTimeout(typingTimer.current);
      typingTimer.current = null;
    }
    realtime.typingStop(chatId);
  }, [chatId]);

  useEffect(() => () => stopTyping(), [stopTyping]);

  function onChange(value: string) {
    setText(value);
    if (!value.trim()) return;
    realtime.typingStart(chatId);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      realtime.typingStop(chatId);
      typingTimer.current = null;
    }, 1500);
  }

  async function sendText(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value || !me) return;

    const clientId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: Message = {
      id: clientId,
      clientId,
      chatId,
      senderId: me.id,
      type: 'text',
      content: value,
      sentAt: new Date().toISOString(),
      deliveredTo: [],
      readBy: [],
    };

    appendMessage(optimistic);
    setText('');
    stopTyping();

    if (realtime.connected) {
      realtime.sendMessage({ chatId, type: 'text', content: value, clientId });
    } else {
      try {
        const saved = await api.sendMessage({ chatId, type: 'text', content: value, clientId });
        queryClient.setQueryData<Message[]>(['messages', chatId], (prev) =>
          (prev ?? []).map((m) => (m.clientId === clientId ? saved : m)),
        );
      } catch {
        queryClient.setQueryData<Message[]>(['messages', chatId], (prev) =>
          (prev ?? []).map((m) => (m.clientId === clientId ? { ...m, failed: true } : m)),
        );
      }
    }
  }

  /* -------------------------------------------------------------- render */

  if (recorder.recording) {
    return (
      <div className="border-t border-ink-200 p-3 dark:border-white/10">
        {notice ? <p className="mb-2 text-xs text-rose-500">{notice}</p> : null}
        <div className="flex items-center gap-3">
          <button type="button" className="btn-ghost !px-2 text-rose-600" onClick={() => recorder.stop(true)} title="Cancel">
            <X className="h-5 w-5" />
          </button>
          <div className="flex flex-1 items-center gap-2 rounded-xl bg-rose-500/10 px-3 py-2">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
            <span className="text-sm font-semibold text-rose-600 dark:text-rose-300">
              Recording {formatDuration(recorder.seconds)}
            </span>
            <span className="ml-auto text-xs text-ink-400">tap ✓ to send</span>
          </div>
          <button type="button" className="btn-primary !px-3" onClick={() => recorder.stop(false)} title="Send voice note">
            <Check className="h-5 w-5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-ink-200 dark:border-white/10">
      {notice ? (
        <p className="px-3 pt-2 text-xs text-rose-500">
          {notice}{' '}
          <button type="button" className="underline" onClick={() => setNotice(null)}>
            dismiss
          </button>
        </p>
      ) : null}

      <form onSubmit={sendText} className="flex items-end gap-2 p-3">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
          className="hidden"
          onChange={pickFiles}
        />
        <button
          type="button"
          className="btn-ghost !px-2.5"
          title="Attach a file"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {busy ? <span className="text-xs">…</span> : <Paperclip className="h-5 w-5" />}
        </button>

        <input
          className="field flex-1"
          placeholder={connected ? 'Type a message' : 'Reconnecting…'}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />

        {text.trim() ? (
          <button type="submit" className="btn-primary !px-3">
            <Send className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            className="btn-ghost !px-3"
            onClick={() => void recorder.start()}
            disabled={busy}
            title="Record a voice note"
          >
            <Mic className="h-5 w-5" />
          </button>
        )}
      </form>
    </div>
  );
}
