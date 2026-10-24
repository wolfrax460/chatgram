/**
 * Presence privacy.
 *
 * A user can switch their online/last-seen off entirely, or keep it on while
 * hiding it from specific people. Everywhere a user object is returned we run
 * it through [maskPresence] so the fields simply are not there for viewers who
 * are not allowed to see them — the client never has to enforce this.
 */

/** Does `owner` allow `viewerId` to see their online state? */
function canSeePresence(owner, viewerId) {
  if (!owner) return false;

  const ownerId = owner._id ? owner._id.toString() : String(owner);
  const viewer = viewerId ? viewerId.toString() : null;

  // You can always see yourself.
  if (viewer && viewer === ownerId) return true;

  // Global switch off.
  if (owner.showOnlineStatus === false) return false;

  // Per-person exceptions.
  const exceptions = owner.onlineStatusExceptions || [];
  if (viewer && exceptions.some((id) => id.toString() === viewer)) return false;

  return true;
}

/**
 * Strip `isOnline` / `lastSeen` from a plain user object (or a populated
 * Mongoose doc converted with .lean()/.toObject()) when the viewer may not
 * see them.
 */
function maskPresence(user, viewerId) {
  if (!user) return user;

  const plain = typeof user.toObject === 'function' ? user.toObject() : user;
  const allowed = canSeePresence(plain, viewerId);

  const result = { ...plain };

  // Never hand another person your raw privacy settings.
  delete result.showOnlineStatus;
  delete result.onlineStatusExceptions;

  if (!allowed) {
    result.isOnline = false;
    result.lastSeen = null;
    // Tells the client not to render a presence line at all, rather than
    // showing a misleading "offline".
    result.presenceHidden = true;
  } else {
    // Presence is decided by live sockets, never by the persisted flag.
    result.isOnline = livePresence(result._id || result.id);
  }
  return result;
}

/** Same, for a list. */
function maskPresenceList(users, viewerId) {
  if (!Array.isArray(users)) return users;
  return users.map((u) => maskPresence(u, viewerId));
}

/**
 * Live presence lookup.
 *
 * `User.isOnline` is persisted so admin tooling has a hint, but it can be left
 * stuck at `true` by a crash or restart (sockets die without running their
 * disconnect handler). Every read path must therefore ask the socket registry
 * instead. A user is online when they hold at least one live socket.
 */
function livePresence(userId) {
  // Required lazily so this module stays usable in tests that never boot sockets.
  const realtime = require('./realtime');
  return realtime.isUserOnline(userId);
}

/**
 * Rewrite a user object's `isOnline` from live sockets, keeping privacy intact.
 * Accepts a plain object; returns a plain object.
 */
function applyLivePresence(user, viewerId) {
  if (!user) return user;
  const plain = typeof user.toObject === 'function' ? user.toObject() : { ...user };
  const allowed = canSeePresence(plain, viewerId);
  plain.isOnline = allowed ? livePresence(plain._id || plain.id) : false;
  if (!allowed) plain.lastSeen = null;
  else if (plain.isOnline) plain.lastSeen = plain.lastSeen || null;
  delete plain.showOnlineStatus;
  delete plain.onlineStatusExceptions;
  if (!allowed) plain.presenceHidden = true;
  return plain;
}

/** Rewrite a chat's participant presence from live sockets (lean or document). */
function chatWithLivePresence(chat, viewerId) {
  if (!chat) return chat;
  const plain = typeof chat.toObject === 'function' ? chat.toObject() : { ...chat };
  plain.participants = (plain.participants || []).map((p) => applyLivePresence(p, viewerId));
  return plain;
}

/** Online people first, then alphabetical - the DB flag order cannot be trusted. */
function sortByPresence(list) {
  if (!Array.isArray(list)) return list;
  return [...list].sort((a, b) => {
    const byPresence = Number(b.isOnline === true) - Number(a.isOnline === true);
    if (byPresence !== 0) return byPresence;
    return String(a.displayName || '').localeCompare(String(b.displayName || ''));
  });
}

function applyLivePresenceList(users, viewerId) {
  if (!Array.isArray(users)) return users;
  return users.map((u) => applyLivePresence(u, viewerId));
}

/**
 * Clear every persisted online flag.
 *
 * Runs on every boot (and once by hand for the initial cleanup). `lastSeen` is
 * preserved as the last known activity; it only falls back to "now" when the
 * document has never recorded one.
 *
 * @param {{dryRun?: boolean, sampleLimit?: number}} options
 */
async function resetStuckPresence({ dryRun = false, sampleLimit = 20 } = {}) {
  const User = require('../models/User');
  const stuck = await User.find({ isOnline: true })
    .select('_id displayName lastSeen')
    .sort({ lastSeen: 1 })
    .lean();

  const users = stuck.slice(0, sampleLimit).map((row) => ({
    id: String(row._id),
    displayName: row.displayName,
    lastSeen: row.lastSeen || null,
  }));

  if (dryRun || stuck.length === 0) {
    return { scanned: stuck.length, changed: 0, dryRun, users };
  }

  const now = new Date();
  // Fill in a missing lastSeen first, then clear the flags. Two plain updates
  // keep this portable (Mongoose 9 needs updatePipeline for pipeline updates).
  await User.updateMany({ isOnline: true, lastSeen: null }, { $set: { lastSeen: now } });
  const result = await User.updateMany({ isOnline: true }, { $set: { isOnline: false } });

  return {
    scanned: stuck.length,
    changed: result.modifiedCount ?? result.nModified ?? 0,
    dryRun: false,
    users,
  };
}

module.exports = {
  canSeePresence,
  maskPresence,
  maskPresenceList,
  livePresence,
  applyLivePresence,
  applyLivePresenceList,
  sortByPresence,
  chatWithLivePresence,
  resetStuckPresence,
};
