// Push notification device registration + a self-test push.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/auth');
const notificationController = require('../controllers/notificationController');

const router = express.Router();

const isTest = process.env.NODE_ENV === 'test' || process.env.AUTH_RATE_LIMIT_DISABLED === 'true';

const deviceLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: { message: 'Too many device requests. Try again in a minute.' },
});

const testLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: { message: 'Too many test notifications. Try again in a minute.' },
});

router.use(protect);

router.post('/devices', deviceLimiter, notificationController.registerDevice);
router.delete('/devices', deviceLimiter, notificationController.unregisterDevice);
router.post('/devices/test', testLimiter, notificationController.sendTestPush);

module.exports = router;
