/**
 * Blocking.
 *
 * Blocking is symmetric in effect: if either side blocked the other, they
 * cannot message each other, start a chat, or view each other's profile. The
 * profile endpoint answers 404 (not 403) so a blocked person cannot tell the
 * difference between "blocked" and "account deleted".
 */
const User = require('../models/User');

function idOf(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return value._id.toString();
  return String(value);
}

/**
 * @returns {Promise<{iBlocked: boolean, blockedMe: boolean, either: boolean}>}
 */
async function blockStatus(viewerId, targetId) {
  const viewer = idOf(viewerId);
  const target = idOf(targetId);
  if (!viewer || !target) return { iBlocked: false, blockedMe: false, either: false };
  if (viewer === target) return { iBlocked: false, blockedMe: false, either: false };

  const users = await User.find({ _id: { $in: [viewer, target] } })
    .select('blocked')
    .lean();

  const byId = new Map(users.map((user) => [String(user._id), user.blocked || []]));
  const viewerBlocked = byId.get(viewer) || [];
  const targetBlocked = byId.get(target) || [];
  const iBlocked = viewerBlocked.some((id) => String(id) === target);
  const blockedMe = targetBlocked.some((id) => String(id) === viewer);
  return { iBlocked, blockedMe, either: iBlocked || blockedMe };
}

/** Shorthand for the message/chat paths. */
async function blockedBetween(a, b) {
  const status = await blockStatus(a, b);
  return status.either;
}

module.exports = { blockStatus, blockedBetween, idOf };
