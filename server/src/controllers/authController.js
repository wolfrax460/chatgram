// Auth controller
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { parseTarget, readVerificationToken } = require('./verificationController');
const store = require('../utils/verificationStore');
// Password resets use their own hashed, single-use, 15-minute tokens.
const resetStore = require('../utils/resetTokenStore');
const notifier = require('../utils/notifier');
const { validatePassword } = require('../utils/passwordPolicy');

const ACCESS_SECRET = () => process.env.JWT_SECRET || 'your-secret-key';
const REFRESH_SECRET = () => process.env.JWT_REFRESH_SECRET || 'your-refresh-secret';

/**
 * `tv` (token version) lets one bump invalidate every existing session.
 * Tokens issued before this feature existed have no `tv`; they are treated as
 * version 0 so a deploy does not sign the world out.
 */
const tokenVersionOf = (user) => Number(user && user.tokenVersion) || 0;
const { assertAccountActive } = require('../utils/accountStatus');

const generateToken = (userId, tokenVersion = 0) =>
  jwt.sign({ userId, tv: Number(tokenVersion) || 0 }, ACCESS_SECRET(), {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  });

const generateRefreshToken = (userId, tokenVersion = 0) =>
  jwt.sign({ userId, tv: Number(tokenVersion) || 0 }, REFRESH_SECRET(), {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  });

/** Set REQUIRE_VERIFICATION=true to require a verified email/phone to register. */
const verificationRequired = () =>
  String(process.env.REQUIRE_VERIFICATION || 'false') === 'true';

/**
 * Resolve the sign-up / sign-in identifier into a normalized email or phone.
 * Accepts `identifier`, or explicit `email` / `phone` / `target` fields.
 */
const resolveIdentifier = (body) => {
  const raw = body.identifier || body.email || body.phone || body.target;
  return parseTarget(raw);
};

const userPayload = (user, accessToken, refreshToken) => ({
  user: {
    id: user._id.toString(),
    _id: user._id.toString(),
    phone: user.phone || null,
    email: user.email || null,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl || '',
    about: user.about || '',
    isOnline: user.isOnline,
    lastSeen: user.lastSeen,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  },
  accessToken,
  refreshToken,
});

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res) => {
  try {
    const safety = require('../middleware/safety');
    const throttle = await safety.checkSignup(req);
    if (throttle) return res.status(throttle.status).json(throttle.body);
    const settings = await require('../utils/platformSettings').get();
    if (!settings.registrationEnabled) {
      return res.status(403).json({ message: 'New account creation is temporarily disabled.', code: 'REGISTRATION_DISABLED' });
    }
  } catch (gateError) {
    console.error('Registration gate error:', gateError.message);
  }
  try {
    const { password, displayName, verificationToken } = req.body;

    if (!displayName || !String(displayName).trim()) {
      return res.status(400).json({ message: 'Display name is required' });
    }
    if (String(displayName).trim().length < 2) {
      return res.status(400).json({ message: 'Display name must be at least 2 characters' });
    }

    const parsed = resolveIdentifier(req.body);
    if (!parsed) {
      return res.status(400).json({
        message:
          'Enter a valid email address, or a phone number with country code (e.g. +250780000001).',
        code: 'INVALID_IDENTIFIER',
      });
    }

    if (!password || String(password).length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    // Safety: blocked email domains cannot register.
    if (parsed.channel === 'email') {
      const safetySettings = await require('../utils/platformSettings').get();
      const domain = String(parsed.target || '').split('@')[1] ? String(parsed.target).split('@')[1].toLowerCase() : '';
      const blocked = (safetySettings.blockedEmailDomains || []).find((entry) => domain === entry || domain.endsWith('.' + entry));
      if (blocked) {
        return res.status(403).json({
          message: 'Sign-ups from this email domain are not accepted.',
          code: 'EMAIL_DOMAIN_BLOCKED',
        });
      }
    }

    // Optional gate: only accept sign-ups whose email/phone was verified.
    if (verificationRequired()) {
      const proof = readVerificationToken(verificationToken);
      if (!proof || proof.target !== parsed.target) {
        return res.status(403).json({
          message: 'Verify your email address or phone number before creating an account.',
          code: 'VERIFICATION_REQUIRED',
        });
      }
    }

    const identifierFilter =
      parsed.channel === 'email' ? { email: parsed.target } : { phone: parsed.target };

    const existingUser = await User.findOne(identifierFilter);
    if (existingUser) {
      return res.status(400).json({
        message: `An account already exists with this ${parsed.channel === 'email' ? 'email' : 'phone number'}`,
      });
    }

    const user = await User.create({
      ...identifierFilter,
      password,
      displayName: String(displayName).trim(),
      lastSeen: new Date(),
    });


    // Two-factor gate: the password was correct, now a TOTP code is required.
    if (user.twoFactorEnabled) {
      const { verifyCode } = require('./twoFactorController');
      const { decrypt } = require('./twoFactorController');
      const provided = req.body.totp || req.body.token2fa || req.body.code2fa;
      if (!provided) {
        return res.status(401).json({
          message: 'Enter the 6-digit code from your authenticator app.',
          code: 'TOTP_REQUIRED',
        });
      }
      const withSecret = await User.findById(user._id).select('+twoFactorSecret');
      const totpOk = verifyCode(decrypt(withSecret?.twoFactorSecret), provided);
      if (!totpOk) {
        // A backup code works exactly once, then it is consumed.
        const { consumeRecoveryCode } = require('./twoFactorController');
        const recoveryOk = await consumeRecoveryCode(user._id, provided);
        if (!recoveryOk) {
          return res.status(401).json({
            message: 'That code is not correct.',
            code: 'TOTP_INVALID',
          });
        }
      }
    }

    try { require('../middleware/safety').recordSignup(req); } catch (safetyError) { console.warn('Signup counter failed:', safetyError.message); }

    const accessToken = generateToken(user._id, tokenVersionOf(user));
    const refreshToken = generateRefreshToken(user._id, tokenVersionOf(user));

    return res.status(201).json(userPayload(user, accessToken, refreshToken));
  } catch (error) {
    console.error('Registration error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'An account already exists with this email or phone' });
    }
    return res.status(500).json({ message: 'Server error during registration' });
  }
};

// @desc    Authenticate user & get token
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
  try {
    const { password } = req.body;

    const parsed = resolveIdentifier(req.body);
    if (!parsed) {
      return res.status(400).json({
        message: 'Enter a valid email address or phone number.',
        code: 'INVALID_IDENTIFIER',
      });
    }
    if (!password) {
      return res.status(400).json({ message: 'Password is required' });
    }

    const filter =
      parsed.channel === 'email' ? { email: parsed.target } : { phone: parsed.target };

    // `password` is `select: false` on the schema, so opt back in here.
    const user = await User.findOne(filter).select('+password');

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const loginBlocked = await assertAccountActive(user);
    if (loginBlocked) {
      return res.status(403).json({ message: loginBlocked.message, code: loginBlocked.code });
    }

    // Two-factor gate: the password was correct, now a TOTP code is required.
    if (user.twoFactorEnabled) {
      const { verifyCode } = require('./twoFactorController');
      const { decrypt } = require('./twoFactorController');
      const provided = req.body.totp || req.body.token2fa || req.body.code2fa;
      if (!provided) {
        return res.status(401).json({
          message: 'Enter the 6-digit code from your authenticator app.',
          code: 'TOTP_REQUIRED',
        });
      }
      const withSecret = await User.findById(user._id).select('+twoFactorSecret');
      const totpOk = verifyCode(decrypt(withSecret?.twoFactorSecret), provided);
      if (!totpOk) {
        // A backup code works exactly once, then it is consumed.
        const { consumeRecoveryCode } = require('./twoFactorController');
        const recoveryOk = await consumeRecoveryCode(user._id, provided);
        if (!recoveryOk) {
          return res.status(401).json({
            message: 'That code is not correct.',
            code: 'TOTP_INVALID',
          });
        }
      }
    }

    const accessToken = generateToken(user._id, tokenVersionOf(user));
    const refreshToken = generateRefreshToken(user._id, tokenVersionOf(user));

    // 9b Users extras: record the device session and login history (no tokens).
    try {
      const UserSession = require('../models/UserSession');
      const LoginEvent = require('../models/LoginEvent');
      const ip = String(req.ip || '').replace(/^::ffff:/i, '');
      const userAgent = String(req.headers?.['user-agent'] || '').slice(0, 300);
      const existing = await UserSession.findOne({
        userId: user._id,
        userAgent,
        revokedAt: null,
        lastSeenAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      });
      if (existing) {
        existing.lastSeenAt = new Date();
        existing.ip = ip || existing.ip;
        await existing.save();
      } else {
        await UserSession.create({ userId: user._id, ip, userAgent, deviceLabel: userAgent.slice(0, 80) });
      }
      await LoginEvent.create({ userId: user._id, ip, userAgent, method: 'password' });
    } catch (sessionError) {
      console.warn('Login session record failed:', sessionError.message);
    }

    // Do NOT mark the user online here: presence comes from live sockets.
    // Setting it on a REST login is what left flags stuck when the socket
    // never connected (or the process died before a clean disconnect).
    user.lastSeen = new Date();
    await user.save({ validateBeforeSave: false });

    return res.json(userPayload(user, accessToken, refreshToken));
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Server error during login' });
  }
};

// @desc    Check whether an email/phone is already registered
// @route   POST /api/auth/check-identifier
// @access  Public
const checkIdentifier = async (req, res) => {
  try {
    const parsed = resolveIdentifier(req.body);
    if (!parsed) {
      return res.status(400).json({ message: 'Enter a valid email address or phone number.' });
    }
    const filter =
      parsed.channel === 'email' ? { email: parsed.target } : { phone: parsed.target };
    const exists = await User.exists(filter);
    return res.json({ channel: parsed.channel, target: parsed.target, available: !exists });
  } catch (error) {
    console.error('Check identifier error:', error);
    return res.status(500).json({ message: 'Server error checking the identifier' });
  }
};

// @desc    Refresh access token (rotates the refresh token too)
// @route   POST /api/auth/refresh
// @access  Public
const refreshToken = async (req, res) => {
  try {
    const token = req.body.token || req.body.refreshToken;

    if (!token) {
      return res.status(401).json({ message: 'Refresh token is required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, REFRESH_SECRET());
    } catch (error) {
      return res.status(401).json({
        message: 'Invalid refresh token',
        code: error.name === 'TokenExpiredError' ? 'REFRESH_EXPIRED' : 'REFRESH_INVALID',
      });
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // A token from before the latest password change / "log out other devices"
    // must not be able to mint fresh tokens.
    const refreshBlocked = await assertAccountActive(user);
    if (refreshBlocked) {
      return res.status(403).json({ message: refreshBlocked.message, code: refreshBlocked.code });
    }

    if ((Number(decoded.tv) || 0) !== tokenVersionOf(user)) {
      return res.status(401).json({
        message: 'This session was signed out. Please sign in again.',
        code: 'SESSION_REVOKED',
      });
    }

    // 9b: a token refresh keeps the device session's last-seen fresh.
    try {
      await require('../models/UserSession').updateOne(
        { userId: user._id, revokedAt: null },
        { $set: { lastSeenAt: new Date() } },
        { sort: { lastSeenAt: -1 } },
      ).catch(() => {});
    } catch (sessionError) {
      console.warn('Refresh session touch failed:', sessionError.message);
    }

    // Rotate both tokens so a long-lived session can keep refreshing.
    return res.json({
      accessToken: generateToken(user._id, tokenVersionOf(user)),
      refreshToken: generateRefreshToken(user._id, tokenVersionOf(user)),
      user: userPayload(user, null, null).user,
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    return res.status(500).json({ message: 'Server error during token refresh' });
  }
};

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
const getUserProfile = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authorized' });
    }
    return res.json(req.user);
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({ message: 'Server error fetching profile' });
  }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
const logoutUser = async (req, res) => {
  try {
    if (req.user) {
      await User.findByIdAndUpdate(req.user._id, {
        isOnline: false,
        lastSeen: new Date(),
      });
    }
    return res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ message: 'Server error during logout' });
  }
};

// @desc    Start a password reset by sending a code to the email/phone
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
  const startedAt = Date.now();
  try {
    const parsed = resolveIdentifier(req.body);
    if (!parsed) {
      return res.status(400).json({
        message: 'Enter a valid email address or phone number.',
        code: 'INVALID_IDENTIFIER',
      });
    }

    // AUTH_REVEAL_ACCOUNT_EXISTS=true (the current product decision) tells the
    // user whether the address is registered. `false` restores the
    // anti-enumeration behaviour: identical message and response time for both
    // cases, and no `exists` field.
    const reveal = String(process.env.AUTH_REVEAL_ACCOUNT_EXISTS ?? 'true') !== 'false';
    const minimumMs = reveal ? 0 : 700;
    const finish = async (payload) => {
      const wait = minimumMs - (Date.now() - startedAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      return res.json(payload);
    };

    const filter =
      parsed.channel === 'email' ? { email: parsed.target } : { phone: parsed.target };
    const user = await User.findOne(filter);

    // Same answer for both cases, so this endpoint cannot be used to discover
    // which addresses have accounts.
    const genericReply = {
      message: `If an account exists for ${parsed.target}, a reset code has been sent.`,
      channel: parsed.channel,
      target: parsed.target,
    };

    if (!user) return finish(reveal ? { ...genericReply, exists: false } : genericReply);

    const issued = resetStore.issue(parsed.channel, parsed.target);
    if (!issued.ok) {
      return res.status(429).json({
        message: `Please wait ${issued.retryAfterSeconds}s before requesting another code.`,
        retryAfterSeconds: issued.retryAfterSeconds,
      });
    }

    let delivery;
    try {
      delivery =
        parsed.channel === 'email'
          ? await notifier.sendEmailCode(parsed.target, issued.code)
          : await notifier.sendSmsCode(parsed.target, issued.code);
    } catch (sendError) {
      console.error('Reset code send failed:', sendError.message);
      return res.status(502).json({
        message: `Could not send the reset code: ${sendError.message}`,
      });
    }

    const payload = reveal
      ? {
          ...genericReply,
          exists: true,
          expiresInSeconds: issued.expiresInSeconds,
          delivered: delivery.delivered,
          provider: delivery.provider,
        }
      : genericReply;

    if (notifier.showCodes) {
      payload.devCode = issued.code;
      payload.message += ' (development mode: the code is in devCode)';
    }

    return finish(payload);
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ message: 'Server error starting the password reset' });
  }
};

// @desc    Finish a password reset with the emailed/texted code
// @route   POST /api/auth/reset-password
// @access  Public
const resetPassword = async (req, res) => {
  try {
    const parsed = resolveIdentifier(req.body);
    if (!parsed) {
      return res.status(400).json({ message: 'Enter a valid email address or phone number.' });
    }

    const code = String(req.body.code || '').trim();
    if (!/^[0-9]{6}$/.test(code)) {
      return res.status(400).json({ message: 'Enter the 6-digit code.' });
    }

    const newPassword = req.body.newPassword || req.body.password;
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    const result = resetStore.check(parsed.channel, parsed.target, code);
    if (!result.ok) {
      const status = result.reason === 'too_many_attempts' ? 429 : 400;
      return res.status(status).json({
        message: notifier.reasonMessages[result.reason] || 'That code is not valid.',
        reason: result.reason,
      });
    }

    const filter =
      parsed.channel === 'email' ? { email: parsed.target } : { phone: parsed.target };
    const user = await User.findOne(filter).select('+password');
    if (!user) {
      // The code was valid but the account disappeared.
      return res.status(400).json({ message: 'That account no longer exists.' });
    }

    // Assigning triggers the pre-save hook, which re-hashes the password.
    // Bump the token version so every session that existed before the reset is
    // signed out — a reset is usually a response to a compromised account.
    user.password = String(newPassword);
    user.passwordChangedAt = new Date();
    user.tokenVersion = tokenVersionOf(user) + 1;
    await user.save();

    return res.json({ message: 'Password updated. You can sign in now.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ message: 'Server error resetting the password' });
  }
};

/* --------------------------------------------- change password (signed in) */

// Per-account throttle for "current password" guesses. The per-IP limiter is in
// authRoutes; this one follows the account so it works behind a shared NAT.
const MAX_CURRENT_FAILURES = 5;
const CURRENT_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const pwdFailures = new Map(); // userId -> { count, firstAt, until }

function currentPasswordState(userId) {
  const now = Date.now();
  const key = String(userId);
  const entry = pwdFailures.get(key);
  if (!entry) return { count: 0, retryAfter: 0 };
  if (entry.until > now) return { count: entry.count, retryAfter: Math.ceil((entry.until - now) / 1000) };
  if (now - entry.firstAt > CURRENT_FAILURE_WINDOW_MS) {
    pwdFailures.delete(key);
    return { count: 0, retryAfter: 0 };
  }
  return { count: entry.count, retryAfter: 0 };
}

function recordCurrentFailure(userId) {
  const now = Date.now();
  const key = String(userId);
  let entry = pwdFailures.get(key);
  if (!entry || now - entry.firstAt > CURRENT_FAILURE_WINDOW_MS) {
    entry = { count: 0, firstAt: now, until: 0 };
  }
  entry.count += 1;
  if (entry.count >= MAX_CURRENT_FAILURES) entry.until = now + CURRENT_FAILURE_WINDOW_MS;
  pwdFailures.set(key, entry);
  if (pwdFailures.size > 5000) {
    for (const [k, v] of pwdFailures) {
      if (v.until < now && now - v.firstAt > CURRENT_FAILURE_WINDOW_MS) pwdFailures.delete(k);
      if (pwdFailures.size <= 5000) break;
    }
  }
}

// @desc    Change the password of the signed-in account
// @route   POST /api/auth/change-password
// @access  Private
const changePassword = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    const state = currentPasswordState(req.user._id);
    if (state.retryAfter > 0) {
      res.set('Retry-After', String(state.retryAfter));
      return res.status(429).json({
        message: `Too many incorrect current-password attempts. Try again in ${state.retryAfter}s.`,
        code: 'RATE_LIMITED',
        retryAfter: state.retryAfter,
      });
    }

    const body = req.body || {};
    const currentPassword = String(body.currentPassword ?? body.oldPassword ?? '');
    const newPassword = String(body.newPassword ?? body.password ?? '');
    const hasConfirm = body.confirmPassword !== undefined && body.confirmPassword !== null;
    const confirmPassword = hasConfirm ? String(body.confirmPassword) : null;

    const user = await User.findById(req.user._id).select('+password');
    if (!user) {
      return res.status(401).json({ message: 'This account no longer exists.' });
    }

    // Google-only accounts have no local password yet. They can create one via
    // the reset flow, which verifies ownership through their email.
    if (!user.password) {
      return res.status(400).json({
        message:
          'Your account signs in with Google and has no password yet. Use "Forgot password" to set one.',
        code: 'PASSWORD_NOT_SET',
      });
    }

    if (!currentPassword) {
      return res.status(400).json({
        message: 'Enter your current password.',
        code: 'CURRENT_PASSWORD_REQUIRED',
      });
    }

    const matches = await user.comparePassword(currentPassword);
    if (!matches) {
      recordCurrentFailure(user._id);
      const next = currentPasswordState(user._id);
      if (next.retryAfter > 0) {
        res.set('Retry-After', String(next.retryAfter));
        return res.status(429).json({
          message: `Too many incorrect current-password attempts. Try again in ${next.retryAfter}s.`,
          code: 'RATE_LIMITED',
          retryAfter: next.retryAfter,
        });
      }
      return res.status(400).json({
        message: 'Your current password is not correct.',
        code: 'CURRENT_PASSWORD_INVALID',
      });
    }

    if (hasConfirm && confirmPassword !== newPassword) {
      return res.status(400).json({
        message: 'The new passwords do not match.',
        code: 'PASSWORD_MISMATCH',
      });
    }

    const policy = validatePassword(newPassword);
    if (!policy.ok) {
      return res.status(400).json({
        message: policy.problems[0] || 'Choose a stronger password.',
        problems: policy.problems,
        code: policy.code,
        strength: policy.strength,
      });
    }

    if (await user.comparePassword(newPassword)) {
      return res.status(400).json({
        message: 'Your new password must be different from your current one.',
        code: 'PASSWORD_UNCHANGED',
      });
    }

    // Assigning triggers the pre-save hook, which re-hashes the password.
    user.password = newPassword;
    user.passwordChangedAt = new Date();
    // Bump the session generation: every other device's access and refresh
    // tokens stop working. This request gets fresh tokens below, so the device
    // that made the change stays signed in.
    user.tokenVersion = tokenVersionOf(user) + 1;
    await user.save();

    pwdFailures.delete(String(user._id));

    // Tell the owner out-of-band. Never fail the password change because the
    // mail server is unhappy.
    let notified = { email: false, channel: null };
    try {
      notified = await notifier.notifyPasswordChanged(user);
    } catch (notifyError) {
      console.error('Password-changed notice failed:', notifyError.message);
    }

    const accessToken = generateToken(user._id, tokenVersionOf(user));
    const refreshToken = generateRefreshToken(user._id, tokenVersionOf(user));

    return res.json({
      message: 'Password changed. Other devices have been signed out.',
      accessToken,
      refreshToken,
      tokenVersion: tokenVersionOf(user),
      notified,
    });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ message: 'Server error changing the password' });
  }
};

/* ---------------------------------------------- account settings (signed in) */

/**
 * POST /api/auth/account/identifier/request
 * Ask for a verification code for a NEW email/phone. Signed in only.
 */
const requestIdentifierChange = async (req, res) => {
  try {
    const parsed = resolveIdentifier(req.body);
    if (!parsed) {
      return res.status(400).json({
        message: 'Enter a valid email address, or a phone number with country code (e.g. +250780000001).',
        code: 'INVALID_IDENTIFIER',
      });
    }

    const filter = parsed.channel === 'email' ? { email: parsed.target } : { phone: parsed.target };
    const existing = await User.findOne(filter).select('_id');
    if (existing && String(existing._id) !== String(req.user._id)) {
      return res.status(409).json({
        message: `That ${parsed.channel === 'email' ? 'email address' : 'phone number'} is already used by another account.`,
        code: 'IDENTIFIER_TAKEN',
      });
    }

    const issued = store.issue(parsed.channel, parsed.target);
    if (!issued.ok) {
      return res.status(429).json({
        message: `Please wait ${issued.retryAfterSeconds}s before requesting another code.`,
        retryAfterSeconds: issued.retryAfterSeconds,
        code: 'RATE_LIMITED',
      });
    }

    let delivery;
    try {
      delivery =
        parsed.channel === 'email'
          ? await notifier.sendEmailCode(parsed.target, issued.code)
          : await notifier.sendSmsCode(parsed.target, issued.code);
    } catch (sendError) {
      console.error('Identifier code send failed:', sendError.message);
      return res.status(502).json({ message: `Could not send the code: ${sendError.message}` });
    }

    const payload = {
      message: `We sent a code to ${parsed.target}.`,
      channel: parsed.channel,
      target: parsed.target,
      expiresInSeconds: issued.expiresInSeconds,
      delivered: delivery.delivered,
      provider: delivery.provider,
    };
    if (notifier.showCodes) payload.devCode = issued.code;
    return res.json(payload);
  } catch (error) {
    console.error('Request identifier change error:', error);
    return res.status(500).json({ message: 'Server error requesting the change' });
  }
};

/**
 * POST /api/auth/account/identifier/confirm
 * Verify the code and save the new email/phone. Requires the current password
 * for accounts that have one (a stolen session must not be able to swap the
 * recovery address silently).
 */
const confirmIdentifierChange = async (req, res) => {
  try {
    const parsed = resolveIdentifier(req.body);
    if (!parsed) {
      return res.status(400).json({ message: 'Enter a valid email address or phone number.', code: 'INVALID_IDENTIFIER' });
    }
    const code = String(req.body.code || '').trim();
    if (!/^[0-9]{6}$/.test(code)) {
      return res.status(400).json({ message: 'Enter the 6-digit code.', code: 'INVALID_CODE' });
    }

    const user = await User.findById(req.user._id).select('+password email phone displayName');
    if (!user) return res.status(401).json({ message: 'This account no longer exists.' });

    if (user.password) {
      const currentPassword = String(req.body.currentPassword ?? '');
      if (!currentPassword) {
        return res.status(400).json({ message: 'Enter your current password.', code: 'CURRENT_PASSWORD_REQUIRED' });
      }
      if (!(await user.comparePassword(currentPassword))) {
        return res.status(400).json({ message: 'Your current password is not correct.', code: 'CURRENT_PASSWORD_INVALID' });
      }
    }

    const checked = store.check(parsed.channel, parsed.target, code);
    if (!checked.ok) {
      const status = checked.reason === 'too_many_attempts' ? 429 : 400;
      return res.status(status).json({
        message: notifier.reasonMessages[checked.reason] || 'That code is not valid.',
        reason: checked.reason,
        code: 'INVALID_CODE',
      });
    }

    const filter = parsed.channel === 'email' ? { email: parsed.target } : { phone: parsed.target };
    const taken = await User.findOne(filter).select('_id');
    if (taken && String(taken._id) !== String(user._id)) {
      return res.status(409).json({ message: 'That address is already used by another account.', code: 'IDENTIFIER_TAKEN' });
    }

    const previousEmail = user.email;
    if (parsed.channel === 'email') user.email = parsed.target;
    else user.phone = parsed.target;

    // Changing the recovery identity signs out every other device.
    user.tokenVersion = tokenVersionOf(user) + 1;
    await user.save();

    let notified = { email: false, channel: null };
    try {
      if (parsed.channel === 'email') {
        const result = await notifier.sendMail({
          to: parsed.target,
          subject: 'Your Chatgram sign-in email was changed',
          text: `The sign-in email for your Chatgram account "${user.displayName}" is now ${parsed.target}. If this was not you, reset your password immediately.`,
        });
        notified = { email: result.delivered, channel: result.provider };
        if (previousEmail && previousEmail !== parsed.target) {
          await notifier.sendMail({
            to: previousEmail,
            subject: 'Your Chatgram sign-in email was changed',
            text: `The sign-in email for your Chatgram account is no longer ${previousEmail}. If this was not you, contact Chatgram support immediately.`,
          });
        }
      }
    } catch (notifyError) {
      console.warn('Identifier change notice failed:', notifyError.message);
    }

    return res.json({
      message:
        parsed.channel === 'email'
          ? 'Your email address was updated. Other devices have been signed out.'
          : 'Your phone number was updated. Other devices have been signed out.',
      accessToken: generateToken(user._id, tokenVersionOf(user)),
      refreshToken: generateRefreshToken(user._id, tokenVersionOf(user)),
      user: userPayload(user, null, null).user,
      notified,
    });
  } catch (error) {
    console.error('Confirm identifier change error:', error);
    return res.status(500).json({ message: 'Server error saving the change' });
  }
};

/**
 * POST /api/auth/logout-others
 * Sign out every other device (bumps the session generation, returns tokens for
 * this one). Works for every client, including native.
 */
const logoutOtherSessions = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('+password');
    if (!user) return res.status(401).json({ message: 'This account no longer exists.' });

    if (user.password) {
      const currentPassword = String((req.body || {}).currentPassword ?? '');
      if (!currentPassword) {
        return res.status(400).json({ message: 'Enter your current password.', code: 'CURRENT_PASSWORD_REQUIRED' });
      }
      if (!(await user.comparePassword(currentPassword))) {
        return res.status(400).json({ message: 'Your current password is not correct.', code: 'CURRENT_PASSWORD_INVALID' });
      }
    }

    user.tokenVersion = tokenVersionOf(user) + 1;
    await user.save();

    return res.json({
      message: 'Every other device has been signed out.',
      accessToken: generateToken(user._id, tokenVersionOf(user)),
      refreshToken: generateRefreshToken(user._id, tokenVersionOf(user)),
    });
  } catch (error) {
    console.error('Logout other sessions error:', error);
    return res.status(500).json({ message: 'Server error signing out the other devices' });
  }
};

/**
 * DELETE /api/auth/account
 * Permanently delete the account and its data. Requires the password (when the
 * account has one) AND the literal word DELETE.
 */
const deleteAccount = async (req, res) => {
  try {
    const body = req.body || {};
    if (String(body.confirmation || '').trim().toUpperCase() !== 'DELETE') {
      return res.status(400).json({
        message: 'Type DELETE to confirm that you want to delete your account.',
        code: 'CONFIRM_REQUIRED',
      });
    }

    const user = await User.findById(req.user._id).select('+password displayName email');
    if (!user) return res.status(401).json({ message: 'This account no longer exists.' });

    if (user.password) {
      const password = String(body.password ?? '');
      if (!password) {
        return res.status(400).json({ message: 'Enter your password to delete the account.', code: 'PASSWORD_REQUIRED' });
      }
      if (!(await user.comparePassword(password))) {
        return res.status(400).json({ message: 'Your password is not correct.', code: 'CURRENT_PASSWORD_INVALID' });
      }
    }

    const userId = user._id;
    await require('../utils/accountDeletion').deleteAccountData(userId, user.displayName);

    return res.json({ message: 'Your Chatgram account has been deleted.' });
  } catch (error) {
    console.error('Delete account error:', error);
    return res.status(500).json({ message: 'Server error deleting the account' });
  }
};

module.exports = {
  registerUser,
  loginUser,
  refreshToken,
  getUserProfile,
  logoutUser,
  checkIdentifier,
  forgotPassword,
  resetPassword,
  changePassword,
  requestIdentifierChange,
  confirmIdentifierChange,
  logoutOtherSessions,
  deleteAccount,
  // Shared with the Google sign-in flow.
  generateToken,
  generateRefreshToken,
  userPayload,
  tokenVersionOf,
};
