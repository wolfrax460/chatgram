/**
 * Admin dashboard data: Overview KPIs/series and the Users list/detail/actions.
 * Everything here is gated by the admin session (see routes/adminRoutes.js); no
 * password hashes, tokens or 2FA secrets are ever selected or returned.
 */
const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const Status = require('../models/Status');
const Report = require('../models/Report');
const SupportTicket = require('../models/SupportTicket');
const realtime = require('../utils/realtime');
const chatgramAi = require('../ai/chatgram');

const { AdminInbox, AiMessage } = chatgramAi;

const SERIES_DAYS = 14;

function seriesDaysFromQuery(req) {
  const requested = Number(req.query?.days);
  if (!Number.isFinite(requested)) return SERIES_DAYS;
  return Math.min(90, Math.max(7, Math.round(requested)));
}

function startOfUtcDay(offsetDays = 0) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - offsetDays);
  return date;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fillDays(rows, seriesDays) {
  const byDay = new Map(rows.map((row) => [row._id, row.count]));
  const out = [];
  for (let offset = seriesDays - 1; offset >= 0; offset -= 1) {
    const day = startOfUtcDay(offset).toISOString().slice(0, 10);
    out.push({ day, count: byDay.get(day) || 0 });
  }
  return out;
}

async function overview(req, res) {
  try {
    const seriesDays = seriesDaysFromQuery(req);
    const now = new Date();
    const today = startOfUtcDay(0);
    const yesterday = startOfUtcDay(1);
    const weekAgo = startOfUtcDay(6);
    const monthAgo = startOfUtcDay(29);
    const seriesStart = startOfUtcDay(seriesDays - 1);

    const [
      usersTotal,
      usersToday,
      usersYesterday,
      groupsTotal,
      statusesTotal,
      storageRows,
      openTickets,
      inboxNew,
      messagesToday,
      messagesYesterday,
      aiToday,
      aiByProvider,
      signupSeries,
      messageSeries,
      activeSeries,
      dailyActiveIds,
      monthlyActiveIds,
      reportsOpen,
      feedbackNew,
    ] = await Promise.all([
      User.countDocuments({ isAiAccount: { $ne: true } }),
      User.countDocuments({ createdAt: { $gte: today }, isAiAccount: { $ne: true } }),
      User.countDocuments({ createdAt: { $gte: yesterday, $lt: today }, isAiAccount: { $ne: true } }),
      Chat.countDocuments({ type: 'group' }),
      Status.countDocuments({}),
      Status.aggregate([{ $match: { mediaSize: { $gt: 0 } } }, { $group: { _id: null, bytes: { $sum: '$mediaSize' } } }]),
      SupportTicket.countDocuments({ status: 'open' }),
      AdminInbox.countDocuments({ status: 'new' }),
      Message.countDocuments({ sentAt: { $gte: today } }),
      Message.countDocuments({ sentAt: { $gte: yesterday, $lt: today } }),
      AiMessage.countDocuments({ role: 'assistant', createdAt: { $gte: today } }),
      AiMessage.aggregate([
        { $match: { role: 'assistant', createdAt: { $gte: weekAgo } } },
        { $group: { _id: '$providerKey', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),
      User.aggregate([
        { $match: { createdAt: { $gte: seriesStart }, isAiAccount: { $ne: true } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      ]),
      Message.aggregate([
        { $match: { sentAt: { $gte: seriesStart } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$sentAt' } }, count: { $sum: 1 } } },
      ]),
      Message.aggregate([
        { $match: { sentAt: { $gte: seriesStart } } },
        { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$sentAt' } }, user: '$senderId' } } },
        { $group: { _id: '$_id.day', count: { $sum: 1 } } },
      ]),
      Message.distinct('senderId', { sentAt: { $gte: today } }),
      Message.distinct('senderId', { sentAt: { $gte: monthAgo } }),
      Report.countDocuments({ status: 'open' }),
      AdminInbox.countDocuments({ status: 'new', type: 'negative_feedback' }),
    ]);

    const health = chatgramAi.aiHealth();

    return res.json({
      kpis: {
        usersTotal,
        newUsersToday: usersToday,
        newUsersChange: usersToday - usersYesterday,
        dailyActive: dailyActiveIds.length,
        monthlyActive: monthlyActiveIds.length,
        messagesToday,
        messagesChange: messagesToday - messagesYesterday,
        groups: groupsTotal,
        statuses: statusesTotal,
        storageBytes: storageRows[0]?.bytes || 0,
        onlineNow: realtime.onlineCount(),
        openTickets,
        inboxNew,
        aiRequestsToday: aiToday,
        aiDegraded: health.degraded,
        aiFailures10Min: health.failuresLast10Min,
        openReports: reportsOpen,
        negativeFeedback: feedbackNew,
      },
      series: {
        signups: fillDays(signupSeries, seriesDays),
        messages: fillDays(messageSeries, seriesDays),
        activeUsers: fillDays(activeSeries, seriesDays),
        aiByProvider: aiByProvider.map((row) => ({ provider: row._id || 'unknown', count: row.count })),
      },
      generatedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Admin overview error:', error.message);
    return res.status(500).json({ message: 'Could not build the overview.' });
  }
}

async function listUsers(req, res) {
  try {
    const search = String(req.query.search || '').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const filter = {};
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ displayName: { $regex: regex } }, { email: { $regex: regex } }, { phone: { $regex: regex } }];
    }
    const [rows, total] = await Promise.all([
      User.find(filter)
        .select('displayName email phone avatarUrl createdAt lastSeen isOnline twoFactorEnabled isSupportAccount isAiAccount mustChangePassword status suspendedUntil moderationReason')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    // Report counts for the visible page only.
    const ids = rows.map((row) => row._id);
    const reportRows = ids.length
      ? await Report.aggregate([
          { $match: { targetUserId: { $in: ids } } },
          { $group: { _id: '$targetUserId', count: { $sum: 1 } } },
        ])
      : [];
    const reportsByUser = new Map(reportRows.map((row) => [String(row._id), row.count]));

    return res.json({
      users: rows.map((row) => ({
        id: String(row._id),
        displayName: row.displayName,
        email: row.email || '',
        phone: row.phone || '',
        avatarUrl: row.avatarUrl || '',
        createdAt: row.createdAt,
        lastSeen: row.lastSeen || null,
        online: realtime.isUserOnline(row._id),
        twoFactorEnabled: row.twoFactorEnabled === true,
        mustChangePassword: row.mustChangePassword === true,
        status: row.status || 'active',
        suspendedUntil: row.suspendedUntil || null,
        moderationReason: row.moderationReason || '',
        isSupportAccount: row.isSupportAccount === true,
        isAiAccount: row.isAiAccount === true,
        reportCount: reportsByUser.get(String(row._id)) || 0,
      })),
      total,
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error('Admin users list error:', error.message);
    return res.status(500).json({ message: 'Could not load users.' });
  }
}

async function userDetail(req, res) {
  try {
    const user = await User.findById(req.params.id)
      .select('displayName email phone avatarUrl about createdAt lastSeen isOnline twoFactorEnabled mustChangePassword isSupportAccount isAiAccount status suspendedUntil moderationReason moderatedAt')
      .lean();
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const [messageCount, chatCount, groupCount, statusCount, reportsAgainst, reportsMade, lastMessage] = await Promise.all([
      Message.countDocuments({ senderId: user._id }),
      Chat.countDocuments({ participants: user._id }),
      Chat.countDocuments({ participants: user._id, type: 'group' }),
      Status.countDocuments({ userId: user._id }),
      Report.countDocuments({ targetUserId: user._id }),
      Report.countDocuments({ reporterId: user._id }),
      Message.findOne({ senderId: user._id }).sort({ sentAt: -1 }).select('sentAt').lean(),
    ]);

    return res.json({
      user: {
        id: String(user._id),
        displayName: user.displayName,
        email: user.email || '',
        phone: user.phone || '',
        avatarUrl: user.avatarUrl || '',
        about: user.about || '',
        createdAt: user.createdAt,
        lastSeen: user.lastSeen || null,
        online: realtime.isUserOnline(user._id),
        twoFactorEnabled: user.twoFactorEnabled === true,
        status: user.status || 'active',
        suspendedUntil: user.suspendedUntil || null,
        moderationReason: user.moderationReason || '',
        moderatedAt: user.moderatedAt || null,
        mustChangePassword: user.mustChangePassword === true,
        isSupportAccount: user.isSupportAccount === true,
        isAiAccount: user.isAiAccount === true,
      },
      counts: {
        messages: messageCount,
        chats: chatCount,
        groups: groupCount,
        statuses: statusCount,
        reportsAgainst,
        reportsMade,
      },
      lastMessageAt: lastMessage?.sentAt || null,
    });
  } catch (error) {
    console.error('Admin user detail error:', error.message);
    return res.status(500).json({ message: 'Could not load the user.' });
  }
}

async function forceLogout(req, res) {
  try {
    const user = await User.findById(req.params.id).select('displayName tokenVersion isSupportAccount');
    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (user.isSupportAccount) return res.status(400).json({ message: 'Do not sign out the Support account.' });
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save({ validateBeforeSave: false });
    const admin = require('../admin/auth');
    await admin.audit('admin_user_force_logout', req, `${user._id} ${user.displayName}`);
    return res.json({ message: `Signed out every device for ${user.displayName}.`, tokenVersion: user.tokenVersion });
  } catch (error) {
    console.error('Admin force logout error:', error.message);
    return res.status(500).json({ message: 'Could not sign the user out.' });
  }
}

async function resetTwoFactor(req, res) {
  try {
    const user = await User.findById(req.params.id).select('displayName twoFactorEnabled twoFactorSecret recoveryCodes isSupportAccount');
    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (user.isSupportAccount) return res.status(400).json({ message: 'Do not reset the Support account 2FA.' });
    user.twoFactorEnabled = false;
    user.twoFactorSecret = undefined;
    user.recoveryCodes = [];
    await user.save({ validateBeforeSave: false });
    const admin = require('../admin/auth');
    await admin.audit('admin_user_reset_2fa', req, `${user._id} ${user.displayName}`);
    return res.json({ message: `Two-step verification reset for ${user.displayName}.` });
  } catch (error) {
    console.error('Admin reset 2FA error:', error.message);
    return res.status(500).json({ message: 'Could not reset two-step verification.' });
  }
}

module.exports = { overview, listUsers, userDetail, forceLogout, resetTwoFactor };
