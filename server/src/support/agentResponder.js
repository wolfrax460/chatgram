/**
 * Support-agent responder.
 *
 * When a guest message lands in a ticket conversation, the agent tries to
 * answer it from the knowledge base using the configured model.
 *
 *  - If it is confident, the answer is posted INTO the conversation as the
 *    Chatgram Support account. That path already exists: the reply is mirrored
 *    onto the ticket, pushed to the guest socket and emailed to the user.
 *  - If it is not confident, the ticket stays open and the owner is escalated
 *    on Telegram/email with the transcript.
 *
 * Opt-in via SUPPORT_AGENT_ENABLED=true so an owner can read tickets himself
 * without an assistant answering over him.
 */
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const User = require('../models/User');
const SupportTicket = require('../models/SupportTicket');
const ai = require('./aiProvider');
const notifier = require('./notifier');
const knowledgeBase = require('./knowledge-base.json');

const DESK_EMAIL = 'support-desk@chatgram.local';

function systemPrompt() {
  const kb = knowledgeBase.entries.map((e) => `### ${e.title}\n${e.answer}`).join('\n\n');
  return [
    "You are Chatgram Support, replying to a user inside the app.",
    'Answer ONLY from the knowledge base below.',
    'Reply in the user\'s language (English, Kinyarwanda, French or Swahili).',
    'Never ask for passwords, verification codes or tokens.',
    'Never claim to be a human.',
    '',
    'Output format — follow exactly:',
    'First line: CONFIDENT or ESCALATE',
    'If CONFIDENT: the next lines are your reply to the user, concise and practical.',
    'If ESCALATE: nothing after the first line.',
    '',
    'Use ESCALATE when the question is not covered by the knowledge base, needs an',
    'account action you cannot perform, is a bug report, a billing/refund issue, or',
    'you are unsure for any reason.',
    '',
    'KNOWLEDGE BASE:',
    kb,
  ].join('\n');
}

function parseVerdict(raw) {
  const text = String(raw || '').trim();
  if (!text) return { confident: false, answer: '' };
  const firstLine = text.split('\n')[0].trim().toUpperCase();
  const rest = text.split('\n').slice(1).join('\n').trim();
  if (firstLine.startsWith('ESCALATE')) return { confident: false, answer: '' };
  if (firstLine.startsWith('CONFIDENT')) return { confident: rest.length > 20, answer: rest };
  // Model ignored the format: treat a substantial reply as an answer.
  return { confident: text.length > 40, answer: text };
}

/** Recent turns of the ticket conversation, oldest→newest, as model messages. */
async function conversationFor(chatId) {
  const messages = await Message.find({ chatId, isDeleted: { $ne: true } })
    .sort({ sentAt: -1 })
    .limit(10);
  const chat = await Chat.findById(chatId);
  const desk = await User.findOne({ email: DESK_EMAIL }).select('_id');
  const deskId = desk ? String(desk._id) : '';
  const ordered = messages.reverse();

  return ordered.map((m) => ({
    // The desk account represents the guest.
    role: String(m.senderId) === deskId ? 'user' : 'assistant',
    text: String(m.content || '').slice(0, 1500),
  }));
}

async function escalate(ticket, reason) {
  try {
    await notifier.notifyTicket({
      ...ticket.toObject(),
      summary: `${ticket.summary}\n\n[assistant escalated: ${reason}]`,
    });
  } catch (error) {
    console.warn('Agent escalation notify failed:', error.message);
  }
}

/**
 * @param {string} ticketId
 * @returns {Promise<{replied: boolean, escalated: boolean}>}
 */
async function respondToTicket(ticketId) {
  if (process.env.SUPPORT_AGENT_ENABLED !== 'true') return { replied: false, escalated: false };

  try {
    const ticket = await SupportTicket.findOne({ ticketId });
    if (!ticket || ticket.status === 'closed' || !ticket.chatId) {
      return { replied: false, escalated: false };
    }

    const info = ai.assistantInfo();
    if (!info.enabled) {
      await escalate(ticket, 'AI is disabled');
      return { replied: false, escalated: true };
    }

    const history = await conversationFor(ticket.chatId);
    if (history.length === 0) return { replied: false, escalated: false };

    const raw = await ai.askAssistant({
      system: systemPrompt(),
      // More headroom than the widget: this is a full support reply.
      messages: history,
      maxTokens: 500,
    });

    const verdict = parseVerdict(raw);

    if (!verdict.confident) {
      await escalate(ticket, verdict.answer ? 'not confident' : 'model could not answer');
      return { replied: false, escalated: true };
    }

    // Reply as the Chatgram Support account.
    const supportId = ticket && (await User.findOne({ isSupportAccount: true }).select('_id'));
    if (!supportId) {
      await escalate(ticket, 'no support account');
      return { replied: false, escalated: true };
    }

    const created = await Message.create({
      chatId: ticket.chatId,
      senderId: supportId._id,
      type: 'text',
      content: verdict.answer.slice(0, 4000),
      sentAt: new Date(),
      deliveredTo: [supportId._id],
      readBy: [],
    });

    // Mirror onto the ticket, push to the guest socket and email the user.
    const realtime = require('../utils/realtime');
    await require('./replyHook').propagateSupportReply(created, realtime.getIo());

    // Also surface it in the Support account's open conversations.
    const populated = await Message.findById(created._id).populate('senderId', '_id displayName avatarUrl');
    realtime
      .getIo()
      ?.to(realtime.roomForChat(ticket.chatId))
      .emit('message:new', populated);

    // Let the user know by email too, when they gave one.
    if (ticket.contactType === 'email') {
      notifier
        .notifyTicket({
          ...ticket.toObject(),
          summary: `Auto-reply sent:\n${verdict.answer.slice(0, 800)}`,
        })
        .catch(() => {});
    }

    console.log(`Support agent replied to ticket ${ticketId}`);
    return { replied: true, escalated: false };
  } catch (error) {
    console.warn('Support agent failed:', error.message);
    return { replied: false, escalated: false };
  }
}

module.exports = { respondToTicket, parseVerdict, systemPrompt };
