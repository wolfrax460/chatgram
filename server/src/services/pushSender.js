/**
 * FCM push sender.
 *
 * Callers (message create paths, call start) call the fire-and-forget helpers at
 * the bottom; nothing here is allowed to throw into a message/call request.
 *
 * Rules:
 *  - tokens come from DeviceToken (invalid ones are skipped forever);
 *  - a recipient with a live socket is skipped unless the caller passes
 *    `force` (calls), because the socket already delivered the event;
 *  - the user's existing do-not-disturb window and muted chats are respected
 *    (utils/notificationPrefs.js, same data the settings UI writes);
 *  - message pushes are coalesced to at most one per recipient per chat every
 *    3 seconds; call pushes are one-shot with a 45 s TTL;
 *  - every delivery failure is recorded once per token in the Admin Inbox as
 *    `type: 'push_failure'`, `normalized: 'push:<tokenId>'`, `count++`. The text
 *    contains only the sanitized Firebase error code and platform — never a
 *    token, message preview, name or chat content.
 */
const DeviceToken = require('../models/DeviceToken');
const User = require('../models/User');
const realtime = require('../utils/realtime');
const { isDoNotDisturbActive, isChatMuted } = require('../utils/notificationPrefs');
const { getMessaging } = require('./firebase');

const PREVIEW_MAX = 120;
const COALESCE_MS = 3000;
/** Tokens Firebase says will never work again; keep them but stop sending. */
const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/** `${userId}:${chatId}` -> last push timestamp (coalescing, in-memory is enough). */
const recentPushes = new Map();

// Fast path: until the first device registers there is nothing to send, so a
// message must not cost extra User/DeviceToken queries. One cheap existence
// check per 30 s at most; registration invalidates it immediately.
let knownTokens = { at: 0, value: null };

async function hasAnyValidTokens(now) {
  if (knownTokens.value !== null && now - knownTokens.at < 30_000) return knownTokens.value;
  const found = await DeviceToken.exists({ invalid: { $ne: true } });
  knownTokens = { at: now, value: Boolean(found) };
  return knownTokens.value;
}

function invalidateTokenCache() {
  knownTokens = { at: 0, value: null };
}

// ---- test seams -----------------------------------------------------------
let messagingOverride = null;
let onlineOverride = null;
function setMessagingForTests(fn) {
  messagingOverride = typeof fn === 'function' ? fn : null;
}
function setOnlineCheckerForTests(fn) {
  onlineOverride = typeof fn === 'function' ? fn : null;
}
function resetForTests() {
  recentPushes.clear();
  knownTokens = { at: 0, value: null };
  messagingOverride = null;
  onlineOverride = null;
}

function currentMessaging() {
  return messagingOverride || getMessaging();
}

function isOnline(userId) {
  return onlineOverride ? Boolean(onlineOverride(String(userId))) : realtime.isUserOnline(userId);
}

function pruneCoalescing(now) {
  if (recentPushes.size < 2000) return;
  for (const [key, at] of recentPushes) {
    if (now - at >= COALESCE_MS) recentPushes.delete(key);
  }
}

/** True when this recipient+chat was pushed too recently (drop = coalesce). */
function isCoalesced(userId, chatId, now) {
  pruneCoalescing(now);
  const key = `${userId}:${chatId}`;
  const at = recentPushes.get(key);
  if (at && now - at < COALESCE_MS) return true;
  recentPushes.set(key, now);
  return false;
}

/* ------------------------------------------------------------- payloads */

function messagePreview(message) {
  const type = String((message && message.type) || 'text');
  if (type === 'image') return '📷 Photo';
  if (type === 'video') return '🎥 Video';
  if (type === 'audio') return '🎤 Voice message';
  if (type === 'file') return '📎 File';
  const text = String((message && message.content) || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, PREVIEW_MAX) : 'New message';
}

/** One Android-style message notification (title = sender, body = preview). */
function buildChatMessage({ token, chatId, senderName, message, hidePreview = false }) {
  return {
    token,
    notification: { title: String(senderName || 'Chatgram'), body: messagePreview(message) },
    data: {
      chatId: String(chatId),
      type: 'message',
      hidePreview: hidePreview ? 'true' : 'false',
    },
    android: {
      priority: 'high',
      collapseKey: `chat-${chatId}`,
      notification: { tag: String(chatId), channelId: 'messages' },
    },
  };
}

/** Data-only wake-up for an incoming call; no notification block, 45 s TTL. */
function buildCallMessage({ token, callId, chatId, callerName, kind, groupName }) {
  const data = {
    type: 'call',
    callId: String(callId),
    chatId: String(chatId),
    callerName: String(callerName || 'Chatgram'),
    kind: kind === 'video' ? 'video' : 'audio',
  };
  if (groupName) data.groupName = String(groupName);
  return {
    token,
    data,
    android: { priority: 'high', ttl: 45000 },
  };
}

function buildTestMessage({ token }) {
  return {
    token,
    notification: { title: 'Chatgram', body: 'Push notifications are working on this device.' },
    data: { type: 'test' },
    android: { priority: 'high', notification: { channelId: 'messages' } },
  };
}

/* ------------------------------------------------------- failure logging */

/** Firebase error code, reduced to a safe token (never the error message). */
function errorCodeOf(error) {
  const code = String((error && error.code) || '').trim();
  return /^[A-Za-z0-9/_.:-]{1,60}$/.test(code) ? code : 'unknown-error';
}

/**
 * Upsert one content-free `push_failure` Admin Inbox row per device token.
 * Same mechanism as callQualityController: one row, count++, ignored rows are
 * left alone. Never throws.
 */
async function recordPushFailure(deviceToken, error) {
  try {
    const { AdminInbox } = require('../ai/chatgram');
    const code = errorCodeOf(error);
    const platform = deviceToken && deviceToken.platform === 'web' ? 'Web' : 'Android';
    const text = `Push delivery failed: ${code} (${platform})`;
    const normalized = `push:${String(deviceToken._id)}`;
    const now = new Date();
    await AdminInbox.findOneAndUpdate(
      { normalized, status: { $ne: 'ignored' } },
      {
        $set: {
          type: 'push_failure',
          question: text,
          title: 'Push delivery failed',
          summary: text,
          source: 'push',
          lastSeenAt: now,
        },
        $setOnInsert: {
          status: 'new',
          createdAt: now,
          // No identity or content is stored for a delivery failure.
          askerId: null,
          askerHash: '',
          askerName: '',
          redactedContext: '',
        },
        $inc: { count: 1 },
      },
      { upsert: true },
    );
  } catch (logError) {
    console.warn('Push failure log skipped:', String(logError?.message || logError).slice(0, 160));
  }
}

/* --------------------------------------------------------------- sending */

/**
 * Send one prepared FCM message per token. Marks permanently invalid tokens and
 * logs every failure. Returns { sent, failed, disabled? }.
 */
async function deliver(deviceTokens, buildMessage) {
  const tokens = (deviceTokens || []).filter((row) => row && !row.invalid);
  if (!tokens.length) return { sent: 0, failed: 0 };

  const messaging = currentMessaging();
  if (!messaging) return { sent: 0, failed: 0, disabled: true };
  // The real client exposes .send(); the test seam may be a bare function.
  const send = typeof messaging === 'function' ? messaging : messaging.send.bind(messaging);

  let sent = 0;
  let failed = 0;
  for (const deviceToken of tokens) {
    try {
      await send(buildMessage(deviceToken));
      sent += 1;
    } catch (error) {
      failed += 1;
      const code = errorCodeOf(error);
      if (INVALID_TOKEN_CODES.has(code)) {
        // Skip it from now on; the app re-registers a fresh token on next launch.
        await DeviceToken.updateOne({ _id: deviceToken._id }, { $set: { invalid: true } }).catch(() => {});
      }
      await recordPushFailure(deviceToken, error);
    }
  }
  return { sent, failed };
}

/**
 * Recipients allowed to receive a push right now: not muted, not in DND, and
 * offline unless `force`. Missing/deleted users are dropped.
 */
async function eligibleUserIds(userIds, { chatId, force = false, now = Date.now() } = {}) {
  const ids = [...new Set((userIds || []).map(String).filter(Boolean))];
  if (!ids.length) return [];
  const users = await User.find({ _id: { $in: ids } })
    .select('notificationPrefs mutedChats')
    .lean();
  const clock = new Date(now);
  return users
    .filter((user) => {
      if (!force && isOnline(String(user._id))) return false;
      if (isChatMuted(user, chatId, clock)) return false;
      if (isDoNotDisturbActive(user, clock)) return false;
      return true;
    })
    .map((user) => String(user._id));
}

async function tokensForUsers(userIds) {
  if (!userIds.length) return [];
  return DeviceToken.find({ userId: { $in: userIds }, invalid: { $ne: true } }).lean();
}

/**
 * Fire-and-forget push for a stored chat message.
 * @param {{chat: object, sender: object|string, message: object, force?: boolean, hidePreview?: boolean}} params
 */
async function pushChatMessage({ chat, sender, message, force = false, hidePreview = false } = {}) {
  try {
    if (!chat || !message || !chat._id) return { sent: 0, failed: 0 };
    const now = Date.now();
    if (!(await hasAnyValidTokens(now))) return { sent: 0, failed: 0 };
    const senderId = String(
      (sender && (sender._id || sender.id)) || (message.senderId && (message.senderId._id || message.senderId)) || '',
    );
    const recipients = (chat.participants || []).map(String).filter((id) => id && id !== senderId);
    if (!recipients.length) return { sent: 0, failed: 0 };

    const eligible = (await eligibleUserIds(recipients, { chatId: String(chat._id), force, now }))
      .filter((userId) => !isCoalesced(userId, String(chat._id), now));
    if (!eligible.length) return { sent: 0, failed: 0, skipped: recipients.length };

    const senderName =
      (sender && sender.displayName) ||
      (await User.findById(senderId).select('displayName').lean())?.displayName ||
      'Chatgram';

    const deviceTokens = await tokensForUsers(eligible);
    if (!deviceTokens.length) return { sent: 0, failed: 0, skipped: eligible.length };

    const result = await deliver(deviceTokens, (deviceToken) =>
      buildChatMessage({
        token: deviceToken.token,
        chatId: chat._id,
        senderName,
        message,
        hidePreview,
      }),
    );
    return { ...result, recipients: eligible.length, tokens: deviceTokens.length };
  } catch (error) {
    console.warn('Message push skipped:', String(error?.message || error).slice(0, 160));
    return { sent: 0, failed: 0, error: true };
  }
}

/**
 * Fire-and-forget data-only call push. Calls pass `force: true` because the
 * phone must wake even if the socket registry still thinks the user is online.
 */
async function pushCall({ callId, chatId, callerName, kind, groupName, recipientIds, force = true } = {}) {
  try {
    if (!callId || !chatId) return { sent: 0, failed: 0 };
    if (!(await hasAnyValidTokens(Date.now()))) return { sent: 0, failed: 0 };
    const eligible = await eligibleUserIds(recipientIds, { chatId: String(chatId), force });
    if (!eligible.length) return { sent: 0, failed: 0, skipped: (recipientIds || []).length };
    const deviceTokens = await tokensForUsers(eligible);
    if (!deviceTokens.length) return { sent: 0, failed: 0, skipped: eligible.length };
    const result = await deliver(deviceTokens, (deviceToken) =>
      buildCallMessage({
        token: deviceToken.token,
        callId,
        chatId,
        callerName,
        kind,
        groupName,
      }),
    );
    return { ...result, recipients: eligible.length, tokens: deviceTokens.length };
  } catch (error) {
    console.warn('Call push skipped:', String(error?.message || error).slice(0, 160));
    return { sent: 0, failed: 0, error: true };
  }
}

/**
 * Send the "test notification" to every valid device of one user.
 * Deliberately ignores DND/mute (the user explicitly pressed Test).
 */
async function sendTestPush(userId) {
  const deviceTokens = await tokensForUsers([String(userId)]);
  if (!deviceTokens.length) return { sent: 0, failed: 0 };
  const result = await deliver(deviceTokens, (deviceToken) =>
    buildTestMessage({ token: deviceToken.token }),
  );
  return { sent: result.sent, failed: result.failed, disabled: Boolean(result.disabled) };
}

module.exports = {
  pushChatMessage,
  pushCall,
  sendTestPush,
  buildChatMessage,
  buildCallMessage,
  buildTestMessage,
  messagePreview,
  recordPushFailure,
  errorCodeOf,
  eligibleUserIds,
  invalidateTokenCache,
  // test seams
  setMessagingForTests,
  setOnlineCheckerForTests,
  resetForTests,
};
