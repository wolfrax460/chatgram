/**
 * Account deletion.
 *
 * 1. `deleteAccountData` — legacy immediate/30-day admin deletion (removes direct
 *    chats and messages). Used by DELETE /api/auth/account and the admin grace
 *    purger from 9b.
 * 2. Protected self-deletion (v2) — code-verified 14-day grace with
 *    `pendingDeletionAt` / `deleteAt` / `deletionReason`, hourly purger and a
 *    media deletion queue. Policy implemented by `purgeAccount` is documented
 *    there; nothing routes through an external media provider.
 */
const User = require('../models/User');
const AdminAudit = require('../models/AdminAudit');
const PendingMediaDeletion = require('../models/PendingMediaDeletion');

const GRACE_DAYS = 14;
const DELETION_CODE_TTL_MS = 10 * 60 * 1000;
const CODE_TARGET_PREFIX = 'delete:';
const MAX_SENDS_PER_HOUR = 3;
const ONE_HOUR_MS = 60 * 60 * 1000;

async function deleteAccountData(userId, displayName = 'This user') {
  const name = displayName || 'This user';

  try {
    const Status = require('../models/Status');
    const statusCleanup = require('./statusCleanup');
    const statuses = await Status.find({ userId });
    for (const status of statuses) await statusCleanup.removeStatusWithMedia(status);
  } catch (error) {
    console.warn('Account deletion: status cleanup failed:', error.message);
  }

  try {
    const Chat = require('../models/Chat');
    const Message = require('../models/Message');
    const groupSystem = require('./groupSystem');

    const directChats = await Chat.find({ type: 'direct', participants: userId });
    for (const chat of directChats) {
      await Message.deleteMany({ chatId: chat._id });
      await Chat.deleteOne({ _id: chat._id });
    }

    const groups = await Chat.find({ type: 'group', participants: userId });
    for (const group of groups) {
      group.participants = group.participants.filter((id) => String(id) !== String(userId));
      group.groupAdmins = (group.groupAdmins || []).filter((id) => String(id) !== String(userId));
      if (group.participants.length === 0) {
        await Message.deleteMany({ chatId: group._id });
        await Chat.deleteOne({ _id: group._id });
        continue;
      }
      if (group.groupAdmins.length === 0) group.groupAdmins = [group.participants[0]];
      await group.save();
      await groupSystem.postSystemMessage(group, `${name} deleted their account`);
      await groupSystem.broadcastChatUpdate(group._id);
      groupSystem.broadcastMemberList(group._id);
    }
  } catch (error) {
    console.warn('Account deletion: chat cleanup failed:', error.message);
  }

  try {
    await User.updateMany({}, { $pull: { contacts: userId, blocked: userId, onlineStatusExceptions: userId } });
  } catch (error) {
    console.warn('Account deletion: contact cleanup failed:', error.message);
  }

  try {
    const UserSession = require('../models/UserSession');
    const LoginEvent = require('../models/LoginEvent');
    const UserWarning = require('../models/UserWarning');
    await Promise.all([
      UserSession.deleteMany({ userId }),
      LoginEvent.deleteMany({ userId }),
      UserWarning.deleteMany({ userId }),
    ]);
  } catch (error) {
    console.warn('Account deletion: session cleanup failed:', error.message);
  }

  await User.deleteOne({ _id: userId });
}

/* ------------------------------------------------ protected self-deletion */

function deletionTarget(email) {
  return `${CODE_TARGET_PREFIX}${String(email || '').toLowerCase()}`;
}

/** Browser-safe pendingDeletion field for user payloads. */
function pendingDeletionShape(user) {
  if (!user || !user.pendingDeletionAt || !user.deleteAt) return null;
  const shape = { deleteAt: new Date(user.deleteAt).toISOString() };
  if (user.deletionReason) shape.reason = String(user.deletionReason);
  return shape;
}

/**
 * One append-only lifecycle audit row. `detail` is a short flag only: never the
 * email/phone, the code or the user's reason text.
 */
async function auditDeletion(action, req, userId, detail = '') {
  try {
    await AdminAudit.create({
      action,
      detail: String(detail || '').slice(0, 80),
      userId: userId || null,
      ip: String(req?.ip || '').replace(/^::ffff:/i, '').slice(0, 60),
      userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 300),
      sessionId: '',
      at: new Date(),
    });
  } catch (error) {
    console.warn('Account deletion audit failed:', error.message);
  }
}

/** Number of deletion codes sent to this user in the last hour (audit-backed). */
async function countRecentSends(userId, now = new Date()) {
  return AdminAudit.countDocuments({
    action: 'account_delete_code_sent',
    userId,
    at: { $gte: new Date(now.getTime() - ONE_HOUR_MS) },
  });
}

async function recordCodeSent(req, userId, detail = 'sent') {
  await auditDeletion('account_delete_code_sent', req, userId, detail);
}

/** Email a confirmation (kill-switch aware; never throws). */
async function sendDeletionMail(user, subject, text) {
  try {
    if (!user?.email) return { delivered: false, provider: 'none' };
    const notifier = require('./notifier');
    return await notifier.sendMail({ to: user.email, subject, text });
  } catch (error) {
    console.warn('Account deletion email failed:', error.message);
    return { delivered: false, provider: 'error' };
  }
}

function graceDate(now = new Date()) {
  return new Date(now.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Clear the pending-deletion state and audit it. Used by the cancel endpoint,
 * login-restore and idempotent flows.
 */
async function cancelPendingDeletion(user, { req = null, detail = 'cancelled' } = {}) {
  if (!user) return false;
  const hadPending = Boolean(user.pendingDeletionAt || user.deleteAt);
  try {
    await User.updateOne(
      { _id: user._id },
      { $set: { pendingDeletionAt: null, deleteAt: null, deletionReason: '' } },
    );
  } catch (error) {
    console.warn('Account deletion cancel failed:', error.message);
    throw error;
  }
  if (hadPending) await auditDeletion('account_deletion_cancelled', req, user._id, detail);
  return hadPending;
}

/** Queue media URLs that the purge could not prove deleted. */
async function enqueueMedia(rows) {
  const valid = (rows || []).filter((row) => row && row.url);
  if (!valid.length) return 0;
  try {
    await PendingMediaDeletion.insertMany(
      valid.map((row) => ({
        kind: row.kind,
        url: String(row.url),
        publicId: row.publicId || null,
        provider: row.provider || null,
        userId: row.userId || null,
        source: 'account-deletion',
        createdAt: new Date(),
        attempts: 0,
      })),
      { ordered: false },
    );
  } catch (error) {
    console.warn('Account deletion media queue failed:', error.message);
    return 0;
  }
  return valid.length;
}

/**
 * Permanently delete one account after its grace period. Safe to call twice: a
 * missing user is a no-op. Returns a small summary (counts only).
 *
 * Purge policy: delete user document, avatar reference, sessions/login history,
 * device tokens, verification codes, statuses (+ media through the existing
 * statusCleanup helper); mark the user's messages deleted-author while keeping
 * the chat and every other participant's messages (direct chats are NOT
 * deleted); remove contacts/blockers/group membership (empty groups removed);
 * never call an external media provider — enqueue the URLs in
 * PendingMediaDeletion for operator cleanup.
 */
async function purgeAccount(user) {
  if (!user) return null;
  const userId = user._id;
  const summary = { userId: String(userId), messages: 0, statuses: 0, queuedMedia: 0, accounts: 0 };

  const mediaRows = [];
  if (user.avatarUrl) mediaRows.push({ kind: 'avatar', url: user.avatarUrl, userId });

  try {
    const Status = require('../models/Status');
    const statuses = await Status.find({ userId }).lean();
    summary.statuses = statuses.length;
    for (const status of statuses) {
      if (status.mediaUrl) {
        mediaRows.push({
          kind: 'status',
          url: status.mediaUrl,
          publicId: status.mediaPublicId || null,
          provider: status.mediaProvider || null,
          userId,
        });
      }
      if (status.thumbnailUrl) {
        mediaRows.push({
          kind: 'status-thumbnail',
          url: status.thumbnailUrl,
          publicId: status.mediaPublicId || null,
          provider: status.mediaProvider || null,
          userId,
        });
      }
    }
    if (mediaRows.length) summary.queuedMedia += await enqueueMedia(mediaRows);
    const statusCleanup = require('./statusCleanup');
    for (const status of statuses) await statusCleanup.removeStatusWithMedia(status);
  } catch (error) {
    console.warn('Account deletion: status cleanup failed:', error.message);
  }

  try {
    const Message = require('../models/Message');
    const myMessages = await Message.find({ senderId: userId }).select('mediaUrl').limit(500).lean();
    const messageMedia = myMessages
      .filter((message) => message.mediaUrl)
      .map((message) => ({ kind: 'message', url: message.mediaUrl, userId }));
    if (messageMedia.length) summary.queuedMedia += await enqueueMedia(messageMedia);
    const result = await Message.updateMany(
      { senderId: userId },
      { $set: { isDeleted: true, content: '', mediaUrl: null } },
    );
    summary.messages = result.modifiedCount || 0;
  } catch (error) {
    console.warn('Account deletion: message cleanup failed:', error.message);
  }

  try {
    const Chat = require('../models/Chat');
    const groupSystem = require('./groupSystem');
    const groups = await Chat.find({ type: 'group', participants: userId });
    for (const group of groups) {
      group.participants = (group.participants || []).filter((id) => String(id) !== String(userId));
      group.groupAdmins = (group.groupAdmins || []).filter((id) => String(id) !== String(userId));
      if (group.participants.length === 0) {
        const Message = require('../models/Message');
        await Message.deleteMany({ chatId: group._id });
        await Chat.deleteOne({ _id: group._id });
        continue;
      }
      if (!group.groupAdmins.length) group.groupAdmins = [group.participants[0]];
      await group.save();
      try {
        groupSystem.broadcastChatUpdate?.(group._id);
        groupSystem.broadcastMemberList?.(group._id);
      } catch {
        /* realtime is best-effort */
      }
    }
    // Direct chats stay: the other participant keeps the conversation history.
  } catch (error) {
    console.warn('Account deletion: chat cleanup failed:', error.message);
  }

  try {
    await User.updateMany({}, { $pull: { contacts: userId, blocked: userId, onlineStatusExceptions: userId } });
  } catch (error) {
    console.warn('Account deletion: contact cleanup failed:', error.message);
  }

  try {
    const UserSession = require('../models/UserSession');
    const LoginEvent = require('../models/LoginEvent');
    const UserWarning = require('../models/UserWarning');
    const DeviceToken = require('../models/DeviceToken');
    const VerificationCode = require('../models/VerificationCode');
    const targets = [];
    if (user.email) targets.push(String(user.email).toLowerCase(), deletionTarget(user.email));
    if (user.phone) targets.push(String(user.phone), `${CODE_TARGET_PREFIX}${String(user.phone)}`);
    await Promise.all([
      UserSession.deleteMany({ userId }),
      LoginEvent.deleteMany({ userId }),
      UserWarning.deleteMany({ userId }),
      DeviceToken.deleteMany({ userId }),
      targets.length ? VerificationCode.deleteMany({ target: { $in: targets } }) : Promise.resolve(),
    ]);
  } catch (error) {
    console.warn('Account deletion: session cleanup failed:', error.message);
  }

  await sendDeletionMail(
    user,
    'Your Chatgram account was deleted',
    `Hi ${user.displayName || 'there'},\n\nThe grace period for your Chatgram account ended and the account has now been deleted.\n\nIf you did not request this, contact the Chatgram team immediately.`,
  );

  try {
    const result = await User.deleteOne({ _id: userId });
    summary.accounts = result.deletedCount || 0;
  } catch (error) {
    console.warn('Account deletion: user delete failed:', error.message);
  }

  await auditDeletion('account_deletion_executed', null, userId, 'purged');
  return summary;
}

/**
 * Hourly purger entry point: erase every account whose deleteAt has passed.
 * Called by the existing scheduled maintenance interval in server.js.
 */
async function runAccountDeletionPurge({ now = new Date(), limit = 10 } = {}) {
  const due = await User.find({ deleteAt: { $ne: null, $lte: now } })
    .select('_id displayName email phone authProvider avatarUrl pendingDeletionAt deleteAt deletionReason')
    .limit(limit);
  const summaries = [];
  for (const user of due) {
    try {
      summaries.push(await purgeAccount(user));
    } catch (error) {
      console.warn('Account deletion purge failed:', error.message);
    }
  }
  return summaries;
}

module.exports = {
  GRACE_DAYS,
  DELETION_CODE_TTL_MS,
  MAX_SENDS_PER_HOUR,
  deletionTarget,
  pendingDeletionShape,
  auditDeletion,
  countRecentSends,
  recordCodeSent,
  sendDeletionMail,
  graceDate,
  cancelPendingDeletion,
  purgeAccount,
  runAccountDeletionPurge,
  deleteAccountData,
};
