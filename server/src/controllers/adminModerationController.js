/**
 * Moderation (9b): account actions (suspend / ban / unban) and the report queue.
 * Admin session only; every state change is audited. Content is shown read-only
 * and admins can never send or edit messages on a user's behalf.
 */
const mongoose = require('mongoose');
const User = require('../models/User');
const Report = require('../models/Report');
const Message = require('../models/Message');
const Status = require('../models/Status');
const admin = require('../admin/auth');

const DAY_MS = 24 * 60 * 60 * 1000;
const PROTECTED = (user) => user.isSupportAccount === true || user.isAiAccount === true;

function summary(user) {
  return {
    id: String(user._id),
    displayName: user.displayName,
    status: user.status || 'active',
    suspendedUntil: user.suspendedUntil || null,
    moderationReason: user.moderationReason || '',
  };
}

async function findTarget(req, res) {
  if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ''))) {
    res.status(400).json({ message: 'Invalid user id.' });
    return null;
  }
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404).json({ message: 'User not found.' });
    return null;
  }
  if (PROTECTED(user)) {
    res.status(400).json({ message: 'The Support and Chatgram AI accounts cannot be moderated.' });
    return null;
  }
  return user;
}

async function suspend(req, res) {
  try {
    const user = await findTarget(req, res);
    if (!user) return undefined;
    const days = Math.min(3650, Math.max(1, Number(req.body?.days) || 7));
    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    user.status = 'suspended';
    user.suspendedUntil = new Date(Date.now() + days * DAY_MS);
    user.moderationReason = reason;
    user.moderatedAt = new Date();
    await user.save({ validateBeforeSave: false });
    await admin.audit('user_suspend', req, `${user._id} ${days}d ${reason}`.slice(0, 300));
    return res.json({ message: `${user.displayName} suspended for ${days} day(s).`, user: summary(user) });
  } catch (error) {
    console.error('Suspend error:', error.message);
    return res.status(500).json({ message: 'Could not suspend the account.' });
  }
}

async function ban(req, res) {
  try {
    const user = await findTarget(req, res);
    if (!user) return undefined;
    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    user.status = 'banned';
    user.suspendedUntil = null;
    user.moderationReason = reason;
    user.moderatedAt = new Date();
    user.tokenVersion = (Number(user.tokenVersion) || 0) + 1;
    await user.save({ validateBeforeSave: false });
    await admin.audit('user_ban', req, `${user._id} ${reason}`.slice(0, 300));
    return res.json({ message: `${user.displayName} banned.`, user: summary(user) });
  } catch (error) {
    console.error('Ban error:', error.message);
    return res.status(500).json({ message: 'Could not ban the account.' });
  }
}

async function unban(req, res) {
  try {
    const user = await findTarget(req, res);
    if (!user) return undefined;
    user.status = 'active';
    user.suspendedUntil = null;
    user.moderationReason = '';
    user.moderatedAt = new Date();
    await user.save({ validateBeforeSave: false });
    await admin.audit('user_unban', req, String(user._id));
    return res.json({ message: `${user.displayName} is active again.`, user: summary(user) });
  } catch (error) {
    console.error('Unban error:', error.message);
    return res.status(500).json({ message: 'Could not restore the account.' });
  }
}

/* ------------------------------------------------------------------ reports */

const REPORT_STATUSES = ['open', 'reviewed', 'actioned'];

async function listReports(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const status = REPORT_STATUSES.includes(String(req.query.status)) ? String(req.query.status) : 'open';
    const reason = String(req.query.reason || '').trim();
    const search = String(req.query.search || '').trim();
    const filter = { status };
    if (reason && reason !== 'all') filter.reason = reason;
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ details: { $regex: regex } }, { messageSnapshot: { $regex: regex } }];
    }
    const [rows, total, counts] = await Promise.all([
      Report.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Report.countDocuments(filter),
      Report.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);
    const userIds = new Set();
    for (const row of rows) {
      if (row.reporterId) userIds.add(String(row.reporterId));
      if (row.targetUserId) userIds.add(String(row.targetUserId));
    }
    const users = userIds.size
      ? await User.find({ _id: { $in: [...userIds] } }).select('displayName email status').lean()
      : [];
    const byId = new Map(users.map((user) => [String(user._id), user]));
    return res.json({
      reports: rows.map((row) => ({
        id: String(row._id),
        reason: row.reason,
        details: row.details || '',
        status: row.status,
        resolution: row.resolution || '',
        createdAt: row.createdAt,
        reporter: byId.get(String(row.reporterId)) ? { id: String(row.reporterId), displayName: byId.get(String(row.reporterId)).displayName } : null,
        targetUser: row.targetUserId && byId.get(String(row.targetUserId))
          ? { id: String(row.targetUserId), displayName: byId.get(String(row.targetUserId)).displayName, status: byId.get(String(row.targetUserId)).status || 'active' }
          : null,
        targetUserId: row.targetUserId ? String(row.targetUserId) : null,
        reporterId: row.reporterId ? String(row.reporterId) : null,
        targetChatId: row.chatId ? String(row.chatId) : null,
        targetMessageId: row.targetMessageId ? String(row.targetMessageId) : null,
        targetStatusId: row.targetStatusId ? String(row.targetStatusId) : null,
        messageSnapshot: row.messageSnapshot || '',
      })),
      total,
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(total / limit)),
      counts: counts.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {}),
    });
  } catch (error) {
    console.error('Admin reports list error:', error.message);
    return res.status(500).json({ message: 'Could not load the reports.' });
  }
}

async function reportDetail(req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ''))) return res.status(400).json({ message: 'Invalid report id.' });
    const report = await Report.findById(req.params.id).lean();
    if (!report) return res.status(404).json({ message: 'Report not found.' });
    const [reporter, target, message, status, chat] = await Promise.all([
      User.findById(report.reporterId).select('displayName email createdAt').lean(),
      report.targetUserId ? User.findById(report.targetUserId).select('displayName email status createdAt twoFactorEnabled').lean() : null,
      report.targetMessageId ? Message.findById(report.targetMessageId).select('content type sentAt isDeleted mediaUrl chatId senderId').lean() : null,
      report.targetStatusId ? Status.findById(report.targetStatusId).select('caption mediaType createdAt').lean() : null,
      report.chatId ? mongoose.model('Chat').findById(report.chatId).select('type groupName').lean() : null,
    ]);
    return res.json({
      report: {
        id: String(report._id),
        reason: report.reason,
        details: report.details || '',
        status: report.status,
        resolution: report.resolution || '',
        createdAt: report.createdAt,
        messageSnapshot: report.messageSnapshot || '',
      },
      reporter: reporter ? { id: String(reporter._id), displayName: reporter.displayName, email: reporter.email || '', createdAt: reporter.createdAt } : null,
      targetUser: target
        ? { id: String(target._id), displayName: target.displayName, email: target.email || '', status: target.status || 'active', createdAt: target.createdAt, twoFactorEnabled: target.twoFactorEnabled === true }
        : null,
      message: message
        ? { id: String(message._id), content: message.isDeleted ? '[deleted]' : message.content || '', type: message.type, sentAt: message.sentAt, isDeleted: message.isDeleted === true, mediaUrl: message.mediaUrl || null }
        : null,
      status: status ? { id: String(status._id), caption: status.caption || '', mediaType: status.mediaType || 'image', createdAt: status.createdAt } : null,
      chat: chat ? { id: String(chat._id), type: chat.type, groupName: chat.groupName || '' } : null,
    });
  } catch (error) {
    console.error('Admin report detail error:', error.message);
    return res.status(500).json({ message: 'Could not load the report.' });
  }
}

const ACTIONS = ['dismiss', 'remove_content', 'suspend', 'ban'];

async function resolveReport(req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ''))) return res.status(400).json({ message: 'Invalid report id.' });
    const action = String(req.body?.action || '');
    if (!ACTIONS.includes(action)) return res.status(400).json({ message: 'Choose dismiss, remove_content, suspend or ban.' });
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ message: 'Report not found.' });
    if (report.status === 'actioned') return res.status(400).json({ message: 'This report was already actioned.' });

    let message = 'Report dismissed.';
    if (action === 'remove_content') {
      if (report.targetMessageId) {
        const target = await Message.findById(report.targetMessageId);
        if (target) {
          target.isDeleted = true;
          await target.save({ validateBeforeSave: false });
        }
      }
      if (report.targetStatusId) await Status.findByIdAndDelete(report.targetStatusId);
      message = 'Content removed and the reporter notified by the resolution status.';
    } else if (action === 'suspend' || action === 'ban') {
      if (!report.targetUserId) return res.status(400).json({ message: 'This report has no target account to moderate.' });
      const user = await User.findById(report.targetUserId);
      if (!user) return res.status(404).json({ message: 'The reported user no longer exists.' });
      if (PROTECTED(user)) return res.status(400).json({ message: 'The Support and Chatgram AI accounts cannot be moderated.' });
      if (action === 'suspend') {
        const days = Math.min(3650, Math.max(1, Number(req.body?.days) || 7));
        user.status = 'suspended';
        user.suspendedUntil = new Date(Date.now() + days * DAY_MS);
        user.moderationReason = String(req.body?.reason || report.reason || '').slice(0, 500);
        message = `${user.displayName} suspended for ${days} day(s).`;
      } else {
        user.status = 'banned';
        user.suspendedUntil = null;
        user.moderationReason = String(req.body?.reason || report.reason || '').slice(0, 500);
        user.tokenVersion = (Number(user.tokenVersion) || 0) + 1;
        message = `${user.displayName} banned.`;
      }
      user.moderatedAt = new Date();
      await user.save({ validateBeforeSave: false });
    }

    report.status = action === 'dismiss' ? 'reviewed' : 'actioned';
    report.resolution = action;
    report.resolvedAt = new Date();
    report.resolvedBy = 'admin';
    await report.save();
    await admin.audit('report_resolve', req, `${report._id} ${action}`.slice(0, 300));
    return res.json({ message, report: { id: String(report._id), status: report.status, resolution: report.resolution } });
  } catch (error) {
    console.error('Admin report resolve error:', error.message);
    return res.status(500).json({ message: 'Could not resolve the report.' });
  }
}

module.exports = { suspend, ban, unban, listReports, reportDetail, resolveReport };
