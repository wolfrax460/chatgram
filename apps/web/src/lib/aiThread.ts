/**
 * Shared Chatgram AI thread state.
 *
 * The pinned row in the chat list and the AI thread component both need the same
 * last-message preview, unread badge, mute and pin state. This is a tiny
 * dependency-free external store (useSyncExternalStore) so no page-level state
 * container has to wrap the shell.
 *
 * Preview text is persisted so the chat list looks right immediately after a
 * reload; unread is per-session on purpose (an AI answer is not a notification
 * you must find again after closing the tab).
 */
import { useSyncExternalStore } from 'react';

export interface AiThreadSnapshot {
  lastMessage: string;
  lastAt: string | null;
  unread: number;
  muted: boolean;
  pinned: boolean;
  viewing: boolean;
}

const STORAGE_KEY = 'chatgram.ai.thread';

const DEFAULTS: AiThreadSnapshot = {
  lastMessage: '',
  lastAt: null,
  unread: 0,
  muted: false,
  pinned: true,
  viewing: false,
};

function load(): AiThreadSnapshot {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AiThreadSnapshot>;
    return {
      ...DEFAULTS,
      lastMessage: typeof parsed.lastMessage === 'string' ? parsed.lastMessage : '',
      lastAt: typeof parsed.lastAt === 'string' ? parsed.lastAt : null,
      muted: Boolean(parsed.muted),
      pinned: parsed.pinned === undefined ? true : Boolean(parsed.pinned),
      unread: 0,
      viewing: false,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let snapshot: AiThreadSnapshot = load();
const listeners = new Set<() => void>();

function persist(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        lastMessage: snapshot.lastMessage,
        lastAt: snapshot.lastAt,
        muted: snapshot.muted,
        pinned: snapshot.pinned,
      }),
    );
  } catch {
    /* storage full/blocked — the thread still works in memory */
  }
}

function set(patch: Partial<AiThreadSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  persist();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Read one primitive field (stable snapshot, safe for useSyncExternalStore). */
export function useAiThread<T>(selector: (state: AiThreadSnapshot) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(snapshot),
    () => selector(snapshot),
  );
}

export const aiThread = {
  get: (): AiThreadSnapshot => snapshot,
  setViewing(viewing: boolean): void {
    set({ viewing, ...(viewing ? { unread: 0 } : {}) });
  },
  markRead(): void {
    if (snapshot.unread !== 0) set({ unread: 0 });
  },
  /** An answer arrived (or history loaded): update the pinned row. */
  publishAnswer(input: { preview: string; at?: string; fromServer?: boolean }): void {
    const viewing = snapshot.viewing;
    set({
      lastMessage: input.preview.slice(0, 140),
      lastAt: input.at || new Date().toISOString(),
      // Only a live answer while the thread is closed counts as unread.
      unread: input.fromServer && !viewing ? snapshot.unread + 1 : viewing ? 0 : snapshot.unread,
    });
  },
  setPreview(preview: string, at: string | null): void {
    if (!preview) return;
    set({ lastMessage: preview.slice(0, 140), lastAt: at });
  },
  toggleMuted(): boolean {
    set({ muted: !snapshot.muted });
    return snapshot.muted;
  },
  togglePinned(): boolean {
    set({ pinned: !snapshot.pinned });
    return snapshot.pinned;
  },
};
