/**
 * Admin view of protected account deletions.
 *
 * GET /api/admin/account-deletions (admin session, read-only) returns the
 * lifecycle without content: ids, timestamps and a `hasReason` flag only — no
 * email, display name, reason text, code or message content.
 */
const User = require('../models/User');
const AdminAudit = require('../models/AdminAudit');

function row(user) {
  return {
    userId: String(user._id),
    displayName: user.displayName || '',
    pendingDeletionAt: user.pendingDeletionAt || null,
    deleteAt: user.deleteAt || null,
    hasReason: Boolean(user.deletionReason),
  };
}

// @desc    Pending / due / completed account deletions
// @route   GET /api/admin/account-deletions
// @access  Admin
const listAccountDeletions = async (req, res) => {
  try {
    const now = new Date();
    const [scheduledDocs, dueDocs, executed] = await Promise.all([
      User.find({ pendingDeletionAt: { $ne: null }, deleteAt: { $gt: now } })
        .select('displayName pendingDeletionAt deleteAt deletionReason')
        .sort({ deleteAt: 1 })
        .limit(200)
        .lean(),
      User.find({ deleteAt: { $ne: null, $lte: now } })
        .select('displayName pendingDeletionAt deleteAt deletionReason')
        .sort({ deleteAt: 1 })
        .limit(200)
        .lean(),
      AdminAudit.find({ action: 'account_deletion_executed' })
        .select('userId at')
        .sort({ at: -1 })
        .limit(100)
        .lean(),
    ]);

    const scheduled = scheduledDocs.map(row);
    const pending = dueDocs.map(row);
    const completed = executed.map((entry) => ({
      userId: entry.userId ? String(entry.userId) : null,
      executedAt: entry.at,
    }));

    return res.json({
      now,
      counts: { scheduled: scheduled.length, pending: pending.length, completed: completed.length },
      scheduled,
      pending,
      completed,
    });
  } catch (error) {
    console.error('Admin account deletions list failed:', error.message);
    return res.status(500).json({ message: 'Could not list account deletions.' });
  }
};

module.exports = { listAccountDeletions };
