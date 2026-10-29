/**
 * Opt-in smart reply suggestions for a chat.
 *
 * Rules:
 *  - only when the signed-in user has `suggestReplies` enabled (default false);
 *  - only for a chat they participate in; the last 5 text messages are used
 *    (media excluded, AI/bot/support senders excluded, auto-replies excluded);
 *  - the transcript is redacted with the existing AI redaction helper before it
 *    leaves the server; nothing is stored (no transcript, no suggestions);
 *  - exactly up to 3 short replies are returned, validated (deduped, trimmed,
 *    ≤120 chars, links/emails/phones dropped);
 *  - any provider failure returns an empty list, never an error;
 *  - rate limit: 20 requests per user per hour (in-memory, per process).
 */
const mongoose = require('mongoose');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const { redact } = require('./redact');

const MAX_SUGGESTIONS = 3;
const MAX_LENGTH = 120;
const HISTORY = 5;
const RATE_MAX = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const buckets = new Map(); // userId -> [timestamps]

const LINK_RE = /(https?:\/\/|www\.)/i;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const PHONE_RE = /(?:\+\d[\d\s().-]{6,18}\d|\b0\d{9}\b|\b\d{10,13}\b)/;

const SYSTEM = [
  'You suggest replies for a chat conversation.',
  'Write exactly 3 short, natural replies that the person receiving the latest messages could send next.',
  'Use the language of the conversation. Each reply must be at most 120 characters.',
  'Do not include links, email addresses, phone numbers, quotes, numbering or explanations.',
  'Output one reply per line and nothing else.',
].join('\n');

function allowRequest(userId) {
  const now = Date.now();
  const key = String(userId);
  const recent = (buckets.get(key) || []).filter((at) => now - at < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > 5000) {
    for (const [id, list] of buckets) {
      if (!list.some((at) => now - at < RATE_WINDOW_MS)) buckets.delete(id);
    }
  }
  return true;
}

function looksUnsafe(text) {
  return LINK_RE.test(text) || EMAIL_RE.test(text) || PHONE_RE.test(text);
}

/** Strip bullets/numbering/quotes and validate one candidate line. */
function cleanCandidate(value) {
  let text = String(value ?? '').trim();
  text = text.replace(/^[-*•\u2022]\s*/, '').replace(/^\d+[.)]\s*/, '').replace(/^["'“”]+|["'“”]+$/g, '').trim();
  text = text.replace(/\s+/g, ' ');
  if (!text || text.length > MAX_LENGTH || looksUnsafe(text)) return null;
  return text;
}

/** Parse raw model output into up to 3 validated, deduped suggestions. */
function parseSuggestions(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  let candidates = [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) candidates = parsed.map((item) => (typeof item === 'string' ? item : ''));
    } catch {
      candidates = [];
    }
  }
  if (candidates.length === 0) candidates = text.split(/\r?\n/);
  const seen = new Set();
  const out = [];
  for (const candidate of candidates) {
    const cleaned = cleanCandidate(candidate);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

/** Last 5 text messages in the user's own chat, excluding AI/support senders. */
async function conversationHistory(chatId, userId) {
  const systemAccounts = await User.find({
    $or: [{ isAiAccount: true }, { isSupportAccount: true }],
  })
    .select('_id')
    .lean();
  const excluded = systemAccounts.map((row) => row._id);
  const rows = await Message.find({
    chatId,
    type: 'text',
    isDeleted: { $ne: true },
    deletedFor: { $ne: userId },
    autoReply: { $ne: true },
    senderId: { $nin: excluded },
    ...Message.visibilityFilter(userId),
  })
    .sort({ _id: -1 })
    .limit(HISTORY * 4)
    .lean();
  // Newest-first query -> take the 5 most recent, then present chronologically.
  return rows.slice(0, HISTORY).reverse();
}

function buildPrompt(history) {
  const lines = history.map((message) => {
    const role = 'User';
    const text = redact(String(message.content || '').slice(0, 500), { allowContact: false });
    return `${role}: ${text}`;
  });
  return lines.join('\n');
}

/**
 * @returns {Promise<{suggestions: string[]}>} never throws
 */
async function suggestRepliesForUser(userId, chatId) {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(chatId))) return { suggestions: [] };
    const me = await User.findById(userId).select('suggestReplies').lean();
    if (!me || me.suggestReplies !== true) return { suggestions: [] };
    const chat = await Chat.findOne({ _id: chatId, participants: userId }).select('_id type participants').lean();
    if (!chat) return { suggestions: [] };
    const history = await conversationHistory(chatId, userId);
    if (history.length === 0) return { suggestions: [] };

    const service = require('./service');
    const result = await service.chat({
      feature: 'support',
      system: SYSTEM,
      messages: [{ role: 'user', text: buildPrompt(history) }],
      maxTokens: 200,
      temperature: 0.5,
    });
    return { suggestions: parseSuggestions(result?.text) };
  } catch (error) {
    // Provider unavailable / budget / breaker: no chips, never an error.
    return { suggestions: [] };
  }
}

module.exports = {
  allowRequest,
  suggestRepliesForUser,
  parseSuggestions,
  cleanCandidate,
  MAX_SUGGESTIONS,
  MAX_LENGTH,
  RATE_MAX,
};
