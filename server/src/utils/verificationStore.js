/**
 * One-time code (email verification / phone OTP) storage.
 *
 * Codes are stored in MongoDB rather than a process-local `Map`. The Map was
 * the cause of the "my code expired immediately" reports: a PM2 restart, a
 * second API instance or a rolling deploy lost every pending code, so the next
 * check answered "no code requested" while the user was still typing it.
 *
 * The 10-minute lifetime was also too tight in practice: transactional mail and
 * SMS are routinely delivered minutes late, so the user only had a few minutes
 * of usable window. Codes now live for 15 minutes (see TTL_MS) and the email /
 * SMS copy is generated from that same constant so it can never drift.
 *
 * A TTL index on `expiresAt` is the cleanup path, but it deletes a few minutes
 * after expiry (EXPIRED_RETENTION_MS) so `check()` can distinguish `expired`
 * from `missing` and the client can show "code expired — send a new one".
 *
 * If MongoDB is unavailable this module falls back to an in-memory Map and logs
 * once. Sign-up must keep working when the database is temporarily unreachable;
 * only survival across restarts and sharing between instances are lost.
 *
 * Codes are never stored in plaintext. A 6-digit code has only 10^6 possible
 * values, so a plain SHA-256 would be reversible by brute force from a leaked
 * collection; the hash is HMAC-SHA256 keyed with a server pepper instead.
 *
 * API (async because of the database — callers must await):
 *   issue(channel, target) -> { ok: true, code, expiresInSeconds }
 *                          | { ok: false, retryAfterSeconds }
 *   check(channel, target, code) -> { ok: true }
 *                                | { ok: false, reason: 'missing'|'expired'|'invalid'|'too_many_attempts' }
 *   clear()
 */
const crypto = require('crypto');
const mongoose = require('mongoose');
const VerificationCode = require('../models/VerificationCode');

const TTL_MS = 15 * 60 * 1000; // 15 minutes — long enough for slow mail/SMS delivery
const TTL_MINUTES = Math.floor(TTL_MS / 60_000);
const RESEND_COOLDOWN_MS = 60 * 1000; // min gap between sends
const MAX_ATTEMPTS = 5;
// How long an expired row is kept so `check()` can report `expired` instead of
// `missing`. Must match the TTL index delay in models/VerificationCode.js.
const EXPIRED_RETENTION_MS = 10 * 60 * 1000;

/** key `channel:target` -> record, used only when Mongo is unavailable. */
const memoryStore = new Map();

// Unit tests move this instead of waiting 15 minutes. Production never calls it.
let clock = () => Date.now();
function setClockForTests(fn) {
  clock = typeof fn === 'function' ? fn : () => Date.now();
}

let fallbackWarned = false;
function warnFallbackOnce(error) {
  if (fallbackWarned) return;
  fallbackWarned = true;
  console.warn(
    'verificationStore: MongoDB is unavailable, using the in-memory code store. ' +
      'Codes will not survive a restart or be shared between instances.',
    error && error.message ? error.message : '',
  );
}

function dbAvailable() {
  return mongoose.connection.readyState === 1;
}

function normalizeTarget(target) {
  return String(target || '').trim().toLowerCase();
}

function keyOf(channel, target) {
  return `${channel}:${normalizeTarget(target)}`;
}

/** Keyed hash: the 6-digit space is tiny, so a bare SHA-256 is not enough. */
function hashCode(code) {
  const pepper =
    process.env.VERIFICATION_CODE_SECRET || process.env.JWT_SECRET || 'chatgram-verification';
  return crypto.createHmac('sha256', pepper).update(String(code)).digest('hex');
}

/** Cryptographically random 6-digit code (never Math.random). */
function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Shared code check used by both stores.
 * @returns {{outcome: {ok: true} | {ok: false, reason: string}, action: 'delete'|'increment'|'keep'}}
 */
function evaluate(record, code, nowMs) {
  if (new Date(record.expiresAt).getTime() <= nowMs) {
    return { outcome: { ok: false, reason: 'expired' }, action: 'delete' };
  }
  if ((Number(record.attempts) || 0) >= MAX_ATTEMPTS) {
    return { outcome: { ok: false, reason: 'too_many_attempts' }, action: 'delete' };
  }

  const submitted = hashCode(code);
  const currentOk = safeEqual(submitted, record.codeHash);
  const previousExpired =
    !record.previousExpiresAt || new Date(record.previousExpiresAt).getTime() <= nowMs;
  const previousOk =
    Boolean(record.previousCodeHash) && !previousExpired && safeEqual(submitted, record.previousCodeHash);

  if (!currentOk && !previousOk) {
    return { outcome: { ok: false, reason: 'invalid' }, action: 'increment' };
  }
  return { outcome: { ok: true }, action: 'delete' };
}

/* ---------------------------------------------------------------- memory */

/** Drop records past their retention window (kept briefly to report `expired`). */
function purgeMemory(nowMs) {
  for (const [key, record] of memoryStore) {
    if (record.expiresAt + EXPIRED_RETENTION_MS <= nowMs) memoryStore.delete(key);
  }
}

function issueMemory(key, nowMs) {
  purgeMemory(nowMs);
  const existing = memoryStore.get(key);

  if (existing && nowMs - existing.lastSentAt < RESEND_COOLDOWN_MS) {
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - (nowMs - existing.lastSentAt)) / 1000),
    };
  }

  const code = generateCode();
  const keepPrevious = Boolean(existing) && existing.expiresAt > nowMs;
  memoryStore.set(key, {
    codeHash: hashCode(code),
    previousCodeHash: keepPrevious ? existing.codeHash : null,
    previousExpiresAt: keepPrevious ? existing.expiresAt : null,
    expiresAt: nowMs + TTL_MS,
    attempts: 0,
    lastSentAt: nowMs,
  });

  return { ok: true, code, expiresInSeconds: Math.floor(TTL_MS / 1000) };
}

function checkMemory(key, code, nowMs) {
  purgeMemory(nowMs);
  const record = memoryStore.get(key);
  if (!record) return { ok: false, reason: 'missing' };

  const { outcome, action } = evaluate(record, code, nowMs);
  if (action === 'delete') {
    memoryStore.delete(key); // single use, or burned/expired
  } else if (action === 'increment') {
    // Mutating in place keeps the attempt count moving for concurrent checks.
    record.attempts += 1;
  }
  return outcome;
}

/* ---------------------------------------------------------------- public */

/**
 * Create (or replace) a code for a target.
 * @returns {Promise<{ok: true, code: string, expiresInSeconds: number} | {ok: false, retryAfterSeconds: number}>}
 */
async function issue(channel, target) {
  const normalized = normalizeTarget(target);
  const nowMs = clock();

  if (!dbAvailable()) {
    warnFallbackOnce();
    return issueMemory(keyOf(channel, normalized), nowMs);
  }

  try {
    const existing = await VerificationCode.findOne({ channel, target: normalized }).lean();

    if (existing) {
      const sentAt = new Date(existing.lastSentAt).getTime();
      if (nowMs - sentAt < RESEND_COOLDOWN_MS) {
        return {
          ok: false,
          retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - (nowMs - sentAt)) / 1000),
        };
      }
    }

    const code = generateCode();
    const keepPrevious = Boolean(existing) && new Date(existing.expiresAt).getTime() > nowMs;
    const record = {
      channel,
      target: normalized,
      codeHash: hashCode(code),
      previousCodeHash: keepPrevious ? existing.codeHash : null,
      previousExpiresAt: keepPrevious ? new Date(existing.expiresAt) : null,
      expiresAt: new Date(nowMs + TTL_MS),
      attempts: 0,
      lastSentAt: new Date(nowMs),
    };

    // Upsert on the unique channel+target index. Two sends racing can both try
    // to insert; the loser retries as an update.
    try {
      await VerificationCode.updateOne({ channel, target: normalized }, { $set: record }, { upsert: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
      await VerificationCode.updateOne({ channel, target: normalized }, { $set: record }, { upsert: true });
    }

    return { ok: true, code, expiresInSeconds: Math.floor(TTL_MS / 1000) };
  } catch (error) {
    warnFallbackOnce(error);
    return issueMemory(keyOf(channel, normalized), nowMs);
  }
}

/**
 * Check a submitted code. A correct code is consumed (single use).
 * @returns {Promise<{ok: true} | {ok: false, reason: 'missing'|'expired'|'invalid'|'too_many_attempts'}>}
 */
async function check(channel, target, code) {
  const normalized = normalizeTarget(target);
  const nowMs = clock();

  if (!dbAvailable()) {
    warnFallbackOnce();
    return checkMemory(keyOf(channel, normalized), code, nowMs);
  }

  try {
    const record = await VerificationCode.findOne({ channel, target: normalized });
    if (!record) {
      // The code may have been issued while the DB was down (memory fallback).
      return checkMemory(keyOf(channel, normalized), code, nowMs);
    }

    const { outcome, action } = evaluate(record, code, nowMs);
    if (action === 'delete') {
      // A correct code is consumed atomically: two parallel requests with the
      // same code cannot both succeed, because only one findOneAndDelete gets
      // the document and the other is told the code is gone.
      if (outcome.ok) {
        const deleted = await VerificationCode.findOneAndDelete({ _id: record._id });
        if (!deleted) return { ok: false, reason: 'missing' };
        return { ok: true };
      }
      await VerificationCode.deleteOne({ _id: record._id });
    } else if (action === 'increment') {
      // $inc, not "read then write": two parallel guesses must not share one attempt.
      await VerificationCode.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
    }
    return outcome;
  } catch (error) {
    warnFallbackOnce(error);
    return checkMemory(keyOf(channel, normalized), code, nowMs);
  }
}

/** Remove every pending code. Used by tests and "reset account" tooling. */
async function clear() {
  memoryStore.clear();
  if (!dbAvailable()) return;
  try {
    await VerificationCode.deleteMany({});
  } catch (error) {
    warnFallbackOnce(error);
  }
}

module.exports = {
  issue,
  check,
  clear,
  TTL_MS,
  TTL_MINUTES,
  RESEND_COOLDOWN_MS,
  MAX_ATTEMPTS,
  EXPIRED_RETENTION_MS,
  setClockForTests,
};
