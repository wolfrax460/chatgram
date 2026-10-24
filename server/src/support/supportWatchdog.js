/**
 * Support reply watchdog (9e trigger e).
 *
 * A user writes to the Chatgram Support conversation. Normally the support
 * assistant answers within seconds (server/src/support/supportAgentReply.js). If
 * nothing is posted back within SUPPORT_REPLY_TIMEOUT_MS (60 s by default) — the
 * provider is down, the assistant is disabled, or the reply path failed — an
 * AdminInbox record of type `support_timeout` is created so the dashboard can
 * escalate it. The user's message itself never leaks anywhere new.
 *
 * One record per user message (dedupe key `support:<messageId>`).
 */
const Message = require('../models/Message');
const support = require('../utils/supportAccount');

const DEFAULT_TIMEOUT_MS = 60_000;

function timeoutMs() {
  const value = Number(process.env.SUPPORT_REPLY_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

/** True when this message went from a normal user into their Support thread. */
async function isSupportThreadMessage(chat, message) {
  if (!chat || chat.type !== 'direct') return false;
  const supportId = support.supportUserId() || (await support.ensureSupportUser());
  if (!supportId) return false;
  if (String(message?.senderId?._id || message?.senderId) === String(supportId)) return false;
  return (chat.participants || []).some((participant) => String(participant?._id || participant) === String(supportId));
}

/**
 * Schedule the 60-second check. Returns the timer so tests can clear it.
 */
function watchSupportMessage(chat, message) {
  if (!chat || !message) return null;
  let timer = null;
  const check = async () => {
    try {
      const supportId = support.supportUserId() || (await support.ensureSupportUser());
      if (!supportId) return;
      if (!(await isSupportThreadMessage(chat, message))) return;
      const sentAt = message.sentAt ? new Date(message.sentAt) : new Date();
      const reply = await Message.findOne({
        chatId: chat._id,
        senderId: supportId,
        sentAt: { $gt: sentAt },
        isDeleted: { $ne: true },
      }).select('_id');
      if (reply) return;
      const { AdminInbox } = require('../ai/chatgram');
      const normalized = `support:${String(message._id || message.id)}`;
      const existing = await AdminInbox.findOne({ normalized });
      if (existing) return;
      const text = String(message.content || '').slice(0, 400);
      await AdminInbox.create({
        type: 'support_timeout',
        question: text,
        normalized,
        askerHash: '',
        askerId: message.senderId?._id || message.senderId || null,
        providerKey: null,
        redactedContext: `No support reply within ${Math.round(timeoutMs() / 1000)} s.`,
      });
    } catch (error) {
      console.warn('Support watchdog failed:', String(error?.message || error).slice(0, 160));
    }
  };
  timer = setTimeout(check, timeoutMs());
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

module.exports = { watchSupportMessage, isSupportThreadMessage, timeoutMs, DEFAULT_TIMEOUT_MS };
