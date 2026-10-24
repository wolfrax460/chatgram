import { useRealtime } from '@chatgram/core';

/**
 * Presence rendering rules.
 *
 * The socket is the only authority. A REST payload carries a snapshot taken when
 * it was fetched; while the socket is down we cannot know when it went stale, so
 * presence is treated as unknown and everything renders offline. When the socket
 * is up, a live `presence:online`/`presence:offline` event always wins over the
 * snapshot.
 */

export interface PresenceView {
  trusted: boolean;
  online: Record<string, boolean>;
}

/** Subscribe to the presence store once, at component level (not per row). */
export function usePresenceView(): PresenceView {
  const trusted = useRealtime((s) => s.presenceTrusted);
  const online = useRealtime((s) => s.online);
  return { trusted, online };
}

/** Pure decision used by list rows, where a hook cannot be called. */
export function onlineNow(
  view: PresenceView,
  userId: string | undefined,
  serverSaysOnline?: boolean,
): boolean {
  if (!view.trusted || !userId) return false;
  const live = view.online[userId];
  if (live !== undefined) return live;
  return serverSaysOnline === true;
}

/** Single-user convenience for headers and panels. */
export function useIsOnline(userId: string | undefined, serverSaysOnline?: boolean): boolean {
  const view = usePresenceView();
  return onlineNow(view, userId, serverSaysOnline);
}
