/**
 * The built-in Chatgram AI contact.
 *
 * Chatgram AI is a conversation (Meta-AI style), not a real person. This account
 * only matters for group conversations: when a group opts in to "@Chatgram AI"
 * mentions, the assistant posts its answer as this account so members see a
 * normal member message with the official avatar.
 *
 * It is never returned by people search (`isAiAccount`), has no password and
 * cannot be signed into.
 */
const User = require('../models/User');

const AI_EMAIL = (process.env.CHATGRAM_AI_EMAIL || 'chatgram-ai@chatgram.local').toLowerCase();
const AI_NAME = process.env.CHATGRAM_AI_NAME || 'Chatgram AI';
const AI_AVATAR = process.env.CHATGRAM_AI_AVATAR || '/web/assistant-avatar.svg';

let cachedId = null;

/** Find the Chatgram AI account, creating it on first use. Never throws. */
async function ensureAiUser() {
  if (cachedId) return cachedId;
  try {
    let user = await User.findOne({ isAiAccount: true });
    if (!user) user = await User.findOne({ email: AI_EMAIL });
    if (user) {
      if (!user.isAiAccount) {
        user.isAiAccount = true;
        await user.save({ validateBeforeSave: false });
      }
      cachedId = user._id.toString();
      return cachedId;
    }
    user = await User.create({
      displayName: AI_NAME,
      email: AI_EMAIL,
      authProvider: 'google', // no local password: this account cannot be signed into
      isAiAccount: true,
      avatarUrl: AI_AVATAR,
      about: 'Official Chatgram AI — mention @Chatgram AI in a group to ask a question.',
    });
    cachedId = user._id.toString();
    console.log(`Chatgram AI account created: ${user.displayName} <${user.email}>`);
    return cachedId;
  } catch (error) {
    console.warn('Could not ensure the Chatgram AI account:', error.message);
    return null;
  }
}

function aiUserId() {
  return cachedId;
}

module.exports = { ensureAiUser, aiUserId, AI_NAME, AI_AVATAR, AI_EMAIL };
