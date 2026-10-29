/**
 * Protected account deletion (14-day grace).
 *
 *   POST /api/account/delete/request-code  -> { sent, channel, expiresInSeconds }
 *   POST /api/account/delete/confirm       -> { scheduled, deleteAt }
 *   POST /api/account/delete/cancel        -> { cancelled: true }
 *
 * The code is a normal verificationStore code scoped to
 * `delete:<registered email>` with a 10-minute TTL, single use and the same
 * 5-attempt limit as other codes; a per-user audit counter enforces at most 3
 * sends per hour. The code/email is never logged and never stored in the audit.
 */
const User = require('../models/User');
const store = require('../utils/verificationStore');
const deletion = require('../utils/accountDeletion');
const notifier = require('../utils/notifier');

const CODE_TTL_SECONDS = Math.floor(deletion.DELETION_CODE_TTL_MS / 1000);

function cleanReason(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

// @desc    Send the 6-digit account-deletion confirmation code to the email
// @route   POST /api/account/delete/request-code
// @access  Private
const requestCode = async (req, res) => {
  try {
    const user = req.user;
    if (!user?.email) {
      return res.status(409).json({
        message: 'Add an email address to your account before deleting it.',
        code: 'EMAIL_REQUIRED',
      });
    }

    const recentSends = await deletion.countRecentSends(user._id);
    if (recentSends >= deletion.MAX_SENDS_PER_HOUR) {
      return res.status(429).json({
        message: 'Too many deletion codes requested. Try again in an hour.',
        code: 'CODE_RATE_LIMITED',
        retryAfterSeconds: 3600,
      });
    }

    const issued = await store.issue('email', deletion.deletionTarget(user.email), {
      ttlMs: deletion.DELETION_CODE_TTL_MS,
    });
    if (!issued.ok) {
      return res.status(429).json({
        message: 'A code was just sent. Wait a moment before requesting another.',
        code: 'CODE_RATE_LIMITED',
        retryAfterSeconds: issued.retryAfterSeconds,
      });
    }

    // Audit one content-free row per successful send (used as the hourly counter).
    await deletion.recordCodeSent(req, user._id);
    try {
      await notifier.sendEmailCode(user.email, issued.code, 10);
    } catch (sendError) {
      console.warn('Account deletion code email failed:', String(sendError?.message || '').slice(0, 140));
    }
    await deletion.sendDeletionMail(
      user,
      'Chatgram account deletion requested',
      `Hi ${user.displayName || 'there'},\n\nA deletion code was requested for your Chatgram account. Enter it in the app to schedule deletion (14-day grace period).\n\nIf this was not you, ignore this email and consider changing your password.`,
    );

    const payload = { sent: true, channel: 'email', expiresInSeconds: CODE_TTL_SECONDS };
    // Local development convenience, same gate as the auth code endpoints; in
    // production DEV_SHOW_CODES is false so the code only exists in the email.
    if (process.env.DEV_SHOW_CODES === 'true' && process.env.NODE_ENV !== 'production') {
      payload.devCode = issued.code;
    }
    return res.json(payload);
  } catch (error) {
    console.error('Account deletion request-code failed:', String(error?.message || '').slice(0, 200));
    return res.status(500).json({ message: 'Could not send the deletion code. Please try again.' });
  }
};

// @desc    Verify password + code + confirm word and schedule deletion
// @route   POST /api/account/delete/confirm
// @access  Private
const confirm = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('+password');
    if (!user) return res.status(401).json({ message: 'Not authorized' });
    if (!user.email) {
      return res.status(409).json({
        message: 'Add an email address to your account before deleting it.',
        code: 'EMAIL_REQUIRED',
      });
    }

    // Password is required for local accounts; Google-only accounts prove
    // ownership with the emailed code only.
    const requiresPassword = user.authProvider !== 'google';
    const password = String(req.body?.password || '');
    if (requiresPassword) {
      if (!password) {
        return res.status(400).json({ message: 'Enter your password.', code: 'PASSWORD_REQUIRED' });
      }
      const matches = await user.comparePassword(password);
      if (!matches) {
        return res.status(400).json({ message: 'That password is not correct.', code: 'PASSWORD_INVALID' });
      }
    }

    const confirmWord = String(req.body?.confirmWord || '').trim();
    if (confirmWord !== 'DELETE') {
      return res.status(400).json({
        message: 'Type DELETE exactly to confirm.',
        code: 'CONFIRM_WORD_REQUIRED',
      });
    }

    const code = store.normalizeCode(req.body?.code);
    if (!code) {
      return res.status(400).json({ message: 'Enter the 6-digit code from the email.', code: 'CODE_MISSING' });
    }

    const checked = await store.check('email', deletion.deletionTarget(user.email), code);
    if (!checked.ok) {
      if (checked.reason === 'too_many_attempts') {
        return res.status(429).json({
          message: 'Too many wrong codes. Request a new code.',
          code: 'CODE_TOO_MANY_ATTEMPTS',
          canResend: true,
        });
      }
      const mapping = {
        expired: { status: 400, code: 'CODE_EXPIRED', message: 'That code has expired. Request a new one.' },
        missing: { status: 400, code: 'CODE_MISSING', message: 'That code is no longer valid. Request a new one.' },
        invalid: { status: 400, code: 'CODE_INVALID', message: 'That code is not correct.' },
      };
      const failure = mapping[checked.reason] || mapping.invalid;
      return res.status(failure.status).json({ message: failure.message, code: failure.code });
    }

    const now = new Date();
    const deleteAt = deletion.graceDate(now);
    user.pendingDeletionAt = now;
    user.deleteAt = deleteAt;
    user.deletionReason = cleanReason(req.body?.reason);
    await user.save({ validateBeforeSave: false });

    await deletion.auditDeletion(
      'account_deletion_scheduled',
      req,
      user._id,
      user.deletionReason ? 'has_reason' : 'scheduled',
    );
    await deletion.sendDeletionMail(
      user,
      'Your Chatgram account is scheduled for deletion',
      `Hi ${user.displayName || 'there'},\n\nYour Chatgram account is scheduled for deletion on ${deleteAt.toUTCString()} (14-day grace period).\n\nSign in at any time before then to cancel, or use the cancel option in the app.\n\nIf you did not request this, change your password immediately.`,
    );

    return res.json({ scheduled: true, deleteAt: deleteAt.toISOString() });
  } catch (error) {
    console.error('Account deletion confirm failed:', String(error?.message || '').slice(0, 200));
    return res.status(500).json({ message: 'Could not schedule the deletion. Please try again.' });
  }
};

// @desc    Cancel a pending deletion (idempotent)
// @route   POST /api/account/delete/cancel
// @access  Private
const cancel = async (req, res) => {
  try {
    await deletion.cancelPendingDeletion(req.user, { req, detail: 'cancelled' });
    return res.json({ cancelled: true });
  } catch (error) {
    console.error('Account deletion cancel failed:', String(error?.message || '').slice(0, 200));
    return res.status(500).json({ message: 'Could not cancel the deletion. Please try again.' });
  }
};

module.exports = { requestCode, confirm, cancel };
