/**
 * One-time code (email verification / phone OTP) storage.
 *
 * Codes live in memory with a TTL. That is deliberate: it keeps the feature
 * dependency-free and is correct for a single-process deployment. If you run
 * multiple API instances behind a load balancer, move this to Redis or a
 * Mongo collection so all instances share the same store.
 */
const crypto = require('crypto');

const TTL_MS = 10 * 60 * 1000; // code lifetime
const RESEND_COOLDOWN_MS = 60 * 1000; // min gap between sends
const MAX_ATTEMPTS = 5;

/** key `channel:target` -> record */
const store = new Map();

function normalizeTarget(target) {
  return String(target || '').trim().toLowerCase();
}

function keyOf(channel, target) {
  return `${channel}:${normalizeTarget(target)}`;
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

/** Cryptographically random 6-digit code (never Math.random). */
function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function purgeExpired() {
  const now = Date.now();
  for (const [key, record] of store) {
    if (record.expiresAt <= now) store.delete(key);
  }
}

/**
 * Create (or replace) a code for a target.
 * @returns {{ok: true, code: string, expiresInSeconds: number} | {ok: false, retryAfterSeconds: number}}
 */
function issue(channel, target) {
  purgeExpired();

  const key = keyOf(channel, target);
  const existing = store.get(key);
  const now = Date.now();

  if (existing && now - existing.lastSentAt < RESEND_COOLDOWN_MS) {
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - (now - existing.lastSentAt)) / 1000),
    };
  }

  const code = generateCode();
  store.set(key, {
    codeHash: hashCode(code),
    expiresAt: now + TTL_MS,
    attempts: 0,
    lastSentAt: now,
  });

  return { ok: true, code, expiresInSeconds: Math.floor(TTL_MS / 1000) };
}

/**
 * Check a submitted code.
 * @returns {{ok: true} | {ok: false, reason: 'missing'|'expired'|'invalid'|'too_many_attempts'}}
 */
function check(channel, target, code) {
  purgeExpired();

  const key = keyOf(channel, target);
  const record = store.get(key);
  if (!record) return { ok: false, reason: 'missing' };
  if (record.expiresAt <= Date.now()) {
    store.delete(key);
    return { ok: false, reason: 'expired' };
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    store.delete(key);
    return { ok: false, reason: 'too_many_attempts' };
  }

  record.attempts += 1;

  const submitted = hashCode(code);
  const expected = record.codeHash;
  // Constant-time compare to avoid leaking the code via timing.
  const match =
    submitted.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(expected));

  if (!match) return { ok: false, reason: 'invalid' };

  store.delete(key); // single use
  return { ok: true };
}

function clear() {
  store.clear();
}

module.exports = { issue, check, clear, TTL_MS, RESEND_COOLDOWN_MS, MAX_ATTEMPTS };
