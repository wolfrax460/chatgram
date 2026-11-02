import { useState } from 'react';
import { X } from 'lucide-react';

/**
 * Domain-move notice ("Chatgram has a new home: ...").
 *
 * Renders NOTHING unless VITE_NEW_HOME_URL was set at build time, so the shipped
 * bundle stays unchanged until the cutover. Dismissal is remembered once per
 * target URL in localStorage; it never nags after the first close.
 */
const NEW_HOME_URL = (import.meta.env.VITE_NEW_HOME_URL as string | undefined)?.trim() ?? '';
const DISMISS_KEY = `chatgram.newHome.dismissed.${NEW_HOME_URL}`;

function displayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
}

export default function NewHomeBanner() {
  const [dismissed, setDismissed] = useState(() => {
    if (!NEW_HOME_URL) return true;
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  if (!NEW_HOME_URL || dismissed) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* storage blocked: dismiss for this session only */
    }
    setDismissed(true);
  }

  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-brand-600/30 bg-brand-50 px-3 py-2 dark:border-brand-400/25 dark:bg-brand-600/10"
      data-testid="new-home-banner"
      role="status"
    >
      <a
        href={NEW_HOME_URL}
        className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-brand-800 hover:underline dark:text-brand-200"
      >
        Chatgram has a new home: {displayHost(NEW_HOME_URL)}
      </a>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss new-home notice"
        className="rounded p-1 text-ink-500 hover:bg-black/5 dark:text-ink-300 dark:hover:bg-white/10"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
