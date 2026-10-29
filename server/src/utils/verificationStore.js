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
 * of usable window. Codes now live 15 minutes by default (VERIFICATION_CODE_TTL_MINUTES
 * can raise that without a deploy), and the email / SMS copy is generated from
 * the same constant so it can never drift.
 *
 * Resending a code never invalidates the copies the user was already emailed:
 * every still-live code is kept (bounded) until its own expiry. Submitted codes
 * are normalized (whitespace stripped, zero-padded to 6) because a client that
 * sends the code as a JSON number silently drops a leading zero.
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

/**
 * Code lifetime. Configurable because real SMTP/SMS delivery can queue: the
 * product default is 15 minutes and an operator can raise it with
 * VERIFICATION_CODE_TTL_MINUTES (5..120) without a code change.
 */
const DEFAULT_TTL_MINUTES = 15;
const TTL_MINUTES = (() => {
  const raw = process.env.VERIFICATION_CODE_TTL_MINUTES ?? process.env.OTP_TTL_MINUTES;
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_TTL_MINUTES;
  return Math.min(120, Math.max(5, Math.round(value)));
})();
const TTL_MS = TTL_MINUTES * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000; // min gap between sends
const MAX_ATTEMPTS = 5;
// A resend keeps every code still inside its own lifetime, up to this many, so a
// user who pressed "Resend" while mail was slow can still type whichever email
// arrived (only the newest code used to verify before this).
const MAX_PREVIOUS_CODES = 5;
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

/**
 * Canonical form of a submitted code: digits only, padded to 6 characters.
 * A client that serializes the code as a JSON number drops a leading zero
 * ("012345" arrives as 12345); padding restores it instead of rejecting a code
 * the user actually received. Returns null when the input is not 1..6 digits.
 * @returns {string|null}
 */
function normalizeCode(raw) {
  const text = String(raw === undefined || raw === null ? '' : raw).replace(/\s+/g, '');
  if (!/^[0-9]{1,6}$/.test(text)) return null;
  return text.padStart(6, '0');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * All previous codes that are still inside their own lifetime, plus the current
 * one (which becomes previous on a re-send). Keeps both the new list format and
 * the legacy single-previous fields readable. Bounded to MAX_PREVIOUS_CODES.
 */
function livePreviousCodes(record, nowMs) {
  const list = [];
  const push = (codeHash, expiresAt) => {
    if (!codeHash || !expiresAt) return;
    const at = new Date(expiresAt);
    if (!Number.isFinite(at.getTime()) || at.getTime() <= nowMs) return;
    if (list.some((entry) => entry.codeHash === codeHash)) return;
    list.push({ codeHash, expiresAt: at });
  };
  for (const entry of record.previousCodes || []) push(entry && entry.codeHash, entry && entry.expiresAt);
  push(record.previousCodeHash, record.previousExpiresAt); // legacy rows
  push(record.codeHash, record.expiresAt); // the code being replaced
  return list.slice(-MAX_PREVIOUS_CODES);
}

/**
 * Shared code check used by both stores.
 * `code` must already be normalized (see normalizeCode).
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
  const matches = (hash) => Boolean(hash) && safeEqual(submitted, hash);
  let accepted = matches(record.codeHash);
  if (!accepted) {
    for (const previous of record.previousCodes || []) {
      if (!previous || !previous.expiresAt || new Date(previous.expiresAt).getTime() <= nowMs) continue;
      if (matches(previous.codeHash)) {
        accepted = true;
        break;
      }
    }
  }
  if (!accepted && record.previousCodeHash && record.previousExpiresAt
    && new Date(record.previousExpiresAt).getTime() > nowMs) {
    accepted = matches(record.previousCodeHash);
  }

  if (!accepted) {
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

/**
 * Per-call lifetime override (used by the 10-minute account-deletion code).
 * Clamped to 1 minute .. 24 hours; anything invalid falls back to the default.
 */
function ttlOverride(options) {
  const value = Number(options && options.ttlMs);
  if (!Number.isFinite(value) || value < 60_000) return TTL_MS;
  return Math.min(value, 24 * 60 * 60 * 1000);
}

function issueMemory(key, nowMs, ttlMs = TTL_MS) {
  purgeMemory(nowMs);
  const existing = memoryStore.get(key);

  if (existing && nowMs - existing.lastSentAt < RESEND_COOLDOWN_MS) {
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - (nowMs - existing.lastSentAt)) / 1000),
    };
  }

  const code = generateCode();
  memoryStore.set(key, {
    codeHash: hashCode(code),
    previousCodes: existing ? livePreviousCodes(existing, nowMs) : [],
    expiresAt: nowMs + ttlMs,
    attempts: 0,
    lastSentAt: nowMs,
  });

  return { ok: true, code, expiresInSeconds: Math.floor(ttlMs / 1000) };
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
 * `options.ttlMs` overrides the store default for this record (account deletion
 * uses 10 minutes); single use, 5 attempts and the resend cooldown are identical.
 * @returns {Promise<{ok: true, code: string, expiresInSeconds: number} | {ok: false, retryAfterSeconds: number}>}
 */
async function issue(channel, target, options = {}) {
  const normalized = normalizeTarget(target);
  const nowMs = clock();
  const ttlMs = ttlOverride(options);

  if (!dbAvailable()) {
    warnFallbackOnce();
    return issueMemory(keyOf(channel, normalized), nowMs, ttlMs);
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
    const record = {
      channel,
      target: normalized,
      codeHash: hashCode(code),
      // Keep every still-live emailed code, not just one: users hit "Resend"
      // when SMTP is slow and then type whichever message arrives first.
      previousCodes: existing ? livePreviousCodes(existing, nowMs) : [],
      previousCodeHash: null,
      previousExpiresAt: null,
      expiresAt: new Date(nowMs + ttlMs),
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

    return { ok: true, code, expiresInSeconds: Math.floor(ttlMs / 1000) };
  } catch (error) {
    warnFallbackOnce(error);
    return issueMemory(keyOf(channel, normalized), nowMs, ttlMs);
  }
}

/**
 * Check a submitted code. A correct code is consumed (single use).
 * @returns {Promise<{ok: true} | {ok: false, reason: 'missing'|'expired'|'invalid'|'too_many_attempts'}>}
 */
async function check(channel, target, code) {
  const normalized = normalizeTarget(target);
  const submitted = normalizeCode(code);
  // Non-numeric or oversized input is a plain wrong code, not a server error.
  if (!submitted) return { ok: false, reason: 'invalid' };
  const nowMs = clock();

  if (!dbAvailable()) {
    warnFallbackOnce();
    return checkMemory(keyOf(channel, normalized), submitted, nowMs);
  }

  try {
    const record = await VerificationCode.findOne({ channel, target: normalized });
    if (!record) {
      // The code may have been issued while the DB was down (memory fallback).
      return checkMemory(keyOf(channel, normalized), submitted, nowMs);
    }

    const { outcome, action } = evaluate(record, submitted, nowMs);
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
    return checkMemory(keyOf(channel, normalized), submitted, nowMs);
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
  normalizeCode,
  TTL_MS,
  TTL_MINUTES,
  DEFAULT_TTL_MINUTES,
  RESEND_COOLDOWN_MS,
  MAX_ATTEMPTS,
  MAX_PREVIOUS_CODES,
  EXPIRED_RETENTION_MS,
  setClockForTests,
};
