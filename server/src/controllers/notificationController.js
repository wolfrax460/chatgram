/**
 * Push notification device registration + a self-test push.
 *
 * The client registers its FCM token after sign-in (and on token refresh), and
 * can remove it on sign-out. Registration is an upsert: re-registering the same
 * device updates it instead of duplicating it, and a token that moves to another
 * account (device switched users) is reassigned. Per-user cap: 10 devices, with
 * the least-recently-seen one dropped beyond that.
 */
const DeviceToken = require('../models/DeviceToken');
const firebase = require('../services/firebase');
const pushSender = require('../services/pushSender');

const MAX_DEVICES_PER_USER = 10;
const TOKEN_RE = /^[A-Za-z0-9_:.-]{8,4096}$/;
const PLATFORMS = new Set(['android', 'web']);
const LABEL_MAX = 80;

function readToken(body) {
  const token = String((body && body.token) || '').trim();
  if (!token || token.length > 4096) return null;
  return token;
}

// @desc    Register/refresh this device's push token
// @route   POST /api/notifications/devices
// @access  Private
const registerDevice = async (req, res) => {
  try {
    const token = readToken(req.body);
    const platform = String(req.body?.platform || '').trim().toLowerCase();
    if (!token || !TOKEN_RE.test(token) || !PLATFORMS.has(platform)) {
      return res.status(400).json({ message: 'A valid device token and platform are required.', code: 'INVALID_DEVICE' });
    }
    const deviceLabel = String(req.body?.deviceLabel || '').trim().slice(0, LABEL_MAX);
    const now = new Date();

    await DeviceToken.findOneAndUpdate(
      { token },
      {
        $set: {
          userId: req.user._id,
          platform,
          deviceLabel,
          lastSeenAt: now,
          invalid: false,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );

    // Cap: keep the 10 most recently seen devices for this user.
    const devices = await DeviceToken.find({ userId: req.user._id })
      .sort({ lastSeenAt: -1 })
      .select('_id')
      .lean();
    if (devices.length > MAX_DEVICES_PER_USER) {
      const stale = devices.slice(MAX_DEVICES_PER_USER).map((row) => row._id);
      await DeviceToken.deleteMany({ _id: { $in: stale } });
    }
    // A new token exists now: let the sender skip its "no devices yet" cache.
    pushSender.invalidateTokenCache();
    return res.status(204).end();
  } catch (error) {
    console.error('Register device error:', error.message);
    return res.status(500).json({ message: 'Could not register this device.', code: 'DEVICE_REGISTER_FAILED' });
  }
};

// @desc    Remove this device's push token (idempotent)
// @route   DELETE /api/notifications/devices
// @access  Private
const unregisterDevice = async (req, res) => {
  try {
    const token = readToken(req.body);
    if (!token) {
      return res.status(400).json({ message: 'A device token is required.', code: 'INVALID_DEVICE' });
    }
    await DeviceToken.deleteOne({ token, userId: req.user._id });
    // 204 even when it was already gone: sign-out must never fail on this.
    return res.status(204).end();
  } catch (error) {
    console.error('Unregister device error:', error.message);
    return res.status(500).json({ message: 'Could not remove this device.', code: 'DEVICE_REMOVE_FAILED' });
  }
};

// @desc    Send one test notification to the caller's own devices
// @route   POST /api/notifications/devices/test
// @access  Private
const sendTestPush = async (req, res) => {
  try {
    if (!firebase.isPushEnabled()) {
      // Clear, non-500 answer: the API is fine, push is simply not configured.
      return res.status(503).json({
        message: 'Push notifications are not configured on this server.',
        code: 'PUSH_DISABLED',
      });
    }
    const result = await pushSender.sendTestPush(req.user._id);
    return res.json({ sent: result.sent || 0, failed: result.failed || 0 });
  } catch (error) {
    console.error('Test push error:', error.message);
    return res.status(500).json({ message: 'Could not send the test notification.', code: 'TEST_PUSH_FAILED' });
  }
};

module.exports = { registerDevice, unregisterDevice, sendTestPush, MAX_DEVICES_PER_USER };
