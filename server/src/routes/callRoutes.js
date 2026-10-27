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
  getCallState,
} = require('../controllers/callController');
const { reportCallQuality } = require('../controllers/callQualityController');

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

/*
 * Call-quality reports are fire-and-forget telemetry (see
 * controllers/callQualityController.js): max 5 per user per minute. This limiter
 * is deliberately NOT skipped when AUTH_RATE_LIMIT_DISABLED=true — the limit is
 * part of the endpoint contract and the integration test asserts it. In-memory
 * is fine: a restart only forgets a few counters.
 */
const QUALITY_WINDOW_MS = 60_000;
const QUALITY_MAX_PER_WINDOW = 5;
const qualityHits = new Map(); // userId -> { count, startedAt }

function callQualityLimiter(req, res, next) {
  const key = String((req.user && req.user._id) || req.ip || 'anonymous');
  const now = Date.now();
  if (qualityHits.size > 5000) {
    for (const [entryKey, entry] of qualityHits) {
      if (now - entry.startedAt >= QUALITY_WINDOW_MS) qualityHits.delete(entryKey);
    }
  }
  const entry = qualityHits.get(key);
  if (!entry || now - entry.startedAt >= QUALITY_WINDOW_MS) {
    qualityHits.set(key, { count: 1, startedAt: now });
    return next();
  }
  entry.count += 1;
  if (entry.count > QUALITY_MAX_PER_WINDOW) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.startedAt + QUALITY_WINDOW_MS - now) / 1000));
    res.set('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({
      message: 'Too many call quality reports. Try again in a minute.',
      code: 'CALL_QUALITY_RATE_LIMITED',
      retryAfterSeconds,
    });
  }
  return next();
}

router.use(protect);

router.get('/ice', iceLimiter, getIceServers);
// Content-free stalled-call diagnostics for the admin Inbox (TURN unreachable).
router.post('/quality', callQualityLimiter, reportCallQuality);
// Live room state (discover/join an ongoing call; chunk 2).
router.get('/state', historyLimiter, getCallState);
router.get('/missed-count', historyLimiter, missedCount);
router.get('/contacts', historyLimiter, callContacts);
router.get('/groups', historyLimiter, callGroups);
router.post('/seen', historyLimiter, markCallsSeen);
router.get('/', historyLimiter, listCalls);
router.delete('/', historyLimiter, clearCalls);
router.delete('/:id', historyLimiter, deleteCall);

module.exports = router;
