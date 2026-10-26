/**
 * Chunk 7D: web build-id polling + the refresh banner support code.
 *
 * The deployed web build writes `/web/version.json` (see vite.config.ts). This
 * module fetches it, remembers the build id the page was loaded with, and
 * reports when a newer build appears. It never reloads on its own and never
 * shows the banner while a call is active — the caller decides.
 *
 * It also keeps a typed composer draft in localStorage (inside try/catch) so the
 * refresh does not lose it.
 */
import { useEffect, useState } from 'react';

const VERSION_URL = `${import.meta.env.BASE_URL}version.json`;
const POLL_MS = 10 * 60 * 1000;
const DISMISS_KEY = 'chatgram.updateBanner.dismissed';
const DRAFT_KEY = 'chatgram.versionRefreshDraft';
const DRAFT_MAX_AGE_MS = 10 * 60 * 1000;

export type VersionFile = { buildId?: string; builtAt?: string };
export type RefreshDraft = { chatId: string; text: string; at: number };

/** Build id of the page that loaded first; a later different id means "update". */
let loadedBuildId: string | null = null;

function readJson<T>(storage: Storage | null, key: string): T | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(storage: Storage | null, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage can be full or blocked (private mode) — never break the app */
  }
}

function removeKey(storage: Storage | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

async function fetchVersionFile(): Promise<VersionFile | null> {
  try {
    const response = await fetch(VERSION_URL, { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const payload = (await response.json()) as VersionFile | null;
    return payload && typeof payload.buildId === 'string' && payload.buildId ? payload : null;
  } catch {
    // Dev server has no version.json, offline, or blocked by a proxy — no banner.
    return null;
  }
}

export type UpdateAvailability = {
  /** A newer build id exists than the one this page loaded with. */
  available: boolean;
  /** The build id that triggered the banner (used for dismissal). */
  buildId: string | null;
  dismiss: () => void;
};

/**
 * Poll /web/version.json every 10 minutes and on tab focus/visibility/online.
 * The first successful read is the baseline; only a later different id shows
 * the banner. Never reloads by itself.
 */
export function useUpdateAvailable(): UpdateAvailability {
  const [available, setAvailable] = useState(false);
  const [buildId, setBuildId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      const file = await fetchVersionFile();
      if (cancelled || !file?.buildId) return;
      if (!loadedBuildId) {
        loadedBuildId = file.buildId;
        return;
      }
      if (file.buildId === loadedBuildId) return;
      const dismissed = readJson<string>(sessionStore(), DISMISS_KEY);
      if (dismissed === file.buildId) return;
      setBuildId(file.buildId);
      setAvailable(true);
    };

    void check();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void check();
    }, POLL_MS);
    const onFocus = () => {
      if (!document.hidden) void check();
    };
    const onVisible = () => {
      if (!document.hidden) void check();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onFocus);
    };
  }, []);

  const dismiss = () => {
    if (buildId) writeJson(sessionStore(), DISMISS_KEY, buildId);
    setAvailable(false);
  };

  return { available, buildId, dismiss };
}

/* ------------------------------------------------------------ draft backup */

/** Save the composer's current text before a version refresh (try/catch only). */
export function saveComposerDraftForRefresh(): void {
  try {
    const composer = document.querySelector<HTMLTextAreaElement>('textarea[data-chatgram-composer]');
    const text = composer?.value ?? '';
    if (!text.trim()) return;
    const chatId = composer?.dataset.chatId || '';
    if (!chatId) return;
    writeJson(localStore(), DRAFT_KEY, { chatId, text, at: Date.now() } satisfies RefreshDraft);
    // The app already reopens this conversation after a reload (see App.tsx).
    // Only real chat ids are stored; the AI composer uses a synthetic id.
    if (/^[0-9a-f]{24}$/i.test(chatId)) {
      try {
        window.localStorage.setItem('chatgram.pendingChat', chatId);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* never block the refresh because the draft could not be stored */
  }
}

/** The chat id saved by the last refresh (used to reopen that conversation). */
export function readRefreshDraftChatId(): string | null {
  const draft = readJson<RefreshDraft>(localStore(), DRAFT_KEY);
  if (!draft || typeof draft.chatId !== 'string' || !draft.chatId) return null;
  if (Date.now() - Number(draft.at || 0) > DRAFT_MAX_AGE_MS) {
    removeKey(localStore(), DRAFT_KEY);
    return null;
  }
  return draft.chatId;
}

/** Take (and clear) the draft saved for this chat; null when there is none. */
export function takeRefreshDraft(chatId: string): string | null {
  const draft = readJson<RefreshDraft>(localStore(), DRAFT_KEY);
  if (!draft) return null;
  removeKey(localStore(), DRAFT_KEY);
  if (draft.chatId !== chatId || typeof draft.text !== 'string') return null;
  if (Date.now() - Number(draft.at || 0) > DRAFT_MAX_AGE_MS) return null;
  return draft.text;
}
