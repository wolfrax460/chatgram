/**
 * Support-reply propagation.
 *
 * When the Chatgram Support account replies inside the "Support Desk"
 * conversation, mirror that reply onto the matching ticket so the anonymous
 * guest sees it live (via /support-guest) and, if enabled, gets a notification.
 *
 * Additive: called after a message is created; it never throws into the caller.
 */
const SupportTicket = require('../models/SupportTicket');
const Chat = require('../models/Chat');

const DESK_EMAIL = 'support-desk@chatgram.local';

/**
 * @param {object} message  the created message (populated or raw)
 * @param {object} io       socket.io server instance
 */
async function propagateSupportReply(message, io) {
  try {
    if (!message) return;
    const ChatModel = Chat;

    // Only messages in a support-desk conversation matter.
    const chat = await ChatModel.findById(message.chatId);
    if (!chat || chat.type !== 'direct') return;

    const ticket = await SupportTicket.findOne({
      chatId: chat._id,
      status: { $ne: 'closed' },
    });
    if (!ticket) return;

    // The desk account is the "system" side; the other participant is Support.
    // A reply is anything NOT sent by the desk account.
    const senderId = String(message.senderId?._id || message.senderId);
    const desk = await require('../models/User').findOne({ email: DESK_EMAIL }).select('_id');
    if (!desk) return;
    if (senderId === String(desk._id)) return;

    const text = String(message.content || '').trim();
    if (!text) return;

    // Prefix the ref so the owner can reply with /reply CG-XXXXX from Telegram.
    const showRef = process.env.SUPPORT_SHOW_TICKET_REF !== 'false';
    const withRef = showRef ? `[${ticket.ticketId}] ${text}` : text;

    ticket.replies.push({ text: withRef.slice(0, 4000), at: new Date() });
    ticket.status = 'answered';
    ticket.lastReplyAt = new Date();
    await ticket.save();

    // Live push to the guest who owns this ticket.
    const { emitToTicket } = require('../sockets/supportGuestSocket');
    emitToTicket(io, ticket.ticketId, 'ticket:reply', {
      ref: ticket.ticketId,
      ticketId: ticket.ticketId,
      status: ticket.status,
      replies: ticket.replies.map((r) => ({ text: r.text, at: r.at })),
    });

    // Owner ping (Telegram/WhatsApp) — optional, never blocks.
    require('../support/notifier')
      .notifySupportReply(ticket, text)
      .catch(() => {});

    // Mirror the human reply into the help-widget conversation that escalated
    // this ticket (if any), so the widget sees a live agent reply.
    require('../help/replyBridge')
      .deliverAgentReply(ticket.ticketId, text, message.senderId)
      .catch(() => {});

    console.log(`Support reply propagated to ticket ${ticket.ticketId}`);
  } catch (error) {
    console.warn('propagateSupportReply failed:', error.message);
  }
}

module.exports = { propagateSupportReply };
