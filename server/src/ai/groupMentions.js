/**
 * Group "@Chatgram AI" mentions (Change 1).
 *
 * Off by default. A group admin can enable it in the group's settings; members
 * then ask the assistant by writing "@Chatgram AI <question>" in the group. Only
 * the messages that mention the assistant are ever sent to the provider, the
 * answer is posted back into the group thread as the built-in Chatgram AI
 * account, and the whole feature is rate limited per group so it can never spam.
 *
 * Failures are silent to the user (logged, redacted) — a group chat must not
 * break because a model provider is down.
 */
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const User = require('../models/User');
const { service } = require('./service');
const { getPolicy } = require('./policy');
const realtime = require('../utils/realtime');
const aiAccount = require('../utils/aiAccount');

const MENTION_RE = /@chatgram\s*ai\b/i;
const HISTORY_LIMIT = 10;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 3;
const MIN_GAP_MS = 20 * 1000;
const MAX_REPLY_CHARS = 1400;

/** chatId -> timestamps of recent AI replies (in-memory, resets on restart). */
const recent = new Map();

function isMention(content) {
  return MENTION_RE.test(String(content || ''));
}

function rateLimited(chatId) {
  const now = Date.now();
  const rows = (recent.get(chatId) || []).filter((at) => now - at < WINDOW_MS);
  recent.set(chatId, rows);
  if (rows.length >= MAX_PER_WINDOW) return true;
  const last = rows[rows.length - 1];
  if (last && now - last < MIN_GAP_MS) return true;
  return false;
}

function noteReply(chatId) {
  const rows = recent.get(chatId) || [];
  rows.push(Date.now());
  recent.set(chatId, rows);
}

function cleanAnswer(text) {
  // Strip the silent-learning marker if a provider emits it here too.
  const cleaned = String(text || '')
    .replace(/\[\[CHATGRAM_UNKNOWN:[^\]]*\]\]/gi, '')
    .trim();
  return cleaned.slice(0, MAX_REPLY_CHARS);
}

async function conversationFor(chat, aiId) {
  const rows = await Message.find({ chatId: chat._id, isDeleted: { $ne: true }, type: 'text' })
    .sort({ sentAt: -1 })
    .limit(HISTORY_LIMIT);
  return rows
    .reverse()
    .filter((row) => String(row.content || '').trim())
    .map((row) => ({
      role: String(row.senderId) === String(aiId) ? 'assistant' : 'user',
      text: String(row.content).trim().slice(0, 900),
    }));
}

function systemPrompt(groupName, askerName) {
  return [
    'You are Chatgram AI, answering inside a group chat on Chatgram.',
    `The group is called "${groupName || 'Chatgram group'}" and ${askerName || 'a member'} just mentioned you.`,
    'Answer helpfully and briefly (at most ~120 words).',
    "Reply in the language of the question (English, Kinyarwanda, French or Swahili).",
    'Never claim to be human, never ask for passwords, verification codes or tokens.',
    'Only the reply text is needed — no preamble, no "here is my answer".',
  ].join('\n');
}

/**
 * Answer a group message that mentions the assistant, if the group opted in.
 * Resolves to the created reply message or null.
 */
async function maybeAnswer({ chat, message, io }) {
  if (!chat || chat.type !== 'group') return null;
  if (!chat.groupSettings?.aiMentions) return null;
  if (!message || message.type !== 'text') return null;
  if (!message.content || !isMention(message.content)) return null;

  const aiId = await aiAccount.ensureAiUser();
  if (!aiId) return null;
  if (String(message.senderId?._id || message.senderId) === String(aiId)) return null;
  if (rateLimited(String(chat._id))) return null;

  const policy = await getPolicy();
  const blocked = Array.isArray(policy.blockedTopics) ? policy.blockedTopics : [];
  const topic = String(message.content).toLowerCase();
  if (blocked.some((word) => word && topic.includes(String(word).toLowerCase()))) {
    return null;
  }

  // Reserve the rate-limit slot BEFORE calling the provider: five mentions sent
  // in the same second must produce one answer, not five concurrent ones.
  noteReply(String(chat._id));

  // The AI must be a participant to post into the conversation.
  const participantIds = (chat.participants || []).map((p) => String(p._id || p));
  if (!participantIds.includes(String(aiId))) {
    await Chat.findByIdAndUpdate(chat._id, { $addToSet: { participants: aiId } });
  }

  let answer;
  try {
    const history = await conversationFor(chat, aiId);
    const asker = await User.findById(message.senderId?._id || message.senderId).select('displayName').lean();
    // Same streaming path as the Chatgram AI thread (the legacy `service.chat`
    // gate on the old "AI enabled" flag would silently disable group answers).
    let full = '';
    for await (const chunk of service.streamForFeature({
      feature: 'chatgramAI',
      system: systemPrompt(chat.groupName, asker?.displayName),
      messages: history,
      maxTokens: 400,
    })) {
      full += chunk.delta || '';
    }
    answer = cleanAnswer(full);
  } catch (error) {
    console.warn('Group AI mention failed:', String(error?.message || error).slice(0, 160));
    return null;
  }
  if (!answer) return null;

  const created = await Message.create({
    chatId: chat._id,
    senderId: aiId,
    type: 'text',
    content: answer,
    sentAt: new Date(),
    deliveredTo: [aiId],
    readBy: [aiId],
  });
  await Chat.findByIdAndUpdate(chat._id, { lastMessage: created._id, updatedAt: new Date() });

  const populated = await Message.findById(created._id).populate('senderId', '_id displayName avatarUrl');
  const payload = populated.toObject();
  const target = io || realtime.getIo();
  if (target) {
    realtime.joinUsersToChat(chat._id, [...participantIds, String(aiId)]);
    target.to(realtime.roomForChat(chat._id)).emit('message:new', payload);
  }
  return payload;
}

/** Test-only: reset the per-group rate limiter. */
function resetRateLimiter() {
  recent.clear();
}

module.exports = {
  maybeAnswer,
  isMention,
  rateLimited,
  resetRateLimiter,
  MENTION_RE,
  MAX_PER_WINDOW,
  MIN_GAP_MS,
};
