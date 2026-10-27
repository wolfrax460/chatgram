/**
 * Platform settings (9b item 10): feature flags, maintenance and read-only mode,
 * upload limits. One cached document; the admin page edits it and every gate
 * below reads the cached copy.
 */
const PlatformSettings = require('../models/PlatformSettings');

const DEFAULTS = {
  registrationEnabled: true,
  statusEnabled: true,
  groupsEnabled: true,
  fileUploadsEnabled: true,
  aiEnabled: true,
  supportWidgetEnabled: true,
  maintenanceMode: false,
  maintenanceMessage: 'Chatgram is under maintenance. We will be back shortly.',
  // Optional ISO timestamp: after it passes, maintenance is over even if the
  // boolean is still true. Lets an admin "put the app down" for 15 minutes
  // without having to remember to switch it back on.
  maintenanceUntil: null,
  readOnlyMode: false,
  maxUploadMb: 100,
  // 9b Safety & abuse (enforced by middleware/safety.js).
  blockedWords: [],
  blockedLinkDomains: [],
  blockedEmailDomains: [],
  messagesPerMinute: 60,
  signupsPerHourPerIp: 20,
  massMessageHourly: 200,
  signupThrottleEnabled: true,
  ipBans: [],
  // 9b Settings page.
  siteName: 'Chatgram',
  siteUrl: 'https://chatgram-xi.vercel.app',
  supportEmail: '',
  smtpFromName: 'Chatgram',
  smtpFromAddress: '',
  privacyUrl: '/docs/#privacy',
  termsUrl: '/docs/#terms',
  dataRetentionDays: 365,
  reviewLogRetentionDays: 730,
  // 1A: "Send reports to Telegram" (default ON). AI_REPORT_TELEGRAM=false in
  // the environment still forces report Telegram alerts off.
  reportTelegramEnabled: true,
  lastBackupAt: null,
  lastBackupSizeBytes: 0,
  lastBackupPath: '',
};

const SETTINGS_TEXTS = { siteName: 60, siteUrl: 300, supportEmail: 200, smtpFromName: 80, smtpFromAddress: 200, privacyUrl: 300, termsUrl: 300 };
const SETTINGS_NUMBERS = { dataRetentionDays: [30, 3650], reviewLogRetentionDays: [30, 3650] };

function validLink(value) {
  const text = String(value || '').trim();
  return text.startsWith('/') || /^https?:\/\//i.test(text);
}

const SAFETY_LISTS = ['blockedWords', 'blockedLinkDomains', 'blockedEmailDomains'];
const SAFETY_NUMBERS = { messagesPerMinute: [5, 600], signupsPerHourPerIp: [1, 1000], massMessageHourly: [10, 10000] };

function cleanList(value, maxLength) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const item = String(raw || '').trim().toLowerCase().replace(/^\*\./, '');
    if (!item || item.length > maxLength || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= 200) break;
  }
  return out;
}

const CACHE_MS = 5000;
let cache = { at: 0, value: null };

/** Longest auto-expiry window an admin may set, so a typo cannot hide the app for weeks. */
const MAX_MAINTENANCE_UNTIL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * True while maintenance should actually block users.
 *
 * `maintenanceMode` alone is not enough: when `maintenanceUntil` has passed the
 * window is over, even though the stored flag is still true. Keeping the
 * decision in one pure function means the REST gate, the Socket.IO gate and
 * /api/app/features can never disagree.
 */
function isMaintenanceActive(settings, nowMs = Date.now()) {
  if (!settings || settings.maintenanceMode !== true) return false;
  if (!settings.maintenanceUntil) return true;
  const until = new Date(settings.maintenanceUntil).getTime();
  // An unparseable value must not silently turn maintenance off.
  if (!Number.isFinite(until)) return true;
  return nowMs < until;
}

/**
 * The effective settings. An expired maintenance window is reported as off and
 * with no end date, so the admin page and the app shells converge on "live"
 * without a background scheduler or a write on every read.
 */
function normalizeAutoExpiry(settings, nowMs = Date.now()) {
  if (settings.maintenanceMode !== true || !settings.maintenanceUntil) return settings;
  if (isMaintenanceActive(settings, nowMs)) return settings;
  return { ...settings, maintenanceMode: false, maintenanceUntil: null };
}

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const ALWAYS_REACHABLE_PATHS = ['/config', '/app/features'];

/**
 * Pure gate decision (unit-tested without a database).
 *
 * Admin endpoints and health checks always pass: recovery and monitoring must
 * not depend on the mode being off. `/api/auth/*`, `/api/config` and
 * `/api/app/features` also stay reachable so users can sign in / recover and
 * the app shells can read `{ maintenanceMode, maintenanceMessage }` *before*
 * any other call and show the maintenance screen instead of a generic error.
 *
 * @returns {null | {status: number, code: 'MAINTENANCE'|'READ_ONLY', message: string, maintenanceUntil?: string}}
 */
function gateDecision(settings, { path = '', method = 'GET', now = Date.now() } = {}) {
  const requestPath = String(path || '');
  if (requestPath.startsWith('/admin')) return null;
  if (requestPath === '/status/health' || requestPath === '/health') return null;

  const alwaysReachable =
    requestPath.startsWith('/auth') || ALWAYS_REACHABLE_PATHS.includes(requestPath);

  if (!alwaysReachable && isMaintenanceActive(settings, now)) {
    const decision = {
      status: 503,
      code: 'MAINTENANCE',
      message: settings.maintenanceMessage || DEFAULTS.maintenanceMessage,
    };
    if (settings.maintenanceUntil) decision.maintenanceUntil = new Date(settings.maintenanceUntil).toISOString();
    return decision;
  }

  if (!alwaysReachable && settings.readOnlyMode && !SAFE_METHODS.includes(String(method).toUpperCase())) {
    return {
      status: 503,
      code: 'READ_ONLY',
      message: 'Chatgram is in read-only mode right now. You can read, but not post.',
    };
  }

  return null;
}

async function get() {
  if (cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;
  let doc = await PlatformSettings.findOne({ singleton: 'platform' }).lean();
  if (!doc) {
    doc = await PlatformSettings.create({ singleton: 'platform', ...DEFAULTS });
    doc = doc.toObject();
  }
  const raw = { ...DEFAULTS, ...Object.fromEntries(Object.entries(doc).filter(([key]) => key in DEFAULTS)) };
  const value = normalizeAutoExpiry(raw);
  cache = { at: Date.now(), value };
  return value;
}

async function update(patch, req) {
  const current = await get();
  const next = { ...current };
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in (patch || {}))) continue;
    if (typeof DEFAULTS[key] === 'boolean') next[key] = patch[key] === true;
    else if (key === 'maxUploadMb') {
      const value = Number(patch[key]);
      if (!Number.isFinite(value) || value < 1 || value > 2048) {
        const error = new Error('Upload limit must be between 1 and 2048 MB.');
        error.status = 400;
        throw error;
      }
      next[key] = Math.round(value);
    } else if (key === 'maintenanceMessage') {
      next[key] = String(patch[key] || '').slice(0, 500) || DEFAULTS.maintenanceMessage;
    } else if (SAFETY_LISTS.includes(key)) {
      next[key] = cleanList(patch[key], key === 'blockedWords' ? 60 : 120);
    } else if (SAFETY_NUMBERS[key]) {
      const [min, max] = SAFETY_NUMBERS[key];
      const value = Number(patch[key]);
      if (!Number.isFinite(value) || value < min || value > max) {
        const error = new Error(`${key} must be between ${min} and ${max}.`);
        error.status = 400;
        throw error;
      }
      next[key] = Math.round(value);
    } else if (SETTINGS_TEXTS[key]) {
      let value = String(patch[key] || '').trim();
      if (value.length > SETTINGS_TEXTS[key]) {
        const error = new Error(`${key} is too long (max ${SETTINGS_TEXTS[key]} characters).`);
        error.status = 400;
        throw error;
      }
      if ((key === 'siteUrl' || key === 'privacyUrl' || key === 'termsUrl') && !validLink(value)) {
        const error = new Error(`${key} must be a /path or an http(s) URL.`);
        error.status = 400;
        throw error;
      }
      if (key === 'supportEmail' && value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
        const error = new Error('supportEmail must be a valid email address.');
        error.status = 400;
        throw error;
      }
      if (key === 'siteName' && !value) value = 'Chatgram';
      next[key] = value;
    } else if (SETTINGS_NUMBERS[key]) {
      const [min, max] = SETTINGS_NUMBERS[key];
      const value = Number(patch[key]);
      if (!Number.isFinite(value) || value < min || value > max) {
        const error = new Error(`${key} must be between ${min} and ${max}.`);
        error.status = 400;
        throw error;
      }
      next[key] = Math.round(value);
    } else if (key === 'maintenanceUntil') {
      const raw = patch[key];
      if (raw === null || raw === undefined || raw === '') {
        next[key] = null;
      } else {
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) {
          const error = new Error('maintenanceUntil must be an ISO date (or null).');
          error.status = 400;
          throw error;
        }
        if (parsed.getTime() > Date.now() + MAX_MAINTENANCE_UNTIL_MS) {
          const error = new Error('maintenanceUntil must be within the next 7 days.');
          error.status = 400;
          throw error;
        }
        next[key] = parsed;
      }
    } else if (key === 'ipBans') {
      // Managed by the Safety controller only.
      next[key] = current.ipBans || [];
    }
  }
  // Turning maintenance off clears the window too: a stale future `until` would
  // silently switch maintenance off again the next time it is enabled.
  if (next.maintenanceMode === false) next.maintenanceUntil = null;
  await PlatformSettings.updateOne({ singleton: 'platform' }, { $set: next }, { upsert: true });
  cache = { at: Date.now(), value: normalizeAutoExpiry(next) };
  await require('../admin/auth').audit('platform_settings_update', req, Object.keys(patch || {}).join(',').slice(0, 300));
  return next;
}

function resetCache() {
  cache = { at: 0, value: null };
}

/** Express middleware gate for a boolean flag. */
function featureGate(flag, code, message) {
  return async (req, res, next) => {
    try {
      const settings = await get();
      if (settings[flag] === false) {
        return res.status(403).json({ message, code });
      }
      return next();
    } catch (error) {
      console.error('Feature gate error:', error.message);
      return next();
    }
  };
}

/** Global maintenance / read-only gate (admins and health stay reachable). */
async function platformGate(req, res, next) {
  try {
    const settings = await get();
    const decision = gateDecision(settings, { path: req.path, method: req.method });
    if (!decision) return next();
    return res.status(decision.status).json({
      message: decision.message,
      code: decision.code,
      // Lets a client show "back at 14:30" instead of a vague "shortly".
      ...(decision.maintenanceUntil ? { maintenanceUntil: decision.maintenanceUntil } : {}),
    });
  } catch (error) {
    // Fail open, like before: a settings read failure must not take the app down.
    console.error('Platform gate error:', error.message);
    return next();
  }
}

module.exports = {
  DEFAULTS,
  get,
  update,
  resetCache,
  featureGate,
  platformGate,
  // Pure decisions, exported so unit tests (and the socket gate) use exactly
  // the same rules as the HTTP middleware.
  isMaintenanceActive,
  gateDecision,
};
