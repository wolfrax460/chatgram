/**
 * Admin panel authentication.
 *
 * Independent of user accounts: one password, hashed with bcrypt in
 * ADMIN_PANEL_PASSWORD_HASH, exchanged for a server-side session cookie
 * (HttpOnly, SameSite=Strict, Secure in production) with a CSRF token.
 * Sliding 30-minute idle timeout, 8-hour absolute lifetime.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const AdminSession = require('../models/AdminSession');
const AdminAudit = require('../models/AdminAudit');

const COOKIE_NAME = 'chatgram_admin';
const IDLE_MS = 30 * 60 * 1000;
const ABSOLUTE_MS = 8 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

const attempts = new Map();
// A real bcrypt hash so an unconfigured panel takes the same time as a wrong
// password (no timing hint about whether the panel is configured).
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO7/4o0M5A8S8F1p8bHlTH6mO4lUu0v8K';

function configured() {
  return Boolean(String(process.env.ADMIN_PANEL_PASSWORD_HASH || '').trim());
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function cookieOptions() {
  const secure = process.env.NODE_ENV === 'production';
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ABSOLUTE_MS / 1000)}${secure ? '; Secure' : ''}`;
}

function setSessionCookie(res, token) {
  res.append('Set-Cookie', `${COOKIE_NAME}=${token}; ${cookieOptions()}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  res.append('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`);
}

async function audit(action, req, detail = '') {
  try {
    await AdminAudit.create({
      action,
      detail: String(detail).slice(0, 500),
      ip: req.ip || '',
      userAgent: String(req.headers?.['user-agent'] || '').slice(0, 300),
      sessionId: req.adminSession?._id ? String(req.adminSession._id) : '',
    });
  } catch (error) {
    console.warn('Admin audit write failed:', error.message);
  }
}

function rateState(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry) return { count: 0, windowStart: now, lockedUntil: 0, lockCount: 0 };
  if (entry.lockedUntil && entry.lockedUntil > now) return entry;
  if (now - entry.windowStart > WINDOW_MS) {
    return { count: 0, windowStart: now, lockedUntil: 0, lockCount: entry.lockCount || 0 };
  }
  return entry;
}

function registerFailure(ip) {
  const now = Date.now();
  const entry = rateState(ip);
  const next = {
    count: entry.count + 1,
    windowStart: entry.windowStart || now,
    lockedUntil: entry.lockedUntil || 0,
    lockCount: entry.lockCount || 0,
  };
  if (next.count >= MAX_ATTEMPTS) {
    next.lockCount += 1;
    const lockMs = Math.min(60 * 60 * 1000, WINDOW_MS * 2 ** (next.lockCount - 1));
    next.lockedUntil = now + lockMs;
    next.count = 0;
    next.windowStart = now;
  }
  attempts.set(ip, next);
  return next;
}

function clearFailures(ip) {
  attempts.delete(ip);
}

function retryAfterSeconds(ip) {
  const entry = rateState(ip);
  if (!entry.lockedUntil) return 0;
  return Math.max(0, Math.ceil((entry.lockedUntil - Date.now()) / 1000));
}

/** Verify the submitted password; never throws. */
async function checkPassword(password) {
  const stored = String(process.env.ADMIN_PANEL_PASSWORD_HASH || '').trim();
  try {
    if (!stored) {
      await bcrypt.compare(String(password || ''), DUMMY_HASH);
      return false;
    }
    return await bcrypt.compare(String(password || ''), stored);
  } catch {
    return false;
  }
}

async function createSession(req, res) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const session = await AdminSession.create({
    tokenHash: hashToken(token),
    csrfToken,
    ip: req.ip || '',
    userAgent: String(req.headers?.['user-agent'] || '').slice(0, 300),
    expiresAt: new Date(Date.now() + ABSOLUTE_MS),
  });
  setSessionCookie(res, token);
  return { token, csrfToken, session };
}

function readSessionToken(req) {
  return parseCookies(req.headers?.cookie)[COOKIE_NAME] || '';
}

/** Load and validate the session; updates the sliding expiry timestamp. */
async function loadSession(req) {
  const token = readSessionToken(req);
  if (!token) return null;
  const session = await AdminSession.findOne({ tokenHash: hashToken(token) });
  if (!session || session.revokedAt) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now) return null;
  if (now - session.lastSeenAt.getTime() > IDLE_MS) return null;
  if (now - session.lastSeenAt.getTime() > 60_000) {
    session.lastSeenAt = new Date(now);
    await session.save();
  }
  return session;
}

async function revokeSession(session) {
  if (!session) return;
  session.revokedAt = new Date();
  await session.save();
}

module.exports = {
  COOKIE_NAME,
  configured,
  parseCookies,
  checkPassword,
  createSession,
  loadSession,
  revokeSession,
  clearSessionCookie,
  audit,
  rateState,
  registerFailure,
  clearFailures,
  retryAfterSeconds,
  hashToken,
  randomToken,
  MAX_ATTEMPTS,
};
