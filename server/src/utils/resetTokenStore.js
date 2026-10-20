/**
 * Dedicated password-reset tokens.
 *
 * Deliberately separate from the email-verification store so:
 *   - a reset code can never be replayed as a verification code (or vice versa)
 *   - reset codes live for 15 minutes instead of the verification window
 *   - codes are stored HASHED (sha256 + pepper), never in plain text
 *   - each code is single-use: checking it successfully deletes it
 *
 * Interface mirrors the verification store so the controllers read the same:
 *   issue(channel, target) -> { ok, code, expiresInSeconds, retryAfterSeconds }
 *   check(channel, target, code) -> { ok, reason }
 */
const crypto = require('node:crypto');

const TTL_MS = 15 * 60 * 1000; // 15 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute between requests
const MAX_ATTEMPTS = 5;

/** key `${channel}:${target}` -> { hash, expiresAt, attempts, sentAt } */
const tokens = new Map();

function pepper() {
  return process.env.RESET_TOKEN_SECRET || process.env.JWT_SECRET || 'chatgram-reset';
}

function keyFor(channel, target) {
  return `${channel}:${String(target || '').trim().toLowerCase()}`;
}

/** Codes are short, so hash them with the server pepper before storage. */
function hashCode(code) {
  return crypto.createHmac('sha256', pepper()).update(String(code)).digest('hex');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function prune() {
  const now = Date.now();
  for (const [key, entry] of tokens) {
    if (entry.expiresAt < now) tokens.delete(key);
  }
}

function issue(channel, target) {
  prune();
  const key = keyFor(channel, target);
  const now = Date.now();
  const existing = tokens.get(key);

  if (existing && now - existing.sentAt < RESEND_COOLDOWN_MS) {
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - (now - existing.sentAt)) / 1000),
    };
  }

  // 6 digits, cryptographically random.
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  tokens.set(key, {
    hash: hashCode(code),
    expiresAt: now + TTL_MS,
    attempts: 0,
    sentAt: now,
  });

  return {
    ok: true,
    code,
    expiresInSeconds: Math.floor(TTL_MS / 1000),
  };
}

function check(channel, target, code) {
  const key = keyFor(channel, target);
  const entry = tokens.get(key);

  if (!entry) return { ok: false, reason: 'not_found' };
  if (entry.expiresAt < Date.now()) {
    tokens.delete(key);
    return { ok: false, reason: 'expired' };
  }
  if (entry.attempts >= MAX_ATTEMPTS) {
    tokens.delete(key);
    return { ok: false, reason: 'too_many_attempts' };
  }

  entry.attempts += 1;

  if (!safeEqual(hashCode(code), entry.hash)) {
    return { ok: false, reason: 'invalid' };
  }

  // Single use: consume it.
  tokens.delete(key);
  return { ok: true };
}

/** Revoke an outstanding reset code (e.g. after a successful reset). */
function revoke(channel, target) {
  tokens.delete(keyFor(channel, target));
}

module.exports = { issue, check, revoke, hashCode, TTL_MS, MAX_ATTEMPTS };
