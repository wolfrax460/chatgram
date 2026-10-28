// Email verification / phone OTP
const jwt = require('jsonwebtoken');
const store = require('../utils/verificationStore');
const notifier = require('../utils/notifier');

const SECRET = () => process.env.JWT_SECRET || 'your-secret-key';
// The proof token deliberately outlives the code (30m vs the code's 15m): the
// user may verify and then finish registration a little later. The token is not
// what users experience as "expired", so keep it long and do not couple it to
// the code lifetime.
const TOKEN_TTL = '30m';

/**
 * One response shape for every failed code check, so the client can tell
 * expired / wrong / too-many-attempts apart and show the right action instead
 * of a generic "invalid code". `canResend` means "offer the Send again button".
 */
const CODE_FAILURES = {
  missing: { status: 400, code: 'CODE_MISSING', canResend: true },
  expired: { status: 400, code: 'CODE_EXPIRED', canResend: true },
  invalid: { status: 400, code: 'CODE_INVALID', canResend: false },
  too_many_attempts: { status: 429, code: 'CODE_TOO_MANY_ATTEMPTS', canResend: true },
};

function codeFailureBody(reason) {
  const failure = CODE_FAILURES[reason] || CODE_FAILURES.invalid;
  return {
    status: failure.status,
    body: {
      message: notifier.reasonMessages[reason] || 'Verification failed.',
      reason: reason in CODE_FAILURES ? reason : 'invalid',
      code: failure.code,
      canResend: failure.canResend,
    },
  };
}

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
    const issued = await store.issue(channel, target);

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

    // Codes are digits, zero-padded to six: "012345" and a JSON number 12345
    // (which drops the leading zero) are the same code.
    const code = store.normalizeCode(req.body.code);
    if (!code) {
      return res.status(400).json({ message: 'Enter the 6-digit code.' });
    }

    const result = await store.check(parsed.channel, parsed.target, code);
    if (!result.ok) {
      // Content-free diagnostic (never the target or the code): makes future
      // "the code does not work" reports measurable in the PM2 log.
      console.warn(`[otp] check failed reason=${result.reason} channel=${parsed.channel}`);
      const { status, body } = codeFailureBody(result.reason);
      return res.status(status).json(body);
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
  codeFailureBody,
};
