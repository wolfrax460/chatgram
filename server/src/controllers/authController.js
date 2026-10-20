// Auth controller
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { parseTarget, readVerificationToken } = require('./verificationController');
const store = require('../utils/verificationStore');
// Password resets use their own hashed, single-use, 15-minute tokens.
const resetStore = require('../utils/resetTokenStore');
const notifier = require('../utils/notifier');

const ACCESS_SECRET = () => process.env.JWT_SECRET || 'your-secret-key';
const REFRESH_SECRET = () => process.env.JWT_REFRESH_SECRET || 'your-refresh-secret';

const generateToken = (userId) =>
  jwt.sign({ userId }, ACCESS_SECRET(), {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  });

const generateRefreshToken = (userId) =>
  jwt.sign({ userId }, REFRESH_SECRET(), {
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

    const accessToken = generateToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

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

    const accessToken = generateToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    user.lastSeen = new Date();
    user.isOnline = true;
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

    // Rotate both tokens so a long-lived session can keep refreshing.
    return res.json({
      accessToken: generateToken(user._id),
      refreshToken: generateRefreshToken(user._id),
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
  try {
    const parsed = resolveIdentifier(req.body);
    if (!parsed) {
      return res.status(400).json({
        message: 'Enter a valid email address or phone number.',
        code: 'INVALID_IDENTIFIER',
      });
    }

    const filter =
      parsed.channel === 'email' ? { email: parsed.target } : { phone: parsed.target };
    const user = await User.findOne(filter);

    // Always answer the same way, so this endpoint cannot be used to discover
    // which addresses have accounts.
    const genericReply = {
      message: `If an account exists for ${parsed.target}, a reset code has been sent.`,
      channel: parsed.channel,
      target: parsed.target,
    };

    if (!user) return res.json({ ...genericReply, exists: false });

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

    const payload = {
      ...genericReply,
      exists: true,
      expiresInSeconds: issued.expiresInSeconds,
      delivered: delivery.delivered,
      provider: delivery.provider,
    };

    if (notifier.showCodes) {
      payload.devCode = issued.code;
      payload.message += ' (development mode: the code is in devCode)';
    }

    return res.json(payload);
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
    user.password = String(newPassword);
    await user.save();

    return res.json({ message: 'Password updated. You can sign in now.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ message: 'Server error resetting the password' });
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
  // Shared with the Google sign-in flow.
  generateToken,
  generateRefreshToken,
  userPayload,
};
