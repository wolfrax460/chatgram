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

async function get() {
  if (cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;
  let doc = await PlatformSettings.findOne({ singleton: 'platform' }).lean();
  if (!doc) {
    doc = await PlatformSettings.create({ singleton: 'platform', ...DEFAULTS });
    doc = doc.toObject();
  }
  const value = { ...DEFAULTS, ...Object.fromEntries(Object.entries(doc).filter(([key]) => key in DEFAULTS)) };
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
    } else if (key === 'ipBans') {
      // Managed by the Safety controller only.
      next[key] = current.ipBans || [];
    }
  }
  await PlatformSettings.updateOne({ singleton: 'platform' }, { $set: next }, { upsert: true });
  cache = { at: Date.now(), value: next };
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
    const path = String(req.path || '');
    const isAdmin = path.startsWith('/admin');
    const isHealth = path === '/status/health' || path === '/health';
    const isAuth = path.startsWith('/auth') || path === '/config' || path === '/app/features';
    if (isAdmin || isHealth) return next();
    if (settings.maintenanceMode && !isAuth) {
      return res.status(503).json({
        message: settings.maintenanceMessage,
        code: 'MAINTENANCE',
      });
    }
    if (settings.readOnlyMode && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !isAuth) {
      return res.status(503).json({
        message: 'Chatgram is in read-only mode right now. You can read, but not post.',
        code: 'READ_ONLY',
      });
    }
    return next();
  } catch (error) {
    console.error('Platform gate error:', error.message);
    return next();
  }
}

module.exports = { DEFAULTS, get, update, resetCache, featureGate, platformGate };
