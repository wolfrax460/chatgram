/**
 * TOTP two-factor authentication.
 *
 *   POST /api/auth/2fa/setup    (auth) -> secret + otpauth URL + QR data URL
 *   POST /api/auth/2fa/enable   (auth) { token } -> turns 2FA on
 *   POST /api/auth/2fa/disable  (auth) { token } -> turns 2FA off
 *
 * The secret is encrypted at rest with AES-256-GCM using a key derived from
 * JWT_SECRET, and is `select: false` so it never leaks through user payloads.
 * Login (authController.loginUser) requires a valid code when 2FA is enabled.
 */
const crypto = require('node:crypto');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');

const User = require('../models/User');

const ISSUER = 'Chatgram';
const APP_NAME = process.env.APP_NAME || 'Chatgram';

function key() {
  const base = process.env.TOTP_ENCRYPTION_KEY || process.env.JWT_SECRET || 'chatgram-totp';
  return crypto.createHash('sha256').update(base).digest();
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

function decrypt(payload) {
  try {
    const [ivB64, tagB64, dataB64] = String(payload).split('.');
    if (!ivB64 || !tagB64 || !dataB64) return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const out = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return out.toString('utf8');
  } catch {
    return '';
  }
}

/** Verify a 6-digit code, allowing one step of clock drift either way. */
function verifyCode(secret, token) {
  const code = String(token || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code) || !secret) return false;
  try {
    authenticator.options = { window: 1 };
    return authenticator.verify({ token: code, secret });
  } catch {
    return false;
  }
}

// @desc    Begin 2FA setup (returns a secret + QR code, does not enable yet)
// @route   POST /api/auth/2fa/setup
// @access  Private
const setupTwoFactor = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('+twoFactorSecret');
    if (!user) return res.status(404).json({ message: 'Account not found' });
    if (user.twoFactorEnabled) {
      return res.status(400).json({ message: 'Two-factor authentication is already enabled.' });
    }

    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(user.email || user.phone || String(user._id), ISSUER, secret);

    user.twoFactorSecret = encrypt(secret);
    await user.save({ validateBeforeSave: false });

    const qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 240 });
    return res.json({
      secret,
      otpauth,
      qr,
      issuer: APP_NAME,
      instructions: 'Scan the QR code with an authenticator app, then enter the 6-digit code to confirm.',
    });
  } catch (error) {
    console.error('2FA setup error:', error.message);
    return res.status(500).json({ message: 'Could not start two-factor setup.' });
  }
};

// @desc    Confirm and enable 2FA
// @route   POST /api/auth/2fa/enable
// @access  Private
const enableTwoFactor = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('+twoFactorSecret');
    if (!user) return res.status(404).json({ message: 'Account not found' });
    if (user.twoFactorEnabled) {
      return res.status(400).json({ message: 'Two-factor authentication is already enabled.' });
    }

    const secret = decrypt(user.twoFactorSecret);
    if (!secret) {
      return res.status(400).json({ message: 'Start the setup again — no pending secret was found.' });
    }
    if (!verifyCode(secret, req.body?.token)) {
      return res.status(400).json({ message: 'That code is not correct. Check your authenticator app.' });
    }

    user.twoFactorEnabled = true;
    await user.save({ validateBeforeSave: false });
    return res.json({ message: 'Two-factor authentication is on.', twoFactorEnabled: true });
  } catch (error) {
    console.error('2FA enable error:', error.message);
    return res.status(500).json({ message: 'Could not enable two-factor authentication.' });
  }
};

// @desc    Turn 2FA off (requires a current code)
// @route   POST /api/auth/2fa/disable
// @access  Private
const disableTwoFactor = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('+twoFactorSecret');
    if (!user) return res.status(404).json({ message: 'Account not found' });
    if (!user.twoFactorEnabled) {
      return res.status(400).json({ message: 'Two-factor authentication is not enabled.' });
    }

    const secret = decrypt(user.twoFactorSecret);
    if (!verifyCode(secret, req.body?.token)) {
      return res.status(400).json({ message: 'That code is not correct. Check your authenticator app.' });
    }

    user.twoFactorEnabled = false;
    user.twoFactorSecret = undefined;
    await user.save({ validateBeforeSave: false });
    return res.json({ message: 'Two-factor authentication is off.', twoFactorEnabled: false });
  } catch (error) {
    console.error('2FA disable error:', error.message);
    return res.status(500).json({ message: 'Could not disable two-factor authentication.' });
  }
};

// @desc    Current 2FA status for the signed-in account
// @route   GET /api/auth/2fa/status
// @access  Private
const twoFactorStatus = async (req, res) => {
  const user = await User.findById(req.user._id).select('twoFactorEnabled');
  return res.json({ twoFactorEnabled: Boolean(user?.twoFactorEnabled) });
};

module.exports = {
  setupTwoFactor,
  enableTwoFactor,
  disableTwoFactor,
  twoFactorStatus,
  verifyCode,
  encrypt,
  decrypt,
};
