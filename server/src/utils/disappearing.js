/**
 * Disappearing-message durations shared by the user default, the per-chat
 * setting and message expiry.
 */
const DURATIONS = {
  off: 0,
  '24h': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  '90d': 90 * 24 * 60 * 60,
};

const VALUES = Object.keys(DURATIONS);

function normalize(value) {
  const key = String(value ?? '').trim();
  return VALUES.includes(key) ? key : null;
}

function secondsFor(value) {
  const key = normalize(value);
  return key ? DURATIONS[key] : 0;
}

/** `expiresAt` for a newly stored message in this chat (null = never). */
function expiresAtFor(chat, now = new Date()) {
  const seconds = secondsFor(chat?.disappearing);
  return seconds > 0 ? new Date(now.getTime() + seconds * 1000) : null;
}

/** Mongo query fragment that hides expired disappearing messages. */
function notExpiredFilter() {
  return { $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] };
}

module.exports = { DURATIONS, VALUES, normalize, secondsFor, expiresAtFor, notExpiredFilter };
