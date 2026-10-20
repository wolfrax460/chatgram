/**
 * The built-in support account.
 *
 * Every user gets a permanent conversation with this account so they can report
 * bugs, ask for help and request changes without having to know anybody's
 * username first. The admin (you) signs in as this account and reads the
 * messages from the normal chat list.
 *
 * Configured with:
 *   SUPPORT_EMAIL       login address  (default support@chatgram.local)
 *   SUPPORT_NAME        display name   (default "Chatgram Support")
 *   SUPPORT_PASSWORD    initial password; only used when the account is created
 *
 * The account is created once, on startup, if it does not already exist.
 * Changing SUPPORT_PASSWORD later does NOT reset an existing password — use the
 * app's "Forgot password" flow if you need to change it.
 */
const User = require('../models/User');

const SUPPORT_EMAIL = (process.env.SUPPORT_EMAIL || 'support@chatgram.local').toLowerCase();
const SUPPORT_NAME = process.env.SUPPORT_NAME || 'Chatgram Support';
const SUPPORT_PASSWORD = process.env.SUPPORT_PASSWORD || '';

let cachedId = null;

/** Find the support account, creating it if this is a fresh deployment. */
async function ensureSupportUser() {
  if (cachedId) return cachedId;

  let user = await User.findOne({ isSupportAccount: true });
  if (user) {
    cachedId = user._id.toString();
    return cachedId;
  }

  // Fall back to matching by email so a manually created account is adopted
  // rather than duplicated.
  user = await User.findOne({ email: SUPPORT_EMAIL });
  if (user) {
    user.isSupportAccount = true;
    user.role = 'admin';
    await user.save({ validateBeforeSave: false });
    cachedId = user._id.toString();
    console.log(`Support account adopted: ${user.displayName} <${user.email}>`);
    return cachedId;
  }

  if (!SUPPORT_PASSWORD) {
    console.warn(
      'Support account not created: set SUPPORT_PASSWORD in .env to create it on startup.'
    );
    return null;
  }

  user = await User.create({
    displayName: SUPPORT_NAME,
    email: SUPPORT_EMAIL,
    password: SUPPORT_PASSWORD,
    authProvider: 'local',
    role: 'admin',
    isSupportAccount: true,
    about: 'Official Chatgram support — report bugs, ask for help or request a feature.',
  });

  cachedId = user._id.toString();
  console.log(`Support account created: ${user.displayName} <${user.email}>`);
  return cachedId;
}

/** The support account's _id, or null if it has not been set up. */
function supportUserId() {
  return cachedId;
}

/** Public info the client needs to label the conversation. */
function supportProfile() {
  return {
    enabled: Boolean(cachedId),
    displayName: SUPPORT_NAME,
  };
}

module.exports = { ensureSupportUser, supportUserId, supportProfile, SUPPORT_EMAIL, SUPPORT_NAME };
