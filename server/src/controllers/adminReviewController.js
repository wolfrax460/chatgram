/**
 * 9d administration oversight: time-boxed, reasoned, audited read-only review of
 * a user's conversations.
 *
 * Guard rails implemented here:
 *  - a written reason (minimum 10 characters) is required before any content;
 *  - the review session belongs to the admin panel session that started it,
 *    expires after 15 minutes of inactivity and can be ended manually;
 *  - every content read writes an append-only AdminAudit row ("who viewed what");
 *  - content is served read-only: these endpoints only ever GET, and no admin
 *    route can send, edit or delete messages as a user;
 *  - reviews are rate-limited per admin session; a burst raises an admin Inbox
 *    alert and is audited;
 *  - review logs have a retention window (REVIEW_LOG_RETENTION_DAYS, default
 *    730 days = 2 years).
 */
const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const ReviewSession = require('../models/ReviewSession');
const AdminAudit = require('../models/AdminAudit');
const admin = require('../admin/auth');
const chatgramAi = require('../ai/chatgram');

const { AdminInbox } = chatgramAi;

const IDLE_MS = 15 * 60 * 1000;
const MIN_REASON = 10;
const MAX_REASON = 500;
const MAX_PAGE = 100;
const RATE_LIMIT_PER_HOUR = 20;
const BURST_THRESHOLD = 10;
const BURST_WINDOW_MS = 15 * 60 * 1000;
const ACTIVE_USER_FIELDS = 'displayName username email phone avatarUrl status lastSeen createdAt';

function retentionDays() {
  const value = Number(process.env.REVIEW_LOG_RETENTION_DAYS);
  return Number.isFinite(value) && value > 30 ? Math.round(value) : 730;
}

function clampLimit(value, fallback = 50) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_PAGE, Math.max(1, Math.round(parsed)));
}

function secondsLeft(session) {
  return Math.max(0, Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / 1000));
}

function publicReview(session) {
  return {
    id: String(session._id),
    userId: session.userId ? String(session.userId) : null,
    reason: session.reason,
    reference: session.reference || '',
    scope: session.scope,
    status: session.status,
    createdAt: session.createdAt,
    endedAt: session.endedAt,
    expiresAt: session.expiresAt,
    secondsLeft: secondsLeft(session),
    views: session.views || 0,
  };
}

function toObjectId(value) {
  try {
    return require('mongoose').Types.ObjectId.createFromHexString(String(value || ''));
  } catch {
    return null;
  }
}

/** Load an active review owned by the current admin panel session. */
async function loadActive(req, res) {
  const id = toObjectId(req.params.id);
  if (!id) {
    res.status(400).json({ message: 'Invalid review session id.' });
    return null;
  }
  const session = await ReviewSession.findById(id);
  if (!session || String(session.adminSessionId) !== String(req.adminSession?._id || '')) {
    res.status(404).json({ message: 'Review session not found.' });
    return null;
  }
  if (session.status !== 'active') {
    res.status(410).json({ message: 'This review session has ended.', code: 'REVIEW_ENDED' });
    return null;
  }
  const idleFor = Date.now() - new Date(session.lastActivityAt).getTime();
  if (idleFor > IDLE_MS) {
    session.status = 'expired';
    session.endedAt = new Date();
    await session.save();
    await admin.audit('review_expired', req, `review=${session._id} user=${session.userId}`);
    res.status(410).json({ message: 'This review session expired after 15 minutes of inactivity.', code: 'REVIEW_EXPIRED' });
    return null;
  }
  session.lastActivityAt = new Date();
  session.expiresAt = new Date(Date.now() + IDLE_MS);
  await session.save();
  return session;
}

/** POST /reviews â€” write a reason and start a 15-minute read-only review. */
async function start(req, res) {
  try {
    const reason = String(req.body?.reason || '').trim();
    const reference = String(req.body?.reference || '').trim();
    const scope = req.body?.scope === 'search' ? 'search' : 'conversations';
    const userId = toObjectId(req.body?.userId);
    if (scope === 'conversations' && !userId) return res.status(400).json({ message: 'A user is required.' });
    if (reason.length < MIN_REASON) {
      return res.status(422).json({
        message: `Write a reason of at least ${MIN_REASON} characters before opening conversations.`,
        code: 'REVIEW_REASON_REQUIRED',
      });
    }
    if (reason.length > MAX_REASON) {
      return res.status(422).json({ message: `The reason must be under ${MAX_REASON} characters.` });
    }
    if (reference.length > 120) return res.status(422).json({ message: 'The reference is too long.' });

    const user = userId ? await User.findById(userId).select(ACTIVE_USER_FIELDS).lean() : null;
    if (scope === 'conversations' && !user) return res.status(404).json({ message: 'User not found.' });

    // Rate limit: reviews started by this admin panel session in the last hour.
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await ReviewSession.countDocuments({
      adminSessionId: req.adminSession._id,
      createdAt: { $gte: hourAgo },
    });
    if (recent >= RATE_LIMIT_PER_HOUR) {
      await admin.audit('review_rate_limited', req, `user=${userId} count=${recent}`);
      return res.status(429).json({
        message: `Too many reviews: ${RATE_LIMIT_PER_HOUR} per hour. Wait before opening more conversations.`,
        code: 'REVIEW_RATE_LIMITED',
      });
    }

    // Reuse an already-active review of the same scope/user from this admin session.
    const existing = await ReviewSession.findOne({
      adminSessionId: req.adminSession._id,
      userId: userId || null,
      scope,
      status: 'active',
      lastActivityAt: { $gte: new Date(Date.now() - IDLE_MS) },
    });
    if (existing) {
      existing.lastActivityAt = new Date();
      existing.expiresAt = new Date(Date.now() + IDLE_MS);
      await existing.save();
      return res.json({ review: publicReview(existing), reused: true });
    }

    const session = await ReviewSession.create({
      adminSessionId: req.adminSession._id,
      userId: userId || null,
      reason,
      reference,
      scope,
      ip: req.ip || '',
      userAgent: String(req.headers?.['user-agent'] || '').slice(0, 300),
      expiresAt: new Date(Date.now() + IDLE_MS),
    });

    await admin.audit(
      'review_start',
      req,
      `review=${session._id} scope=${scope} user=${userId || '-'}${reference ? ` ref=${reference}` : ''} reason="${reason.slice(0, 160)}"`,
    );

    // Burst alert: many reviews in a short window raises an admin Inbox record.
    const burstCount = await ReviewSession.countDocuments({
      adminSessionId: req.adminSession._id,
      createdAt: { $gte: new Date(Date.now() - BURST_WINDOW_MS) },
    });
    if (burstCount >= BURST_THRESHOLD) {
      const alreadyAlerted = await AdminInbox.findOne({
        type: 'review_burst',
        status: { $in: ['new', 'answered'] },
        createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) },
      });
      if (!alreadyAlerted) {
        await AdminInbox.create({
          type: 'review_burst',
          question: `High review activity: ${burstCount} security reviews in the last 15 minutes. Check the review log.`,
          status: 'new',
        });
        await admin.audit('review_burst', req, `count=${burstCount}`);
      }
    }

    return res.status(201).json({ review: publicReview(session), user });
  } catch (error) {
    console.error('Start review failed:', error.message);
    return res.status(500).json({ message: 'Could not start the review session.' });
  }
}

/** GET /reviews/:id â€” poll the remaining time of an active review. */
async function current(req, res) {
  const session = await loadActive(req, res);
  if (!session) return;
  return res.json({ review: publicReview(session) });
}

/** POST /reviews/:id/end â€” end the review immediately. */
async function end(req, res) {
  const id = toObjectId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Invalid review session id.' });
  const session = await ReviewSession.findById(id);
  if (!session || String(session.adminSessionId) !== String(req.adminSession?._id || '')) {
    return res.status(404).json({ message: 'Review session not found.' });
  }
  if (session.status === 'active') {
    session.status = 'ended';
    session.endedAt = new Date();
    await session.save();
    await admin.audit('review_end', req, `review=${session._id} user=${session.userId}`);
  }
  return res.json({ review: publicReview(session) });
}

/** GET /reviews/:id/conversations â€” read-only list of the user's chats. */
async function conversations(req, res) {
  const session = await loadActive(req, res);
  if (!session) return;
  if (session.scope !== 'conversations') {
    return res.status(409).json({
      message: "Start a conversation review (with a reason) before opening a user's chats.",
      code: 'REVIEW_SCOPE_REQUIRED',
    });
  }
  try {
    const chats = await Chat.find({ participants: session.userId })
      .sort({ updatedAt: -1 })
      .limit(50)
      .populate('participants', 'displayName username avatarUrl')
      .lean();
    await admin.audit(
      'review_conversations',
      req,
      `review=${session._id} user=${session.userId} chats=${chats.length}`,
    );
    return res.json({
      review: publicReview(session),
      conversations: chats.map((chat) => ({
        id: String(chat._id),
        type: chat.type,
        title:
          chat.type === 'group'
            ? chat.groupName || 'Group'
            : (chat.participants || [])
                .filter((participant) => String(participant._id) !== String(session.userId))
                .map((participant) => participant.displayName || participant.username || 'Chatgram user')
                .join(', ') || 'Direct chat',
        participants: (chat.participants || []).map((participant) => ({
          id: String(participant._id),
          displayName: participant.displayName || participant.username || 'Chatgram user',
          avatarUrl: participant.avatarUrl || '',
        })),
        lastMessageAt: chat.lastMessageAt || chat.updatedAt,
        lastMessage: chat.lastMessage || '',
        frozen: Boolean(chat.groupFrozen),
      })),
    });
  } catch (error) {
    console.error('Review conversations failed:', error.message);
    return res.status(500).json({ message: 'Could not load conversations.' });
  }
}

/** GET /reviews/:id/messages?chatId=&page= â€” read-only, paginated, audited. */
async function messages(req, res) {
  const session = await loadActive(req, res);
  if (!session) return;
  if (session.scope !== 'conversations') {
    return res.status(409).json({
      message: "Start a conversation review (with a reason) before opening a user's messages.",
      code: 'REVIEW_SCOPE_REQUIRED',
    });
  }
  try {
    const chatId = toObjectId(req.query?.chatId);
    if (!chatId) return res.status(400).json({ message: 'A conversation is required.' });
    const chat = await Chat.findOne({ _id: chatId, participants: session.userId })
      .populate('participants', 'displayName username avatarUrl')
      .lean();
    if (!chat) return res.status(404).json({ message: 'Conversation not found for this user.' });

    const page = Math.max(0, Math.floor(Number(req.query?.page) || 0));
    const limit = clampLimit(req.query?.limit, 50);
    const rows = await Message.find({ chatId })
      .sort({ sentAt: -1, _id: -1 })
      .skip(page * limit)
      .limit(limit)
      .populate('senderId', 'displayName username avatarUrl')
      .lean();

    session.views = (session.views || 0) + 1;
    await session.save();
    await admin.audit(
      'review_view',
      req,
      `review=${session._id} user=${session.userId} chat=${chatId} page=${page} rows=${rows.length}`,
    );

    const names = new Map(
      (chat.participants || []).map((participant) => [
        String(participant._id),
        participant.displayName || participant.username || 'Chatgram user',
      ]),
    );
    return res.json({
      review: publicReview(session),
      conversation: {
        id: String(chat._id),
        type: chat.type,
        title: names.get(String(session.userId)) ? (chat.type === 'group' ? chat.groupName || 'Group' : 'Direct chat') : 'Chat',
      },
      messages: rows
        .map((message) => ({
          id: String(message._id),
          senderId: String(message.senderId?._id || message.senderId || ''),
          senderName:
            names.get(String(message.senderId?._id || message.senderId || '')) ||
            message.senderId?.displayName ||
            message.senderId?.username ||
            'Chatgram user',
          type: message.type,
          content: message.content || '',
          mediaUrl: message.mediaUrl || '',
          sentAt: message.sentAt,
          editedAt: message.editedAt,
          isDeleted: Boolean(message.isDeleted),
          readCount: (message.readBy || []).length,
        }))
        .reverse(),
      page,
      limit,
      hasMore: rows.length === limit,
    });
  } catch (error) {
    console.error('Review messages failed:', error.message);
    return res.status(500).json({ message: 'Could not load messages.' });
  }
}

/** GET /reviews â€” "Who viewed what" list, paginated, with optional CSV export. */
async function list(req, res) {
  try {
    await ReviewSession.deleteMany({ createdAt: { $lt: new Date(Date.now() - retentionDays() * 24 * 60 * 60 * 1000) } });
    await admin.audit('review_log_view', req, `page=${req.query?.page || 0} export=${req.query?.format || 'json'}`);

    const page = Math.max(0, Math.floor(Number(req.query?.page) || 0));
    const limit = clampLimit(req.query?.limit, 25);
    const filter = {};
    if (req.query?.userId && toObjectId(req.query.userId)) filter.userId = toObjectId(req.query.userId);
    if (req.query?.status && ['active', 'ended', 'expired'].includes(String(req.query.status))) {
      filter.status = String(req.query.status);
    }
    if (req.query?.since) {
      const since = new Date(String(req.query.since));
      if (!Number.isNaN(since.getTime())) filter.createdAt = { $gte: since };
    }

    const [rows, total] = await Promise.all([
      ReviewSession.find(filter)
        .sort({ createdAt: -1 })
        .skip(page * limit)
        .limit(limit)
        .populate('userId', 'displayName username email avatarUrl')
        .lean(),
      ReviewSession.countDocuments(filter),
    ]);

    if (String(req.query?.format || '') === 'csv') {
      const header = 'started,admin_session,user,reason,reference,status,views,ip,ended\n';
      const csv = rows
        .map((row) =>
          [
            row.createdAt?.toISOString?.() || '',
            String(row.adminSessionId || ''),
            String(row.userId?._id || row.userId || ''),
            `"${String(row.reason || '').replace(/"/g, '""')}"`,
            `"${String(row.reference || '').replace(/"/g, '""')}"`,
            row.status,
            row.views || 0,
            row.ip || '',
            row.endedAt?.toISOString?.() || '',
          ].join(','),
        )
        .join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="chatgram-review-log.csv"');
      return res.send(header + csv);
    }

    return res.json({
      reviews: rows.map((row) => ({
        ...publicReview(row),
        user: row.userId
          ? {
              id: String(row.userId._id),
              displayName: row.userId.displayName || row.userId.username || 'Chatgram user',
              email: row.userId.email || '',
              avatarUrl: row.userId.avatarUrl || '',
            }
          : null,
      })),
      page,
      limit,
      total,
      retentionDays: retentionDays(),
    });
  } catch (error) {
    console.error('Review log failed:', error.message);
    return res.status(500).json({ message: 'Could not load the review log.' });
  }
}

/** GET /reviews/stats â€” counters for the dashboard attention panel. */
async function stats(req, res) {
  try {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [lastHour, lastDay, active] = await Promise.all([
      ReviewSession.countDocuments({ createdAt: { $gte: hourAgo } }),
      ReviewSession.countDocuments({ createdAt: { $gte: dayAgo } }),
      ReviewSession.countDocuments({ status: 'active', lastActivityAt: { $gte: new Date(Date.now() - IDLE_MS) } }),
    ]);
    return res.json({
      lastHour,
      lastDay,
      active,
      burstThreshold: BURST_THRESHOLD,
      rateLimitPerHour: RATE_LIMIT_PER_HOUR,
      retentionDays: retentionDays(),
      burst: lastHour >= BURST_THRESHOLD,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Could not load review statistics.' });
  }
}

const MAX_SEARCH_ROWS = 500;
const MAX_KEYWORD = 80;
const SEARCH_LIMIT_PER_HOUR = 120;

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * GET /reviews/:id/search â€” global message search for abuse hunting. Only a
 * review session started with scope=search may use it, so it inherits the
 * written reason, the 15-minute expiry, the rate limits and the audit trail.
 */
async function search(req, res) {
  const session = await loadActive(req, res);
  if (!session) return;
  if (session.scope !== 'search') {
    return res.status(409).json({
      message: 'Start a message-search review (with a reason) before searching messages.',
      code: 'REVIEW_SCOPE_REQUIRED',
    });
  }
  try {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const searchesThisHour = await AdminAudit.countDocuments({
      action: 'review_search',
      sessionId: String(req.adminSession?._id || ''),
      at: { $gte: hourAgo },
    });
    if (searchesThisHour >= SEARCH_LIMIT_PER_HOUR) {
      await admin.audit('review_search_limited', req, 'hourly search cap reached');
      return res.status(429).json({ message: 'Too many message searches this hour. Wait before searching again.', code: 'REVIEW_SEARCH_RATE_LIMITED' });
    }

    const keyword = String(req.query?.q || '').trim();
    if (keyword.length < 2) {
      return res.status(422).json({ message: 'Enter at least 2 characters to search messages.', code: 'REVIEW_SEARCH_QUERY_REQUIRED' });
    }
    if (keyword.length > MAX_KEYWORD) {
      return res.status(422).json({ message: `The search term must be under ${MAX_KEYWORD} characters.` });
    }

    const limit = clampLimit(req.query?.limit, 25);
    const requestedPage = Math.max(0, Math.floor(Number(req.query?.page) || 0));
    const page = Math.min(requestedPage, Math.floor((MAX_SEARCH_ROWS - 1) / limit));

    const filter = { content: { $regex: escapeRegex(keyword), $options: 'i' }, isDeleted: false };

    // Optional user filter: an id, or a name/email/username fragment.
    const rawUser = String(req.query?.user || '').trim();
    if (rawUser) {
      const userId = toObjectId(rawUser);
      if (userId) {
        filter.senderId = userId;
      } else if (rawUser.length >= 2) {
        const matches = await User.find({
          $or: [
            { displayName: { $regex: escapeRegex(rawUser), $options: 'i' } },
            { username: { $regex: escapeRegex(rawUser), $options: 'i' } },
            { email: { $regex: escapeRegex(rawUser), $options: 'i' } },
          ],
        })
          .select('_id')
          .limit(20)
          .lean();
        filter.senderId = { $in: matches.map((row) => row._id) };
      }
    }

    // Optional group/conversation filter: a chat id or a group-name fragment.
    const rawChat = String(req.query?.group || '').trim();
    if (rawChat) {
      const chatId = toObjectId(rawChat);
      if (chatId) {
        filter.chatId = chatId;
      } else if (rawChat.length >= 2) {
        const chats = await Chat.find({ type: 'group', groupName: { $regex: escapeRegex(rawChat), $options: 'i' } })
          .select('_id')
          .limit(20)
          .lean();
        filter.chatId = { $in: chats.map((row) => row._id) };
      }
    }

    const from = req.query?.from ? new Date(String(req.query.from)) : null;
    const to = req.query?.to ? new Date(String(req.query.to)) : null;
    if ((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))) {
      filter.sentAt = {};
      if (from && !Number.isNaN(from.getTime())) filter.sentAt.$gte = from;
      if (to && !Number.isNaN(to.getTime())) filter.sentAt.$lte = to;
    }

    const [total, rows] = await Promise.all([
      Message.countDocuments(filter),
      Message.find(filter)
        .sort({ sentAt: -1, _id: -1 })
        .skip(page * limit)
        .limit(limit)
        .populate('senderId', 'displayName username avatarUrl')
        .lean(),
    ]);

    const chatIds = [...new Set(rows.map((row) => String(row.chatId)))];
    const chats = await Chat.find({ _id: { $in: chatIds } })
      .select('type groupName participants')
      .populate('participants', 'displayName username')
      .lean();
    const chatMap = new Map(chats.map((row) => [String(row._id), row]));

    session.views = (session.views || 0) + 1;
    await session.save();
    await admin.audit(
      'review_search',
      req,
      `review=${session._id} q="${keyword.slice(0, MAX_KEYWORD)}" user="${rawUser.slice(0, 60)}" group="${rawChat.slice(0, 60)}" rows=${rows.length} total=${total}`,
    );

    return res.json({
      review: publicReview(session),
      results: rows.map((message) => {
        const chat = chatMap.get(String(message.chatId));
        const others = (chat?.participants || []).filter((participant) => String(participant._id) !== String(message.senderId?._id || message.senderId || ''));
        return {
          id: String(message._id),
          chatId: String(message.chatId),
          chatTitle:
            chat?.type === 'group'
              ? chat.groupName || 'Group'
              : others.map((participant) => participant.displayName || participant.username || 'Chatgram user').join(', ') || 'Direct chat',
          chatType: chat?.type || 'direct',
          senderId: String(message.senderId?._id || message.senderId || ''),
          senderName: message.senderId?.displayName || message.senderId?.username || 'Chatgram user',
          content: message.content || '',
          type: message.type,
          sentAt: message.sentAt,
          editedAt: message.editedAt || null,
        };
      }),
      keyword,
      page,
      limit,
      total,
      capped: total > MAX_SEARCH_ROWS,
      cap: MAX_SEARCH_ROWS,
      filters: { user: rawUser, group: rawChat, from: req.query?.from || '', to: req.query?.to || '' },
    });
  } catch (error) {
    console.error('Review search failed:', error.message);
    return res.status(500).json({ message: 'Could not search messages.' });
  }
}

module.exports = { start, current, end, conversations, messages, list, stats, search, retentionDays };
