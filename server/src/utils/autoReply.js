/**
 * Away / auto-reply sender.
 *
 * Rules (see GET/PUT /api/users/me/auto-reply):
 *  - opt-in per user (default off), message required when enabled;
 *  - direct chats only — never groups, never the AI/bot/support accounts;
 *  - audience contacts|everyone; a blocked pair never gets one;
 *  - schedule always | outsideHours (the "between start and end" window,
 *    overnight windows such as 18:00–08:00 wrap);
 *  - at most one auto-reply per sender per 24 h and 30 per recipient per day;
 *  - the reply message carries `autoReply: true`, and an auto-reply message
 *    never triggers another auto-reply (no loops).
 *
 * Failures are swallowed: an auto-reply must never break the original send.
 */
const User = require('../models/User');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const AutoReplyLog = require('../models/AutoReplyLog');
const { blockedBetween, idOf } = require('./blocks');

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PER_RECIPIENT_PER_DAY = 30;

function minutesOf(value) {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Is |now| inside the configured window? `always` is always inside.
 * `outsideHours` uses the UI's "Between <start> and <end>" window and handles
 * overnight windows (start > end) by wrapping over midnight.
 */
function inSchedule(schedule, now = new Date()) {
  const mode = schedule?.mode === 'outsideHours' ? 'outsideHours' : 'always';
  if (mode === 'always') return true;
  const start = minutesOf(schedule?.start);
  const end = minutesOf(schedule?.end);
  if (start === null || end === null) return true;
  const current = now.getHours() * 60 + now.getMinutes();
  if (start === end) return true;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end; // overnight window
}

function audienceMatches(recipient, sender, audience) {
  if (audience === 'everyone') return true;
  return (recipient.contacts || []).some((id) => String(idOf(id)) === String(sender._id));
}

/** Pure(ish) eligibility check; exported for tests. */
async function canAutoReply({ recipient, sender, chat, now = new Date() }) {
  if (!recipient || !sender || !chat) return false;
  const settings = recipient.autoReply || {};
  if (settings.enabled !== true) return false;
  const text = String(settings.message || '').trim();
  if (!text) return false;
  if (String(recipient._id) === String(sender._id)) return false;
  if (chat.type !== 'direct') return false;
  if (!Array.isArray(chat.participants) || chat.participants.length !== 2) return false;
  // Never auto-reply to (or from) the AI, bot or support accounts.
  for (const account of [recipient, sender]) {
    if (account.isAiAccount === true || account.isSupportAccount === true) return false;
  }
  if (!inSchedule(settings.schedule, now)) return false;
  const audience = settings.audience === 'everyone' ? 'everyone' : 'contacts';
  if (!audienceMatches(recipient, sender, audience)) return false;
  if (await blockedBetween(recipient._id, sender._id)) return false;
  const since = new Date(now.getTime() - DAY_MS);
  const recentToSender = await AutoReplyLog.findOne({
    recipientId: recipient._id,
    senderId: sender._id,
    at: { $gte: since },
  }).lean();
  if (recentToSender) return false;
  const recentTotal = await AutoReplyLog.countDocuments({ recipientId: recipient._id, at: { $gte: since } });
  if (recentTotal >= MAX_PER_RECIPIENT_PER_DAY) return false;
  return true;
}

/**
 * Send the auto-reply for one inbound message, if every rule allows it.
 * Never throws and never delays the caller's response (callers may await it).
 * @returns {Promise<object|null>} the created reply message, or null
 */
async function maybeSendAutoReply({ chat, message, io = null }) {
  try {
    if (!chat || !message) return null;
    // An auto-reply message never triggers another one.
    if (message.autoReply === true) return null;
    if (message.type !== 'text') return null;
    if (chat.type !== 'direct') return null;
    const senderId = idOf(message.senderId);
    if (!senderId) return null;
    const recipientId = (chat.participants || [])
      .map((id) => String(idOf(id)))
      .find((id) => id && id !== String(senderId));
    if (!recipientId) return null;
    const [recipient, sender] = await Promise.all([
      User.findById(recipientId).select('autoReply contacts isAiAccount isSupportAccount'),
      User.findById(senderId).select('isAiAccount isSupportAccount displayName'),
    ]);
    if (!recipient || !sender) return null;
    if (!(await canAutoReply({ recipient, sender, chat }))) return null;

    const reply = await Message.create({
      chatId: chat._id,
      senderId: recipient._id,
      type: 'text',
      content: String(recipient.autoReply.message || '').trim().slice(0, 500),
      sentAt: new Date(),
      deliveredTo: [recipient._id],
      readBy: [recipient._id],
      autoReply: true,
    });
    await Chat.findByIdAndUpdate(chat._id, { lastMessage: reply._id, updatedAt: new Date() });
    await AutoReplyLog.create({
      recipientId: recipient._id,
      senderId: sender._id,
      chatId: chat._id,
      messageId: reply._id,
      at: new Date(),
    });

    try {
      const populated = await Message.findById(reply._id).populate('senderId', '_id displayName avatarUrl');
      const payload = { ...populated.toObject(), autoReply: true };
      const realtime = require('./realtime');
      const socket = io || realtime.getIo();
      if (socket) socket.to(realtime.roomForChat(chat._id)).emit('message:new', payload);
      // The recipient's own devices also need the reply they just "sent".
      realtime.emitToUser?.(recipient._id, 'message:new', payload);
      void require('../services/pushSender')
        .pushChatMessage({ chat, sender: populated.senderId, message: populated })
        .catch(() => {});
    } catch {
      /* realtime/push are best effort */
    }
    return reply;
  } catch (error) {
    console.warn('Auto-reply skipped:', String(error?.message || error).slice(0, 140));
    return null;
  }
}

module.exports = {
  inSchedule,
  canAutoReply,
  maybeSendAutoReply,
  MAX_PER_RECIPIENT_PER_DAY,
};
