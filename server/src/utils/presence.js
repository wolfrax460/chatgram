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
  }
  return result;
}

/** Same, for a list. */
function maskPresenceList(users, viewerId) {
  if (!Array.isArray(users)) return users;
  return users.map((u) => maskPresence(u, viewerId));
}

module.exports = { canSeePresence, maskPresence, maskPresenceList };
