import { useState } from 'react';
import { Image as ImageIcon, Paperclip } from 'lucide-react';
import type { Message } from '@chatgram/core';
import { VoiceNotePlayer } from './VoiceNotePlayer';

/**
 * Renders an attachment according to the message type.
 *
 * Falls back to a plain link if an image or video fails to load, so a broken
 * CDN URL never leaves an empty bubble.
 */
export function MessageMedia({ message, mine }: { message: Message; mine: boolean }) {
  const [failed, setFailed] = useState(false);
  const url = message.mediaUrl;
  if (!url) return null;

  if (message.type === 'image') {
    if (failed) {
      return (
        <a href={url} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 underline opacity-80">
          <ImageIcon className="h-4 w-4" /> Photo (tap to open)
        </a>
      );
    }
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img
          src={url}
          alt={message.content || 'Photo'}
          loading="lazy"
          className="mb-1 max-h-80 w-full rounded-lg object-cover"
          onError={() => setFailed(true)}
        />
      </a>
    );
  }

  if (message.type === 'video') {
    return (
      <video
        src={url}
        controls
        preload="metadata"
        className="mb-1 max-h-80 w-full rounded-lg bg-black"
        onError={() => setFailed(true)}
      />
    );
  }

  if (message.type === 'audio') {
    return <VoiceNotePlayer src={url} mine={mine} />;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      download
      className={`mb-1 flex items-center gap-2 rounded-xl px-2.5 py-2 ${mine ? 'bg-white/15' : 'bg-black/5 dark:bg-white/10'}`}
    >
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${mine ? 'bg-white/25' : 'bg-brand-600 text-white'}`}>
        <Paperclip className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold">{message.content || 'Document'}</span>
        <span className="block text-[11px] opacity-70">Tap to download</span>
      </span>
    </a>
  );
}
