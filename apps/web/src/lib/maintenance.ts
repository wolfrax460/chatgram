/**
 * Maintenance experience helpers (Part A + C of the maintenance-page brief).
 *
 * Only real, existing endpoints are used:
 *  - GET /api/status/health   — the same public health check the deploy gate reads
 *  - GET /api/app/features    — the public PlatformSettings flags feed
 *  - POST /api/auth/refresh   — the existing refresh endpoint (exempt from the gate)
 *
 * The server's maintenance gate keeps `/api/status/health`, `/api/config`,
 * `/api/app/features` and `/api/auth/*` reachable while every other non-admin
 * API call returns 503. That is why "the app is back" means **health ok AND
 * maintenanceMode false**: /api/status/health keeps answering 200 during a
 * maintenance window (only Mongo/realtime/storage are reflected there).
 */
import { api } from './api';
import type { Locale } from './i18n';

export const MAINTENANCE_PREVIEW_PARAM = 'maintenance-preview';

const RETURN_PATH_KEY = 'chatgram.maintenance.returnPath';
const DRAFT_KEY = 'chatgram.maintenance.draft';
const PREVIEW_DRAFT_KEY = 'chatgram.maintenance.preview';
const NOTIFY_KEY = 'chatgram.maintenance.notify';

/** Poll cadence while waiting: 10 s, backing off to 60 s after failures. */
export const POLL_START_MS = 10_000;
export const POLL_MAX_MS = 60_000;
/** After this much active polling, stop auto-reloading and offer "Check again". */
export const AUTO_RELOAD_LIMIT_MS = 30 * 60 * 1000;
/** "We're back" is shown for 2 s before the reload is scheduled (plus 0–8 s jitter). */
export const BACK_BANNER_MS = 2_000;
export const RELOAD_JITTER_MS = 8_000;

/** Shape of GET /api/status/health (see server/src/help/controller.js). */
export type HealthPayload = {
  ok?: boolean;
  database?: string;
  socket?: string;
  storage?: string;
  time?: string;
};

/** Shape of the fields of GET /api/app/features we need on this page. */
export type FeaturesPayload = {
  maintenanceMode?: boolean;
  maintenanceMessage?: string;
  readOnlyMode?: boolean;
};

export type Availability = {
  /** True only when the health check is ok *and* maintenance mode is off. */
  up: boolean;
  health: HealthPayload | null;
  maintenanceMode: boolean | null;
  checkedAt: number;
  /** Human-readable reason when the check itself failed (network/timeout). */
  error: string | null;
};

export type MaintenancePreviewDraft = {
  /** Per-language custom message; only EN is a real server field today. */
  messages: Record<Locale, string>;
  /** ISO datetime strings from <input type="datetime-local" />, '' when unset. */
  startsAt: string;
  endsAt: string;
  phase: string;
  bannerEnabled: boolean;
  /** Hours after which maintenance should switch itself off (not enforced yet). */
  autoOffHours: number | null;
};

export const EMPTY_PREVIEW_DRAFT: MaintenancePreviewDraft = {
  messages: { en: '', rw: '', fr: '', sw: '' },
  startsAt: '',
  endsAt: '',
  phase: '',
  bannerEnabled: false,
  autoOffHours: null,
};

function readStorage(get: () => string | null): string | null {
  try {
    return get();
  } catch {
    return null;
  }
}

function writeStorage(write: () => void): void {
  try {
    write();
  } catch {
    /* storage can be unavailable (private mode, Electron sandbox): best effort */
  }
}

/* --------------------------------------------------------------- preview */

/** `?maintenance-preview=1` renders the maintenance page locally, without enabling it. */
export function isMaintenancePreview(search?: string): boolean {
  const query = search ?? (typeof window === 'undefined' ? '' : window.location.search);
  try {
    return new URLSearchParams(query).get(MAINTENANCE_PREVIEW_PARAM) === '1';
  } catch {
    return false;
  }
}

export function readPreviewDraft(): MaintenancePreviewDraft {
  const raw = readStorage(() => window.localStorage.getItem(PREVIEW_DRAFT_KEY));
  if (!raw) return { ...EMPTY_PREVIEW_DRAFT, messages: { ...EMPTY_PREVIEW_DRAFT.messages } };
  try {
    const parsed = JSON.parse(raw) as Partial<MaintenancePreviewDraft>;
    return {
      ...EMPTY_PREVIEW_DRAFT,
      ...parsed,
      messages: { ...EMPTY_PREVIEW_DRAFT.messages, ...(parsed.messages ?? {}) },
    };
  } catch {
    return { ...EMPTY_PREVIEW_DRAFT, messages: { ...EMPTY_PREVIEW_DRAFT.messages } };
  }
}

export function writePreviewDraft(draft: MaintenancePreviewDraft): boolean {
  try {
    window.localStorage.setItem(PREVIEW_DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/* ----------------------------------------------------- remembered path */

/** Remember where the user was so we can come back there after maintenance. */
export function rememberReturnPath(path: string): void {
  if (!path.startsWith('/')) return;
  if (path.includes(`${MAINTENANCE_PREVIEW_PARAM}=1`)) return;
  if (/\/admin(?:\/|$)/.test(path)) return;
  writeStorage(() => window.sessionStorage.setItem(RETURN_PATH_KEY, path));
}

export function readReturnPath(): string | null {
  const path = readStorage(() => window.sessionStorage.getItem(RETURN_PATH_KEY));
  if (!path || !path.startsWith('/') || path.startsWith('//')) return null;
  return path;
}

/** Reload to the remembered path (never to an external URL). */
export function reloadToRememberedPath(): void {
  const target = readReturnPath();
  if (target) {
    window.location.assign(target);
    return;
  }
  window.location.reload();
}

/* ---------------------------------------------------------------- draft */

/** The "send later" draft is local only: it is never sent, queued or uploaded. */
export function readSavedDraft(): string {
  return readStorage(() => window.localStorage.getItem(DRAFT_KEY)) ?? '';
}

export function saveSavedDraft(text: string): void {
  writeStorage(() => window.localStorage.setItem(DRAFT_KEY, text));
}

/* --------------------------------------------------------- notifications */

export function readNotifyPreference(): boolean {
  return readStorage(() => window.localStorage.getItem(NOTIFY_KEY)) === '1';
}

export function saveNotifyPreference(enabled: boolean): void {
  writeStorage(() => window.localStorage.setItem(NOTIFY_KEY, enabled ? '1' : '0'));
}

/** Notify in this open tab (never a closed-app push). */
export function notifyWhenBack(title: string, body: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (window.Notification.permission !== 'granted') return;
  try {
    const notification = new window.Notification(title, {
      body,
      icon: `${import.meta.env.BASE_URL}chatgram-icon.svg`,
      tag: 'chatgram-maintenance-back',
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    /* some browsers reject notifications without a service worker — harmless */
  }
}

/* --------------------------------------------------------------- session */

/**
 * Silently refresh the access token before reloading, without ever signing the
 * user out: a failed refresh simply leaves the existing tokens untouched.
 * (The shared ApiClient clears tokens on a failed refresh, so we talk to the
 * endpoint directly instead of calling api.me().)
 */
export async function refreshSessionSilently(): Promise<boolean> {
  let refreshToken: string | null = null;
  try {
    refreshToken = api.refreshToken;
  } catch {
    return false;
  }
  if (!refreshToken) return false;
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { accessToken?: string; refreshToken?: string };
    if (!payload?.accessToken) return false;
    api.setTokens({ accessToken: payload.accessToken, refreshToken: payload.refreshToken });
    return true;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- checks */

async function requestJson<T>(url: string, init?: RequestInit, timeoutMs = 8_000): Promise<{ ok: boolean; status: number; data: T | null }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    });
    let data: T | null = null;
    try {
      data = (await response.json()) as T;
    } catch {
      data = null;
    }
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * One availability check: health + feature flags in parallel.
 * `up` requires both a healthy API and maintenance mode off.
 */
export async function checkAvailability(): Promise<Availability> {
  const checkedAt = Date.now();
  const [healthResult, featuresResult] = await Promise.all([
    requestJson<HealthPayload>('/api/status/health'),
    requestJson<FeaturesPayload>('/api/app/features'),
  ]);
  const health = healthResult.data;
  const maintenanceMode = typeof featuresResult.data?.maintenanceMode === 'boolean' ? featuresResult.data.maintenanceMode : null;
  const healthOk = Boolean(health?.ok) && healthResult.ok;
  const up = healthOk && maintenanceMode === false;
  const unreachable = healthResult.status === 0 || featuresResult.status === 0;
  return {
    up,
    health: health ?? null,
    maintenanceMode,
    checkedAt,
    error: unreachable ? 'The server could not be reached.' : null,
  };
}
