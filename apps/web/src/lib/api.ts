import { ApiClient } from '@chatgram/api-client';
import { RealtimeClient } from '@chatgram/realtime';

export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') ??
  'https://chatgram.duckdns.org';

export const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL as string | undefined) ?? API_URL;

/** Single shared REST client. */
export const api = new ApiClient({ baseUrl: API_URL });

/** Single shared socket wrapper (connect after login). */
export const realtime = new RealtimeClient();

export const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '1.0.0';

/* ------------------------------------------------------- status: viewers */

/** One person who viewed one of *my* statuses (owner-only endpoint). */
export interface StatusViewer {
  id: string;
  displayName: string;
  /** Empty string when the person has no avatar; render initials instead. */
  avatarUrl: string;
  /** ISO timestamp of the latest view, or `null` for views stored before times. */
  viewedAt: string | null;
  isContact: boolean;
}

export interface StatusViewers {
  /** Total number of people who viewed it, even when `truncated` is true. */
  count: number;
  viewers: StatusViewer[];
  /** True when the server capped `viewers` (it returns at most 200). */
  truncated: boolean;
}

/**
 * Who viewed my status. Only the author may call this: the server answers
 * 403 for everyone else and 404 for a missing or expired status.
 */
export function statusViewers(id: string): Promise<StatusViewers> {
  return api.request<StatusViewers>(`/api/status/${encodeURIComponent(id)}/viewers`);
}
