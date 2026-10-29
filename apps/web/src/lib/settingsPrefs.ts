/**
 * Persisted preference toggles for Settings.
 *
 * Smart replies are opt-in and live server-side under
 * `GET/PUT /api/users/me/ai-settings` (`{ suggestReplies: boolean }`); the
 * localStorage key is the offline/fallback copy so the composer still honours
 * the toggle when the route is unavailable. Read values are validated, writes
 * are optimistic and rolled back on a hard failure.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { ApiError } from '@chatgram/api-client';
import { api } from './api';

const SUGGESTED_REPLIES_KEY = 'chatgram.ai.suggestedReplies.v1';

const listeners = new Set<() => void>();
let storageBound = false;

function bindStorage(): void {
  if (storageBound || typeof window === 'undefined') return;
  storageBound = true;
  window.addEventListener('storage', () => {
    for (const listener of listeners) listener();
  });
}

function subscribe(listener: () => void): () => void {
  bindStorage();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

function readBoolean(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function writeBoolean(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    /* storage can be unavailable (private mode): the toggle stays in-memory */
  }
  notify();
}

/** Smart replies are opt-in: default OFF, disclosed in Settings → Chatgram AI. */
export function suggestedRepliesEnabled(): boolean {
  return readBoolean(SUGGESTED_REPLIES_KEY, false);
}

export function setSuggestedRepliesEnabled(value: boolean): void {
  writeBoolean(SUGGESTED_REPLIES_KEY, value);
}

export function useSuggestedRepliesPref(): [boolean, (value: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, suggestedRepliesEnabled, suggestedRepliesEnabled);
  const setEnabled = useCallback((value: boolean) => setSuggestedRepliesEnabled(value), []);
  return [enabled, setEnabled];
}

/* ----------------------------------------------------- server-backed toggle */

let hydratePromise: Promise<'server' | 'fallback'> | null = null;

function missingRoute(error: unknown): boolean {
  const status = error instanceof ApiError ? error.status : 0;
  return status === 404 || status === 405 || status === 501;
}

/**
 * Read the server-side opt-in once per session and mirror it locally, so the
 * composer respects the account setting without opening Settings. A missing
 * route keeps the local value (fallback) silently.
 */
export function hydrateSuggestedReplies(): Promise<'server' | 'fallback'> {
  if (!hydratePromise) {
    hydratePromise = api
      .request<{ suggestReplies?: boolean }>('/api/users/me/ai-settings')
      .then((payload) => {
        setSuggestedRepliesEnabled(payload?.suggestReplies === true);
        return 'server' as const;
      })
      .catch(() => 'fallback' as const);
  }
  return hydratePromise;
}

/**
 * Save the opt-in. 'server' = persisted on the account, 'fallback' = the route
 * is not deployed so it stays local, 'error' = a real failure (rolled back).
 */
export async function saveSuggestedReplies(value: boolean): Promise<'server' | 'fallback' | 'error'> {
  setSuggestedRepliesEnabled(value);
  try {
    await api.request('/api/users/me/ai-settings', { method: 'PUT', body: { suggestReplies: value } });
    hydratePromise = Promise.resolve('server');
    return 'server';
  } catch (error) {
    if (missingRoute(error)) {
      hydratePromise = Promise.resolve('fallback');
      return 'fallback';
    }
    setSuggestedRepliesEnabled(!value);
    return 'error';
  }
}
