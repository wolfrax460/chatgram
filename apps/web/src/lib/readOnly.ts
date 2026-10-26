/**
 * Read-only mode copy (Part D of the maintenance-page brief).
 *
 * When PlatformSettings.readOnlyMode is on, the server keeps every GET/HEAD
 * readable and rejects writes with `503 { code: 'READ_ONLY' }`, but the realtime
 * socket handlers (`message:send`, `call:start`) are *not* behind that gate.
 * The client therefore has to disable those paths itself — these strings are
 * shared by the banner, composer, call buttons and empty-screen actions so the
 * message is identical everywhere.
 */

/** Full banner sentence (the brief's wording). */
export const READ_ONLY_BANNER =
  "Chatgram is in read-only mode while we do maintenance. You can read your chats and we'll let you send again shortly.";

/** Short label for a disabled composer / action button. */
export const READ_ONLY_SEND_HINT = 'Sending is paused while Chatgram is in read-only mode.';

/** Short label for disabled call buttons. */
export const READ_ONLY_CALL_HINT = 'Calling is paused while Chatgram is in read-only mode.';

/** Notice shown when a write is attempted anyway (never fails silently). */
export const READ_ONLY_NOTICE =
  'Chatgram is in read-only mode, so this was not sent, saved or started. You can keep reading your chats.';
