// Call configuration and history routes.
//
// Media never touches the server: only SDP/ICE payloads are forwarded over the
// authenticated socket. These routes expose ICE configuration (with ephemeral
// TURN credentials), call history, the missed-call badge and small helpers for
// the Calls tab.
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getIceServers,
  listCalls,
  missedCount,
  markCallsSeen,
  deleteCall,
  clearCalls,
  callContacts,
  callGroups,
} = require('../controllers/callController');

const isTest = process.env.NODE_ENV === 'test' || process.env.AUTH_RATE_LIMIT_DISABLED === 'true';

const iceLimiter = rateLimit({
  windowMs: 60_000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: { message: 'Too many call setup attempts. Wait a minute and try again.', code: 'CALL_RATE_LIMITED' },
});

const historyLimiter = rateLimit({
  windowMs: 60_000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: { message: 'Too many requests.' },
});

router.use(protect);

router.get('/ice', iceLimiter, getIceServers);
router.get('/missed-count', historyLimiter, missedCount);
router.get('/contacts', historyLimiter, callContacts);
router.get('/groups', historyLimiter, callGroups);
router.post('/seen', historyLimiter, markCallsSeen);
router.get('/', historyLimiter, listCalls);
router.delete('/', historyLimiter, clearCalls);
router.delete('/:id', historyLimiter, deleteCall);

module.exports = router;
