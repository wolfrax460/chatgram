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

// Public routes
router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/refresh', refreshToken);

// Is this email/phone already taken?
router.post('/check-identifier', checkIdentifier);

// Email verification / phone OTP
router.post('/verification/send', sendCode);
router.post('/verification/check', checkCode);

// Password reset
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Sign in with Google (authorization-code flow, browser + poll)
router.get('/google/url', googleAuthUrl);
router.get('/google/callback', googleCallback);
router.get('/google/poll', googlePoll);

// Protected routes (need auth middleware)
router.get('/me', protect, getUserProfile);
router.post('/logout', protect, logoutUser);

module.exports = router;
