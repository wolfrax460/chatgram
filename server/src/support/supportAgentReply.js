/**
 * Answer direct messages sent to the Chatgram Support account, in-app.
 *
 * This is the counterpart to agentResponder (which handles widget tickets).
 * When a user opens the normal "Chatgram Support" conversation and writes to
 * it, this module answers as that account using the knowledge base, or
 * escalates to the owner on Telegram/email when it is not confident.
 *
 * Skips:
 *  - messages SENT BY the support account (no replying to itself)
 *  - the ticket "Support Desk" conversation (agentResponder owns that)
 *  - anything when SUPPORT_AGENT_ENABLED is not "true"
 */
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const SupportTicket = require('../models/SupportTicket');
const ai = require('./aiProvider');
const notifier = require('./notifier');
const knowledgeBase = require('./knowledge-base.json');

const DESK_EMAIL = 'support-desk@chatgram.local';

let supportIdCache = null;
async function supportUserId() {
  if (supportIdCache) return supportIdCache;
  const user = await User.findOne({ isSupportAccount: true }).select('_id');
  supportIdCache = user ? String(user._id) : null;
  return supportIdCache;
}

function systemPrompt(userName) {
  const kb = knowledgeBase.entries.map((e) => `### ${e.title}\n${e.answer}`).join('\n\n');
  return [
    'You are Chatgram Support replying inside the app chat.',
    `The person you are talking to is called ${userName}.`,
    'Answer ONLY from the knowledge base below, briefly and warmly.',
    "Reply in the user's language (English, Kinyarwanda, French or Swahili).",
    'Never ask for passwords, verification codes or tokens.',
    'Never claim to be a human. If asked, say you are the Chatgram help assistant.',
    '',
    'Output format — follow exactly:',
    'First line: CONFIDENT or ESCALATE',
    'If CONFIDENT: the following lines are your reply to the user.',
    'If ESCALATE: nothing after the first line.',
    '',
    'Use ESCALATE when the knowledge base does not cover it, the user needs an',
    'account action, reports a bug, asks about payments/refunds, or you are unsure.',
    '',
    'KNOWLEDGE BASE:',
    kb,
  ].join('\n');
}

function parseVerdict(raw) {
  const text = String(raw || '').trim();
  if (!text) return { confident: false, answer: '' };
  const [first, ...rest] = text.split('\n');
  const answer = rest.join('\n').trim();
  if (first.trim().toUpperCase().startsWith('ESCALATE')) return { confident: false, answer: '' };
  if (first.trim().toUpperCase().startsWith('CONFIDENT')) {
    return { confident: answer.length > 15, answer };
  }
  return { confident: text.length > 40, answer: text };
}

/** Recent messages of the chat, mapped to model roles (support = assistant). */
async function historyFor(chatId, supportId) {
  const rows = await Message.find({ chatId, isDeleted: { $ne: true } })
    .sort({ sentAt: -1 })
    .limit(12);
  return rows.reverse().map((m) => ({
    role: String(m.senderId) === supportId ? 'assistant' : 'user',
    text: String(m.content || '').slice(0, 1500),
  }));
}

async function escalateToOwner(senderName, text, history) {
  const summary = `Chatgram Support could not answer ${senderName} in-app.\n\nTheir message: ${text}\n\nRecent conversation:\n${history
    .slice(-6)
    .map((h) => `${h.role === 'user' ? senderName : 'Assistant'}: ${h.text}`)
    .join('\n')}`;
  try {
    await notifier.notifyTicket({
      ticketId: 'in-app',
      contact: `in-app message from ${senderName}`,
      contactType: 'email',
      status: 'open',
      summary,
      meta: { page: 'in-app chat', userAgent: '', appVersion: '' },
      transcript: history.slice(-6),
    });
  } catch (error) {
    console.warn('In-app escalation failed:', error.message);
  }
}

/**
 * @param {object} message the just-created message object
 * @param {object} io socket.io server (may be undefined)
 */
async function answerSupportChat(message, io) {
  if (process.env.SUPPORT_AGENT_ENABLED !== 'true') return;

  try {
    const supportId = await supportUserId();
    if (!supportId) return;

    const senderId = String(message.senderId?._id || message.senderId);
    // Never answer our own messages.
    if (senderId === supportId) return;

    const chat = await Chat.findById(message.chatId).populate('participants', '_id displayName email');
    if (!chat || chat.type !== 'direct') return;

    const participants = chat.participants || [];
    const hasSupport = participants.some((p) => String(p._id) === supportId);
    if (!hasSupport) return; // not a support conversation

    // The ticket desk conversation is handled by agentResponder.
    const isDeskChat = participants.some((p) => p.email === DESK_EMAIL);
    if (isDeskChat) return;

    const ticketForChat = await SupportTicket.exists({ chatId: chat._id });
    if (ticketForChat) return;

    const info = ai.assistantInfo();
    if (!info.enabled) return;

    const sender = participants.find((p) => String(p._id) === senderId);
    const senderName = sender?.displayName || 'there';
    const history = await historyFor(chat._id, supportId);
    if (history.length === 0) return;

    const raw = await ai.askAssistant({
      system: systemPrompt(senderName),
      messages: history,
      maxTokens: 400,
    });
    const verdict = parseVerdict(raw);

    if (!verdict.confident) {
      await escalateToOwner(senderName, String(message.content || '').slice(0, 500), history);
      return;
    }

    const created = await Message.create({
      chatId: chat._id,
      senderId: supportId,
      type: 'text',
      content: verdict.answer.slice(0, 4000),
      sentAt: new Date(),
      deliveredTo: [senderId],
      readBy: [],
    });

    const populated = await Message.findById(created._id).populate('senderId', '_id displayName avatarUrl');
    const realtime = require('../utils/realtime');
    const emitter = io || realtime.getIo();
    emitter?.to(realtime.roomForChat(chat._id)).emit('message:new', populated);
    realtime.emitToUser(senderId, 'chat:updated', { chatId: chat._id });

    console.log(`Support assistant answered in-app for ${senderName}`);
  } catch (error) {
    console.warn('answerSupportChat failed:', error.message);
  }
}

module.exports = { answerSupportChat, parseVerdict };
