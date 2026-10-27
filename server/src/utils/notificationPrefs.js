/**
 * Quiet-hours and muted-chat rules, shared by every notification path.
 *
 * The preferences already exist on the User document and are written by the
 * existing `/api/users/me/notifications` and `/api/users/me/muted/:chatId`
 * routes; this module only answers "may we notify this user right now?".
 * Pure functions on purpose: the push sender takes the user row it already
 * loaded, and the rules are testable without a database.
 */

/** "22:00" -> minutes since midnight, or null when malformed. */
function parseClock(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * True while the user's do-not-disturb window covers `now`.
 * The window may wrap midnight (22:00 -> 07:00 = the default). A malformed or
 * zero-length window is treated as "not configured" rather than silencing the
 * user forever.
 */
function isDoNotDisturbActive(user, now = new Date()) {
  const prefs = user && user.notificationPrefs;
  if (!prefs || prefs.dndEnabled !== true) return false;
  const start = parseClock(prefs.dndStart || '22:00');
  const end = parseClock(prefs.dndEnd || '07:00');
  if (start === null || end === null || start === end) return false;

  const minutes = now.getHours() * 60 + now.getMinutes();
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

/**
 * True when this user muted the chat (no expiry, or an expiry still in the
 * future). An expired mute is ignored, matching the client's badge behaviour.
 */
function isChatMuted(user, chatId, now = new Date()) {
  const id = String(chatId || '');
  if (!id) return false;
  for (const entry of (user && user.mutedChats) || []) {
    if (String(entry.chatId || '') !== id) continue;
    if (!entry.until) return true;
    const until = new Date(entry.until).getTime();
    if (Number.isFinite(until) && until > now.getTime()) return true;
  }
  return false;
}

module.exports = { parseClock, isDoNotDisturbActive, isChatMuted };
