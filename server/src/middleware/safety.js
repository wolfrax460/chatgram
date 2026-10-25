/**
 * 9b Safety & abuse enforcement.
 *
 * Settings live in PlatformSettings (cached) and are edited from the admin
 * Safety page. Three enforcement points:
 *  - blockBannedIp: a banned IP cannot use the API at all (admin + health stay
 *    reachable so the operator can unban);
 *  - checkSignup / recordSignup: per-IP signup throttling;
 *  - checkMessage: blocked words and link domains, plus a per-user messages
 *    per-minute rate limit.
 *
 * Counters are in-memory sliding windows, so they reset on restart and are
 * per-process (PM2 runs one API process). That is deliberate: they protect
 * against bursts, not as a durable record.
 */
const platformSettings = require('../utils/platformSettings');

const signupCounters = new Map(); // ip -> [timestamps]
const messageCounters = new Map(); // userId -> [timestamps]

function prune(list, windowMs, now) {
  return (list || []).filter((at) => now - at < windowMs);
}

function normalizeIp(value) {
  return String(value || '')
    .trim()
    .replace(/^::ffff:/i, '');
}

async function getSettings() {
  try {
    return await platformSettings.get();
  } catch (error) {
    console.error('Safety settings read failed:', error.message);
    return null;
  }
}

function ipMatches(entry, ip) {
  const candidate = normalizeIp(ip);
  const banned = normalizeIp(entry);
  return Boolean(candidate) && candidate === banned;
}

/** Express middleware: refuse every /api request from a banned IP. */
async function blockBannedIp(req, res, next) {
  const path = String(req.path || '');
  if (path.startsWith('/admin') || path === '/status/health' || path === '/health') return next();
  const settings = await getSettings();
  if (!settings || !Array.isArray(settings.ipBans) || settings.ipBans.length === 0) return next();
  const ip = normalizeIp(req.ip);
  const banned = settings.ipBans.find((entry) => ipMatches(entry?.ip, ip));
  if (banned) {
    return res.status(403).json({
      message: 'This network has been blocked by Chatgram. Contact support if you believe this is a mistake.',
      code: 'IP_BANNED',
    });
  }
  return next();
}

/**
 * Signup throttling check. Returns null when allowed, or { status, body }.
 * Call recordSignup() only after a successful registration.
 */
async function checkSignup(req) {
  const settings = await getSettings();
  if (!settings || settings.signupThrottleEnabled === false) return null;
  const limit = Math.max(1, Number(settings.signupsPerHourPerIp) || 20);
  const ip = normalizeIp(req.ip) || 'unknown';
  const now = Date.now();
  const recent = prune(signupCounters.get(ip), 60 * 60 * 1000, now);
  signupCounters.set(ip, recent);
  if (recent.length >= limit) {
    return {
      status: 429,
      body: {
        message: 'Too many accounts were created from this network recently. Try again later.',
        code: 'SIGNUP_THROTTLED',
      },
    };
  }
  return null;
}

function recordSignup(req) {
  const ip = normalizeIp(req.ip) || 'unknown';
  const now = Date.now();
  const recent = prune(signupCounters.get(ip), 60 * 60 * 1000, now);
  recent.push(now);
  signupCounters.set(ip, recent);
}

function extractDomains(text) {
  return Array.from(String(text || '').toLowerCase().matchAll(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/g)).map((match) => match[0]);
}

/**
 * Message content + rate check. Returns null when allowed, or { status, body }.
 */
async function checkMessage(userId, content) {
  const settings = await getSettings();
  if (!settings) return null;
  const text = String(content || '').toLowerCase();

  const word = (settings.blockedWords || []).find((candidate) => candidate && text.includes(candidate));
  if (word) {
    return {
      status: 403,
      body: { message: 'This message contains a word that is blocked on Chatgram.', code: 'BLOCKED_WORD' },
    };
  }

  const domains = extractDomains(text);
  const blockedDomain = (settings.blockedLinkDomains || []).find((domain) => {
    if (!domain) return false;
    return domains.some((found) => found === domain || found.endsWith(`.${domain}`));
  });
  if (blockedDomain) {
    return {
      status: 403,
      body: { message: 'Links to this domain are blocked on Chatgram.', code: 'BLOCKED_LINK' },
    };
  }

  const limit = Math.max(5, Number(settings.messagesPerMinute) || 60);
  const key = String(userId || 'unknown');
  const now = Date.now();
  const recent = prune(messageCounters.get(key), 60 * 1000, now);
  if (recent.length >= limit) {
    messageCounters.set(key, recent);
    return {
      status: 429,
      body: { message: 'You are sending messages too quickly. Wait a moment and try again.', code: 'MESSAGE_RATE_LIMITED' },
    };
  }
  recent.push(now);
  messageCounters.set(key, recent);
  return null;
}

/** Recent signup volume per IP, for the Safety page spam signals. */
function signupStats() {
  const now = Date.now();
  const out = [];
  for (const [ip, stamps] of signupCounters.entries()) {
    const recent = prune(stamps, 60 * 60 * 1000, now);
    signupCounters.set(ip, recent);
    if (recent.length > 0) out.push({ ip, count: recent.length, newestAt: new Date(Math.max(...recent)) });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 20);
}

function resetCounters() {
  signupCounters.clear();
  messageCounters.clear();
}

module.exports = { blockBannedIp, checkSignup, recordSignup, checkMessage, signupStats, resetCounters };
