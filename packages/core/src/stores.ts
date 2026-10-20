/**
 * Client-side stores (Zustand).
 *
 * Deliberately small: server state belongs in TanStack Query, so these hold
 * only what the server does not own — the session, the theme, and ephemeral
 * presence/typing flags.
 */
import { create } from 'zustand';
import type { User } from './models.js';

/* ------------------------------------------------------------------ session */

interface SessionState {
  user: User | null;
  /** Hydrated from storage before the first render. */
  ready: boolean;
  setUser: (user: User | null) => void;
  patchUser: (patch: Partial<User>) => void;
  setReady: (ready: boolean) => void;
}

const SESSION_KEY = 'chatgram.session.user';

function readSession(): User | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export const useSession = create<SessionState>((set) => ({
  user: typeof localStorage === 'undefined' ? null : readSession(),
  ready: false,
  setUser: (user) => {
    try {
      if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* storage unavailable */
    }
    set({ user });
  },
  patchUser: (patch) =>
    set((state) => {
      if (!state.user) return state;
      const next = { ...state.user, ...patch };
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return { user: next };
    }),
  setReady: (ready) => set({ ready }),
}));

/* -------------------------------------------------------------------- theme */

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  cycle: () => void;
}

const THEME_KEY = 'chatgram.theme';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : true;
}

export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const dark = mode === 'system' ? systemPrefersDark() : mode === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0b141a' : '#ffffff');
}

export const useTheme = create<ThemeState>((set, get) => ({
  mode: ((): ThemeMode => {
    try {
      return (localStorage.getItem(THEME_KEY) as ThemeMode) || 'system';
    } catch {
      return 'system';
    }
  })(),
  setMode: (mode) => {
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {
      /* ignore */
    }
    applyTheme(mode);
    set({ mode });
  },
  cycle: () => {
    const order: ThemeMode[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(get().mode) + 1) % order.length] ?? 'system';
    get().setMode(next);
  },
}));

/* ----------------------------------------------------------------- presence */

interface RealtimeState {
  connected: boolean;
  online: Record<string, boolean>;
  typing: Record<string, string | null>;
  setConnected: (connected: boolean) => void;
  setOnline: (userId: string, isOnline: boolean) => void;
  setTyping: (chatId: string, userId: string | null) => void;
}

export const useRealtime = create<RealtimeState>((set) => ({
  connected: false,
  online: {},
  typing: {},
  setConnected: (connected) => set({ connected }),
  setOnline: (userId, isOnline) =>
    set((state) => ({ online: { ...state.online, [userId]: isOnline } })),
  setTyping: (chatId, userId) =>
    set((state) => ({ typing: { ...state.typing, [chatId]: userId } })),
}));

/* ------------------------------------------------------------------- prefs */

interface PrefsState {
  notifications: boolean;
  sounds: boolean;
  setPref: (key: 'notifications' | 'sounds', value: boolean) => void;
}

const PREFS_KEY = 'chatgram.prefs';

function readPrefs(): Pick<PrefsState, 'notifications' | 'sounds'> {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    return {
      notifications: parsed.notifications === true,
      sounds: parsed.sounds !== false,
    };
  } catch {
    return { notifications: false, sounds: true };
  }
}

export const usePrefs = create<PrefsState>((set) => ({
  ...(typeof localStorage === 'undefined'
    ? { notifications: false, sounds: true }
    : readPrefs()),
  setPref: (key, value) =>
    set((state) => {
      const next = { ...state, [key]: value };
      try {
        localStorage.setItem(
          PREFS_KEY,
          JSON.stringify({ notifications: next.notifications, sounds: next.sounds }),
        );
      } catch {
        /* ignore */
      }
      return { [key]: value } as Partial<PrefsState>;
    }),
}));
