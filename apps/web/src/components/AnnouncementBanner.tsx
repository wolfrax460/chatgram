import { useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';

type Banner = { id: string; title: string; body: string; link: string; publishedAt?: string };

/**
 * The admin-published in-app announcement banner (9b).
 *
 * Fetches /api/app/announcements and shows the active banner above the chat
 * list. Dismissal is remembered per banner id in localStorage, so a new
 * announcement shows again but an old one does not nag.
 */
export default function AnnouncementBanner() {
  const [banner, setBanner] = useState<Banner | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/app/announcements')
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled || !payload?.banner?.id) return;
        const dismissed = localStorage.getItem(`chatgram.banner.dismissed.${payload.banner.id}`) === '1';
        if (!dismissed) setBanner(payload.banner);
      })
      .catch(() => {
        /* announcements are best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!banner) return null;

  function dismiss() {
    if (banner) localStorage.setItem(`chatgram.banner.dismissed.${banner.id}`, '1');
    setBanner(null);
  }

  const content = (
    <>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-white">
        <Megaphone className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        {banner.title ? <span className="block truncate text-[12.5px] font-semibold">{banner.title}</span> : null}
        <span className="block text-[12px] leading-snug text-ink-700 dark:text-ink-200">{banner.body}</span>
      </span>
    </>
  );

  return (
    <div className="flex shrink-0 items-start gap-2 border-b border-brand-600/30 bg-brand-50 px-3 py-2 dark:border-brand-400/25 dark:bg-brand-600/10" data-testid="announcement-banner" role="status">
      {banner.link ? (
        <a href={banner.link} className="flex min-w-0 flex-1 items-start gap-2 text-inherit hover:underline">
          {content}
        </a>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-2">{content}</div>
      )}
      <button type="button" onClick={dismiss} aria-label="Dismiss announcement" className="rounded p-1 text-ink-500 hover:bg-black/5 dark:text-ink-300 dark:hover:bg-white/10">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
