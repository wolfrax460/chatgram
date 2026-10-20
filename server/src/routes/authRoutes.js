// Auth routes
const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginUser,
  refreshToken,
  getUserProfile,
  logoutUser,
  checkIdentifier,
  forgotPassword,
  resetPassword,
} = require('../controllers/authController');
const { sendCode, checkCode } = require('../controllers/verificationController');
const {
  googleAuthUrl,
  googleCallback,
  googlePoll,
} = require('../controllers/googleAuthController');
const { protect } = require('../middleware/auth');
const {
  setupTwoFactor,
  enableTwoFactor,
  disableTwoFactor,
  twoFactorStatus,
} = require('../controllers/twoFactorController');
const {
  loginLimiter,
  signupLimiter,
  resetLimiter,
  verifyLimiter,
  accountLockout,
} = require('../middleware/authLimiter');

// Public routes
router.post('/register', signupLimiter, registerUser);
router.post('/login', loginLimiter, accountLockout, loginUser);
router.post('/refresh', refreshToken);

// Is this email/phone already taken?
router.post('/check-identifier', checkIdentifier);

// Email verification / phone OTP
router.post('/verification/send', verifyLimiter, sendCode);
router.post('/verification/check', checkCode);

// Password reset
router.post('/forgot-password', resetLimiter, forgotPassword);
router.post('/reset-password', resetLimiter, resetPassword);

// Sign in with Google (authorization-code flow, browser + poll)
router.get('/google/url', googleAuthUrl);
router.get('/google/callback', googleCallback);
router.get('/google/poll', googlePoll);

// Protected routes (need auth middleware)
router.get('/me', protect, getUserProfile);
router.post('/logout', protect, logoutUser);

// Two-factor authentication
router.get('/2fa/status', protect, twoFactorStatus);
router.post('/2fa/setup', protect, setupTwoFactor);
router.post('/2fa/enable', protect, enableTwoFactor);
router.post('/2fa/disable', protect, disableTwoFactor);

module.exports = router;
