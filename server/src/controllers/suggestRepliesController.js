/**
 * POST /api/ai/suggest-replies { chatId } -> { suggestions: string[] }
 *
 * Opt-in only; always answers 200 with an array (empty on failure or when the
 * feature is off). Rate limited per user; never stores the transcript.
 */
const mongoose = require('mongoose');
const { allowRequest, suggestRepliesForUser, RATE_MAX } = require('../ai/suggestReplies');

const suggestReplies = async (req, res) => {
  try {
    const chatId = String(req.body?.chatId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({ message: 'A valid chatId is required.', code: 'INVALID_CHAT' });
    }
    if (!allowRequest(req.user._id)) {
      return res.status(429).json({
        message: 'Too many suggestion requests. Try again later.',
        code: 'RATE_LIMITED',
        limitPerHour: RATE_MAX,
      });
    }
    // Never throws: provider failure means "no chips", not an error.
    const result = await suggestRepliesForUser(req.user._id, chatId);
    return res.json({ suggestions: Array.isArray(result?.suggestions) ? result.suggestions : [] });
  } catch (error) {
    console.warn('Suggest replies failed:', String(error?.message || error).slice(0, 140));
    return res.json({ suggestions: [] });
  }
};

module.exports = { suggestReplies };
