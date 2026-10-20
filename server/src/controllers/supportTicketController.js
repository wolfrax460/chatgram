// Public support-ticket intake used by the help widget.
// Additive: does not touch auth, chat or existing support routes.
const crypto = require('node:crypto');
const SupportTicket = require('../models/SupportTicket');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const realtime = require('../utils/realtime');
const support = require('../utils/supportAccount');

// The Support account sees every ticket in one conversation with this desk user.
const DESK_EMAIL = 'support-desk@chatgram.local';
const DESK_NAME = 'Support Desk';

const MAX_SUMMARY = 2000;
const MAX_TRANSCRIPT = 40;
const MAX_TEXT = 4000;

// Simple in-memory limits (per-process; good enough for a single API instance).
const hits = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now > entry.reset) {
    hits.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  entry.count += 1;
  if (entry.count > limit) {
    return { ok: false, retryAfter: Math.ceil((entry.reset - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 16);
}

/** The Support user's conversation with the desk account (created once). */
async function deskConversation(supportId) {
  let desk = await User.findOne({ email: DESK_EMAIL });
  if (!desk) {
    const random = crypto.randomBytes(24).toString('hex');
    desk = await User.create({
      displayName: DESK_NAME,
      email: DESK_EMAIL,
      password: random,
      authProvider: 'local',
      about: 'Intake desk for help-widget tickets.',
    });
  }
  let chat = await Chat.findOne({
    type: 'direct',
    participants: { $all: [desk._id, supportId], $size: 2 },
  });
  if (!chat) {
    chat = await Chat.create({ type: 'direct', participants: [desk._id, supportId] });
    realtime.joinUsersToChat(chat._id, [desk._id.toString(), supportId]);
  }
  return chat;
}

async function notifyEmail(ticket, supportEmail) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return;
  const to = process.env.SUPPORT_NOTIFY_EMAIL || supportEmail;
  if (!to) return;
  try {
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user, pass },
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM || user,
      to,
      subject: `[${ticket.ticketId}] ${ticket.summary.slice(0, 60) || 'New support ticket'}`,
      text: [
        `Ticket: ${ticket.ticketId}`,
        `Contact: ${ticket.contact} (${ticket.contactType})`,
        `Page: ${ticket.meta.page}`,
        `Browser: ${ticket.meta.userAgent}`,
        '',
        'Summary:',
        ticket.summary,
        '',
        'Transcript:',
        ...ticket.transcript.map((t) => `${t.role}: ${t.text}`),
      ].join('\n'),
    });
  } catch (error) {
    console.warn('Support ticket email failed:', error.message);
  }
}

// @desc    Create a support ticket from the public help widget
// @route   POST /api/support/tickets
// @access  Public
const createTicket = async (req, res) => {
  try {
    // A request with no JSON body would otherwise throw a 500.
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ message: 'A JSON body is required' });
    }
    const guestId = stripHtml(req.body.guestId).slice(0, 64);
    const contact = stripHtml(req.body.contact).slice(0, 160);
    const summary = stripHtml(req.body.summary).slice(0, MAX_SUMMARY);
    const page = stripHtml(req.body.page).slice(0, 300);
    const userAgent = stripHtml(req.body.userAgent).slice(0, 300);
    const appVersion = stripHtml(req.body.appVersion).slice(0, 40);
    const rawTranscript = Array.isArray(req.body.transcript) ? req.body.transcript : [];

    if (!contact) return res.status(400).json({ message: 'A contact email or phone is required' });
    if (!summary) return res.status(400).json({ message: 'A short description is required' });

    const contactType = contact.includes('@') ? 'email' : 'phone';
    if (contactType === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact)) {
      return res.status(400).json({ message: 'Enter a valid email address' });
    }
    if (contactType === 'phone' && !/^\+?\d{8,15}$/.test(contact.replace(/[\s-]/g, ''))) {
      return res.status(400).json({ message: 'Enter a valid phone number' });
    }

    const ip = req.ip || req.connection?.remoteAddress;

    // Optional captcha (only enforced when TURNSTILE_SECRET is set).
    const captcha = await verifyTurnstile(req.body?.turnstileToken, ip);
    if (!captcha.ok) {
      return res.status(400).json({ message: 'Captcha check failed. Please try again.', code: 'TURNSTILE_FAILED' });
    }

    const perIp = rateLimit(
`ticket:ip:${ip}`, 5, 60 * 60 * 1000);
    if (!perIp.ok) {
      return res.status(429).json({ message: `Too many reports. Try again in ${perIp.retryAfter}s.` });
    }
    if (guestId) {
      const perGuest = rateLimit(`ticket:guest:${guestId}`, 3, 60 * 60 * 1000);
      if (!perGuest.ok) {
        return res.status(429).json({ message: `Too many reports. Try again in ${perGuest.retryAfter}s.` });
      }
    }

    const transcript = rawTranscript
      .slice(-MAX_TRANSCRIPT)
      .map((entry) => ({
        role: entry?.role === 'assistant' ? 'assistant' : 'guest',
        text: stripHtml(entry?.text).slice(0, MAX_TEXT),
      }))
      .filter((entry) => entry.text.length > 0);

    let ticketId = SupportTicket.newTicketId();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await SupportTicket.exists({ ticketId }))) break;
      ticketId = SupportTicket.newTicketId();
    }

    const ticket = await SupportTicket.create({
      ticketId,
      guestId,
      contact,
      contactType,
      summary,
      transcript,
      meta: { page, userAgent, appVersion, ipHash: hashIp(ip) },
    });

    // ---- drop it in the Support account's inbox -------------------------------
    try {
      const supportId = support.supportUserId() || (await support.ensureSupportUser());
      if (supportId) {
        const chat = await deskConversation(supportId);
        const body = [
          `Ticket ${ticket.ticketId}`,
          `Contact: ${contact} (${contactType})`,
          page ? `Page: ${page}` : null,
          userAgent ? `Browser: ${userAgent}` : null,
          '',
          summary,
          ...(transcript.length ? ['', '--- transcript ---', ...transcript.map((t) => `${t.role}: ${t.text}`)] : []),
        ]
          .filter(Boolean)
          .join('\n');

        const message = await Message.create({
          chatId: chat._id,
          senderId: (await User.findOne({ email: DESK_EMAIL }))._id,
          type: 'text',
          content: body,
          sentAt: new Date(),
          deliveredTo: [supportId],
          readBy: [],
        });

        const populated = await Message.findById(message._id).populate('senderId', '_id displayName avatarUrl');
        realtime
          .getIo()
          ?.to(realtime.roomForChat(chat._id))
          .emit('message:new', populated);
        realtime.emitToUser(supportId, 'chat:updated', { chatId: chat._id });

        ticket.chatId = chat._id;
        await ticket.save();
      }
    } catch (error) {
      // A ticketing failure must not lose the ticket itself.
      console.warn('Support desk delivery failed:', error.message);
    }

    // Let the support agent try to answer from the knowledge base. When it is
    // not confident it escalates to the owner instead of guessing.
    try {
      await require('../support/agentResponder').respondToTicket(ticket.ticketId);
    } catch (agentError) {
      console.warn('Support agent kick-off failed:', agentError.message);
    }

    // Fan out to Telegram / email (whichever is configured).
    try {
      await require('../support/notifier').notifyTicket(ticket);
    } catch (notifyError) {
      console.warn('Support notification failed:', notifyError.message);
    }

    const guest = require('../support/guestToken').issueGuestToken({
      ticketId: ticket.ticketId,
      guestId,
    });

    return res.status(201).json({
      ticketId: ticket.ticketId,
      guestToken: guest.token,
      guestTokenExpiresAt: guest.expiresAt,
      status: ticket.status,
      message: "We'll reply by email, or you can check the status with this ticket ID.",
    });
  } catch (error) {
    console.error('Create ticket error:', error.message);
    return res.status(500).json({ message: 'Could not create the ticket. Please try again.' });
  }
};

// @desc    Check a ticket by ID + matching contact
// @route   GET /api/support/tickets/:ticketId?contact=
// @access  Public
const getTicket = async (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress;
    const limited = rateLimit(`status:ip:${ip}`, 30, 60 * 60 * 1000);
    if (!limited.ok) {
      return res.status(429).json({ message: `Too many lookups. Try again in ${limited.retryAfter}s.` });
    }

    const contact = stripHtml(req.query.contact).slice(0, 160);
    if (!contact) return res.status(400).json({ message: 'Contact is required' });

    const ticket = await SupportTicket.findOne({ ticketId: req.params.ticketId, contact });
    // Same response whether the ticket is missing or the contact does not match.
    if (!ticket) return res.status(404).json({ message: 'No ticket found for that ID and contact.' });

    return res.json({
      ticketId: ticket.ticketId,
      status: ticket.status,
      createdAt: ticket.createdAt,
      summary: ticket.summary,
      replies: ticket.replies.map((r) => ({ text: r.text, at: r.at })),
    });
  } catch (error) {
    console.error('Get ticket error:', error.message);
    return res.status(500).json({ message: 'Could not load the ticket.' });
  }
};

/** Cloudflare Turnstile check — skipped entirely when no secret is configured. */
async function verifyTurnstile(token, ip) {
  const secret = (process.env.TURNSTILE_SECRET || '').trim();
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, reason: 'missing-token' };
  try {
    const params = new URLSearchParams();
    params.set('secret', secret);
    params.set('response', String(token));
    if (ip) params.set('remoteip', String(ip));
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: params,
    });
    const data = await response.json();
    return { ok: data?.success === true, skipped: false };
  } catch (error) {
    console.warn('Turnstile verify failed:', error.message);
    // Fail open: a captcha outage must not block support reports.
    return { ok: true, skipped: true };
  }
}

// @desc    Delete my ticket (ID + matching contact)
// @route   DELETE /api/support/tickets/:ticketId?contact=
// @access  Public
const deleteTicket = async (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress;
    const limited = rateLimit(`delete:ip:${ip}`, 10, 60 * 60 * 1000);
    if (!limited.ok) {
      return res.status(429).json({ message: `Too many requests. Try again in ${limited.retryAfter}s.` });
    }
    const contact = stripHtml(req.query.contact).slice(0, 160);
    if (!contact) return res.status(400).json({ message: 'Contact is required' });

    const ticket = await SupportTicket.findOne({ ticketId: req.params.ticketId, contact });
    if (!ticket) return res.status(404).json({ message: 'No ticket found for that ID and contact.' });

    await SupportTicket.deleteOne({ _id: ticket._id });
    return res.json({ message: 'Ticket deleted.', ticketId: ticket.ticketId });
  } catch (error) {
    console.error('Delete ticket error:', error.message);
    return res.status(500).json({ message: 'Could not delete the ticket.' });
  }
};

// @desc    Ticket attached to a chat (used for the admin badge)
// @route   GET /api/support/tickets/by-chat/:chatId
// @access  Private (Support account)
const getTicketByChat = async (req, res) => {
  try {
    const ticket = await SupportTicket.findOne({ chatId: req.params.chatId });
    if (!ticket) return res.json({ ticket: null });
    return res.json({
      ticket: {
        ticketId: ticket.ticketId,
        status: ticket.status,
        contact: ticket.contact,
        contactType: ticket.contactType,
        createdAt: ticket.createdAt,
        replies: ticket.replies.map((r) => ({ text: r.text, at: r.at })),
      },
    });
  } catch (error) {
    console.error('Ticket by chat error:', error.message);
    return res.status(500).json({ message: 'Could not load the ticket.' });
  }
};

// @desc    Close a ticket
// @route   POST /api/support/tickets/:ticketId/close
// @access  Private (Support account)
const closeTicket = async (req, res) => {
  try {
    const ticket = await SupportTicket.findOne({ ticketId: req.params.ticketId });
    if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });
    ticket.status = 'closed';
    await ticket.save();
    require('../sockets/supportGuestSocket').emitToTicket(
      require('../utils/realtime').getIo(),
      ticket.ticketId,
      'ticket:closed',
      { ticketId: ticket.ticketId, status: 'closed' }
    );
    return res.json({ message: 'Ticket closed.', ticketId: ticket.ticketId, status: ticket.status });
  } catch (error) {
    console.error('Close ticket error:', error.message);
    return res.status(500).json({ message: 'Could not close the ticket.' });
  }
};

module.exports = { createTicket, getTicket, deleteTicket, getTicketByChat, closeTicket, verifyTurnstile, stripHtml, rateLimit };