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
