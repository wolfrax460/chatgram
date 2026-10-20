/**
 * Two-way Telegram bot for Chatgram Support.
 *
 * Inbound webhook so the owner can answer tickets from his phone:
 *
 *   /start              connect + show your chat id
 *   /help               command list
 *   /tickets            open tickets
 *   /reply CG-XXXXX ...  post the rest as a Support reply (goes to the user)
 *   /close CG-XXXXX      close the ticket
 *
 * Security: the webhook path carries a secret (TELEGRAM_WEBHOOK_SECRET) and the
 * chat id must match TELEGRAM_CHAT_ID, so only the owner can drive it.
 */
const SupportTicket = require('../models/SupportTicket');
const Message = require('../models/Message');
const User = require('../models/User');
const Chat = require('../models/Chat');
const notifier = require('./notifier');

const HELP = [
  'Chatgram Support commands:',
  '',
  '/tickets — open tickets',
  '/reply CG-XXXXX your message — answer the user',
  '/close CG-XXXXX — close a ticket',
  '/help — this list',
].join('\n');

function chatId() {
  return String(process.env.TELEGRAM_CHAT_ID || '').trim();
}

async function send(text) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const to = chatId();
  if (!token || !to) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: to, text: String(text).slice(0, 4000), disable_web_page_preview: true }),
    });
  } catch (error) {
    console.warn('Telegram send failed:', error.message);
  }
}

async function supportUserId() {
  const user = await User.findOne({ isSupportAccount: true }).select('_id');
  return user ? user._id : null;
}

/** Post a reply into the ticket's conversation as the Support account. */
async function replyToTicket(ticket, text) {
  if (!ticket.chatId) return { ok: false, message: 'That ticket has no conversation attached.' };

  const supportId = await supportUserId();
  if (!supportId) return { ok: false, message: 'No support account found.' };

  const created = await Message.create({
    chatId: ticket.chatId,
    senderId: supportId,
    type: 'text',
    content: String(text).slice(0, 4000),
    sentAt: new Date(),
    deliveredTo: [],
    readBy: [],
  });

  const populated = await Message.findById(created._id).populate('senderId', '_id displayName avatarUrl');
  const realtime = require('../utils/realtime');
  realtime.getIo()?.to(realtime.roomForChat(ticket.chatId)).emit('message:new', populated);

  // Mirrors onto the ticket + pushes to the guest socket + emails the user.
  await require('./replyHook').propagateSupportReply(created, realtime.getIo());

  return { ok: true, message: `Sent on ${ticket.ticketId}.` };
}

async function closeTicket(ticket) {
  ticket.status = 'closed';
  await ticket.save();
  require('../sockets/supportGuestSocket').emitToTicket(
    require('../utils/realtime').getIo(),
    ticket.ticketId,
    'ticket:closed',
    { ticketId: ticket.ticketId, status: 'closed' }
  );
  return `Closed ${ticket.ticketId}.`;
}

async function handleCommand(text) {
  const trimmed = String(text || '').trim();
  const [rawCmd, ...rest] = trimmed.split(/\s+/);
  const cmd = rawCmd.toLowerCase().replace(/@\w+$/, ''); // strip @BotName suffix
  const args = rest.join(' ').trim();

  if (cmd === '/start' || cmd === '/help') {
    return `Connected. Your chat id is ${chatId()}.\n\n${HELP}`;
  }

  if (cmd === '/tickets') {
    const open = await SupportTicket.find({ status: { $ne: 'closed' } })
      .sort({ createdAt: -1 })
      .limit(10);
    if (open.length === 0) return 'No open tickets.';
    return open
      .map((t) => `${t.ticketId} [${t.status}] ${String(t.summary || '').slice(0, 70)}`)
      .join('\n');
  }

  if (cmd === '/reply') {
    const [ticketId, ...bodyParts] = args.split(/\s+/);
    const body = bodyParts.join(' ').trim();
    if (!ticketId || !body) return 'Usage: /reply CG-XXXXX your message';
    const ticket = await SupportTicket.findOne({ ticketId: ticketId.toUpperCase() });
    if (!ticket) return `No ticket ${ticketId}.`;
    const result = await replyToTicket(ticket, body);
    return result.message;
  }

  if (cmd === '/close') {
    const ticketId = args.split(/\s+/)[0];
    if (!ticketId) return 'Usage: /close CG-XXXXX';
    const ticket = await SupportTicket.findOne({ ticketId: ticketId.toUpperCase() });
    if (!ticket) return `No ticket ${ticketId}.`;
    return closeTicket(ticket);
  }

  // Bare CG-XXXXX reply shorthand: "CG-XXXXX some text"
  if (/^cg-[a-z0-9]{5}$/i.test(cmd)) {
    const ticket = await SupportTicket.findOne({ ticketId: cmd.toUpperCase() });
    if (!ticket) return `No ticket ${cmd}.`;
    if (!args) return `Usage: ${cmd} your message`;
    const result = await replyToTicket(ticket, args);
    return result.message;
  }

  return `I did not understand "${rawCmd}".\n\n${HELP}`;
}

/**
 * Express handler for the Telegram webhook.
 * POST /api/support/telegram/:secret
 */
async function webhookHandler(req, res) {
  const expected = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  if (expected && req.params.secret !== expected) {
    return res.status(403).json({ ok: false });
  }

  // Always answer 200 quickly; Telegram retries on non-2xx.
  res.status(200).json({ ok: true });

  try {
    const update = req.body || {};
    const message = update.message || update.edited_message;
    if (!message || !message.text) return;

    // Only the configured owner may drive the bot.
    if (String(message.chat?.id) !== chatId()) {
      await send('This bot is private.');
      return;
    }

    const reply = await handleCommand(message.text);
    if (reply) await send(reply);
  } catch (error) {
    console.warn('Telegram webhook error:', error.message);
    notifier.channelStatus();
  }
}

module.exports = { webhookHandler, handleCommand, send, HELP };
