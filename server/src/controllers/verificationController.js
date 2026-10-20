// Email verification / phone OTP
const jwt = require('jsonwebtoken');
const store = require('../utils/verificationStore');
const notifier = require('../utils/notifier');

const SECRET = () => process.env.JWT_SECRET || 'your-secret-key';
const TOKEN_TTL = '30m';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9]{7,15}$/;

/** Strip formatting so "+250 780 000 001" and "+250780000001" are the same. */
function normalizePhone(value) {
  return String(value).replace(/[\s\-().]/g, '');
}

/**
 * Work out whether a target is an email or a phone number.
 * @returns {{channel: 'email'|'phone', target: string} | null}
 */
function parseTarget(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;

  if (value.includes('@')) {
    const email = value.toLowerCase();
    return EMAIL_RE.test(email) ? { channel: 'email', target: email } : null;
  }

  const phone = normalizePhone(value);
  return PHONE_RE.test(phone) ? { channel: 'phone', target: phone } : null;
}

function issueVerificationToken(channel, target) {
  return jwt.sign({ purpose: 'verification', channel, target }, SECRET(), {
    expiresIn: TOKEN_TTL,
  });
}

/**
 * Validate a token produced by `checkCode`.
 * @returns {{channel: string, target: string} | null}
 */
function readVerificationToken(token) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, SECRET());
    if (decoded.purpose !== 'verification') return null;
    return { channel: decoded.channel, target: decoded.target };
  } catch {
    return null;
  }
}

// @desc    Send a verification code to an email address or phone number
// @route   POST /api/auth/verification/send
// @access  Public
const sendCode = async (req, res) => {
  try {
    const parsed = parseTarget(req.body.target || req.body.identifier || req.body.email || req.body.phone);
    if (!parsed) {
      return res.status(400).json({
        message: 'Enter a valid email address or phone number (with country code, e.g. +250780000001).',
      });
    }

    const { channel, target } = parsed;
    const issued = store.issue(channel, target);

    if (!issued.ok) {
      return res.status(429).json({
        message: `Please wait ${issued.retryAfterSeconds}s before requesting another code.`,
        retryAfterSeconds: issued.retryAfterSeconds,
        channel,
        target,
      });
    }

    let delivery;
    try {
      delivery =
        channel === 'email'
          ? await notifier.sendEmailCode(target, issued.code)
          : await notifier.sendSmsCode(target, issued.code);
    } catch (sendError) {
      console.error('Verification send failed:', sendError.message);
      return res.status(502).json({
        message: `Could not send the ${channel} code: ${sendError.message}`,
        channel,
        target,
      });
    }

    const payload = {
      message:
        channel === 'email'
          ? `Verification code sent to ${target}.`
          : `Verification code sent to ${target}.`,
      channel,
      target,
      expiresInSeconds: issued.expiresInSeconds,
      delivered: delivery.delivered,
      provider: delivery.provider,
    };

    // Only when explicitly opted in (DEV_SHOW_CODES=true), and never in
    // production. Opting in returns the code even when a real provider
    // delivered it, which is what lets the automated suite exercise the whole
    // send → check → register flow.
    if (notifier.showCodes) {
      payload.devCode = issued.code;
      payload.message += ' (development mode: the code is in devCode)';
    }

    return res.json(payload);
  } catch (error) {
    console.error('Send code error:', error);
    return res.status(500).json({ message: 'Server error sending the verification code' });
  }
};

// @desc    Check a verification code and receive a short-lived proof token
// @route   POST /api/auth/verification/check
// @access  Public
const checkCode = async (req, res) => {
  try {
    const parsed = parseTarget(req.body.target || req.body.identifier || req.body.email || req.body.phone);
    if (!parsed) {
      return res.status(400).json({ message: 'Enter a valid email address or phone number.' });
    }

    const code = String(req.body.code || '').trim();
    if (!/^[0-9]{6}$/.test(code)) {
      return res.status(400).json({ message: 'Enter the 6-digit code.' });
    }

    const result = store.check(parsed.channel, parsed.target, code);
    if (!result.ok) {
      const status = result.reason === 'too_many_attempts' ? 429 : 400;
      return res.status(status).json({
        message: notifier.reasonMessages[result.reason] || 'Verification failed.',
        reason: result.reason,
      });
    }

    return res.json({
      verified: true,
      channel: parsed.channel,
      target: parsed.target,
      verificationToken: issueVerificationToken(parsed.channel, parsed.target),
    });
  } catch (error) {
    console.error('Check code error:', error);
    return res.status(500).json({ message: 'Server error verifying the code' });
  }
};

module.exports = {
  sendCode,
  checkCode,
  parseTarget,
  readVerificationToken,
  normalizePhone,
};
