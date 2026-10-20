/**
 * Auth hardening: rate limits + per-account lockout.
 *
 * Two independent layers:
 *
 *  1. Per-IP rate limits (express-rate-limit) — blunt protection against
 *     credential stuffing and scripted signups.
 *  2. Per-account lockout — counts consecutive failures for the same
 *     identifier and temporarily refuses further attempts, returning a
 *     `retryAfter` the UI already knows how to display.
 *
 * Layer 2 is implemented as wrapping `res.json`, so the auth controllers stay
 * untouched (they remain the single source of truth for what a failed login is).
 */
const rateLimit = require('express-rate-limit');

/* ------------------------------------------------------------- per-IP limits */

function limiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Health checks and same-origin server calls should not be throttled.
    skip: (req) => req.method === 'OPTIONS',
    handler: (req, res) => {
      const retryAfter = Math.ceil(windowMs / 1000);
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({ message, code: 'RATE_LIMITED', retryAfter });
    },
  });
}

const loginLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
});

const signupLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  max: 8,
  message: 'Too many accounts created from this connection. Please try again later.',
});

const resetLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  max: 8,
  message: 'Too many password reset requests. Please try again later.',
});

const verifyLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Too many verification requests. Please try again later.',
});

/* --------------------------------------------------------- per-account lockout */

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000; // 15 minutes
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED = 5000;

/** identifier -> { failures, firstFailureAt, lockedUntil } */
const accounts = new Map();

function keyFor(identifier) {
  return String(identifier || '').trim().toLowerCase().slice(0, 160);
}

function entryFor(key) {
  const now = Date.now();
  let entry = accounts.get(key);
  if (!entry) {
    entry = { failures: 0, firstFailureAt: now, lockedUntil: 0 };
    accounts.set(key, entry);
  }
  // Expire stale failure windows.
  if (!entry.lockedUntil && now - entry.firstFailureAt > FAILURE_WINDOW_MS) {
    entry.failures = 0;
    entry.firstFailureAt = now;
  }
  return entry;
}

/** Keep the map from growing without bound (no external store needed here). */
function prune() {
  if (accounts.size <= MAX_TRACKED) return;
  const now = Date.now();
  for (const [key, entry] of accounts) {
    if (entry.lockedUntil < now && now - entry.firstFailureAt > FAILURE_WINDOW_MS) {
      accounts.delete(key);
    }
    if (accounts.size <= MAX_TRACKED) break;
  }
}

/** Read the identifier from any of the shapes the auth endpoints accept. */
function identifierFrom(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  return body.identifier || body.email || body.phone || '';
}

/**
 * Refuse sign-in for a locked account, and record failures/successes by
 * observing the response the controller sends.
 */
function accountLockout(req, res, next) {
  const key = keyFor(identifierFrom(req));
  if (!key) return next();

  prune();
  const entry = entryFor(key);
  const now = Date.now();

  if (entry.lockedUntil > now) {
    const retryAfter = Math.ceil((entry.lockedUntil - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      message: `Too many failed attempts. Try again in ${retryAfter}s.`,
      code: 'ACCOUNT_LOCKED',
      retryAfter,
    });
  }

  // Clear the lock once it has expired so the next attempt is a fresh start.
  if (entry.lockedUntil && entry.lockedUntil <= now) {
    entry.lockedUntil = 0;
    entry.failures = 0;
    entry.firstFailureAt = now;
  }

  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    const status = res.statusCode;
    if (status === 401 || status === 400) {
      entry.failures += 1;
      if (entry.failures >= MAX_FAILURES) {
        entry.lockedUntil = Date.now() + LOCK_MS;
        console.warn(`Auth lockout: ${key} after ${entry.failures} failures`);
      }
    } else if (status >= 200 && status < 300) {
      // A successful sign-in clears the counter.
      accounts.delete(key);
    }
    return originalJson(payload);
  };

  return next();
}

/** Test helper + admin visibility. */
function lockoutState(identifier) {
  const entry = accounts.get(keyFor(identifier));
  if (!entry) return { failures: 0, locked: false, retryAfter: 0 };
  const retryAfter = Math.max(0, Math.ceil((entry.lockedUntil - Date.now()) / 1000));
  return { failures: entry.failures, locked: retryAfter > 0, retryAfter };
}

module.exports = {
  loginLimiter,
  signupLimiter,
  resetLimiter,
  verifyLimiter,
  accountLockout,
  lockoutState,
  MAX_FAILURES,
  LOCK_MS,
};
