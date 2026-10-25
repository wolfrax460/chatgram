/**
 * Account moderation state (9b/9d): suspended and banned accounts are blocked
 * from the API and from signing in. A suspension ends by itself when
 * suspendedUntil passes; a ban needs an admin unban.
 */
const User = require('../models/User');

function suspensionActive(user) {
  if (!user || user.status !== 'suspended') return false;
  if (!user.suspendedUntil) return true;
  return new Date(user.suspendedUntil).getTime() > Date.now();
}

function blockReason(user) {
  if (!user) return null;
  if (user.status === 'banned') {
    return {
      code: 'ACCOUNT_BANNED',
      message: user.moderationReason
        ? `This account is banned: ${user.moderationReason}`
        : 'This account is banned. Contact Chatgram support if you think this is a mistake.',
    };
  }
  if (suspensionActive(user)) {
    const until = user.suspendedUntil ? new Date(user.suspendedUntil).toLocaleString() : null;
    return {
      code: 'ACCOUNT_SUSPENDED',
      message: until
        ? `This account is suspended until ${until}.`
        : 'This account is suspended.',
    };
  }
  return null;
}

/** Returns a block descriptor, or null for an active account (clearing an expired suspension). */
async function assertAccountActive(user) {
  const blocked = blockReason(user);
  if (blocked) return blocked;
  if (user.status === 'suspended') {
    // Expired suspension: clear it so the account is truly active again.
    await User.updateOne({ _id: user._id }, { $set: { status: 'active', suspendedUntil: null } });
    user.status = 'active';
    user.suspendedUntil = null;
  }
  return null;
}

module.exports = { suspensionActive, blockReason, assertAccountActive };
