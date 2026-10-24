/**
 * Reads/writes the singleton SupportSettings document and exposes effective
 * values (database first, environment second).
 *
 * Cached briefly so the hot paths (AI call, notifier) do not hit Mongo on every
 * request, but invalidated immediately on save.
 */
const SupportSettings = require('../models/SupportSettings');

let cache = null;
let cachedAt = 0;
const TTL_MS = 30 * 1000;

function envBool(name) {
  return process.env[name] === 'true';
}

async function raw() {
  const now = Date.now();
  if (cache && now - cachedAt < TTL_MS) return cache;
  cache = (await SupportSettings.findOne({ key: 'global' })) || null;
  cachedAt = now;
  return cache;
}

function invalidate() {
  cache = null;
  cachedAt = 0;
}

/** Effective values: DB value when set, otherwise the env var. */
async function effective() {
  const doc = await raw();
  const pickBool = (field, envName, fallback) => {
    if (doc && doc[field] !== null && doc[field] !== undefined) return Boolean(doc[field]);
    if (process.env[envName] !== undefined) return envBool(envName);
    return fallback;
  };
  const pickStr = (field, envName, fallback) => {
    if (doc && doc[field]) return doc[field];
    return process.env[envName] || fallback;
  };

  return {
    aiEnabled: pickBool('aiEnabled', 'SUPPORT_AI_ENABLED', false),
    aiProvider: pickStr('aiProvider', 'AI_PROVIDER', ''),
    aiBaseUrl: pickStr('aiBaseUrl', 'AI_BASE_URL', ''),
    aiModel: pickStr('aiModel', 'SUPPORT_AI_MODEL', ''),
    aiApiKey: pickStr('aiApiKey', 'AI_API_KEY', ''),
    aiMaxTokens: Number(pickStr('aiMaxTokens', 'AI_MAX_TOKENS', '400')),
    agentEnabled: pickBool('agentEnabled', 'SUPPORT_AGENT_ENABLED', false),
    agentShowTicketRef:
      doc && doc.agentShowTicketRef !== null && doc.agentShowTicketRef !== undefined
        ? Boolean(doc.agentShowTicketRef)
        : true,
    telegramEnabled: pickBool('telegramEnabled', 'TELEGRAM_ENABLED', Boolean(process.env.TELEGRAM_CHAT_ID)),
    telegramChatId: pickStr('telegramChatId', 'TELEGRAM_CHAT_ID', ''),
    emailEnabled: pickBool('emailEnabled', 'EMAIL_ENABLED', true),
    notifyEmail: pickStr('notifyEmail', 'SUPPORT_NOTIFY_EMAIL', ''),
    welcomeMessage: pickStr('welcomeMessage', 'SUPPORT_WELCOME_MESSAGE', ''),
    escalationMessage: pickStr('escalationMessage', 'SUPPORT_ESCALATION_MESSAGE', ''),
  };
}

async function save(patch, updatedBy = '') {
  const clean = { ...patch };
  // An empty string clears the override; undefined leaves it alone.
  for (const key of Object.keys(clean)) {
    if (clean[key] === '') clean[key] = null;
  }
  delete clean._id;
  delete clean.key;
  delete clean.__v;

  const doc = await SupportSettings.findOneAndUpdate(
    { key: 'global' },
    { $set: { ...clean, updatedBy } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  applyToEnv(doc);
  invalidate();
  return doc;
}

/** Safe view for the dashboard: never returns the API key. */
function publicView(doc) {
  if (!doc) return { configured: false };
  return {
    configured: true,
    aiEnabled: doc.aiEnabled,
    aiProvider: doc.aiProvider,
    aiBaseUrl: doc.aiBaseUrl,
    aiModel: doc.aiModel,
    aiApiKeySet: Boolean(doc.aiApiKey),
    aiMaxTokens: doc.aiMaxTokens,
    agentEnabled: doc.agentEnabled,
    agentShowTicketRef: doc.agentShowTicketRef,
    telegramEnabled: doc.telegramEnabled,
    telegramChatId: doc.telegramChatId,
    emailEnabled: doc.emailEnabled,
    notifyEmail: doc.notifyEmail,
    welcomeMessage: doc.welcomeMessage,
    escalationMessage: doc.escalationMessage,
    updatedBy: doc.updatedBy,
    updatedAt: doc.updatedAt,
  };
}

/* ------------------------------------------------------------------ env sync */

/**
 * Copy database values into process.env.
 * All existing modules read env synchronously, so this makes dashboard changes
 * take effect immediately without a restart, while staying persistent in Mongo.
 */
function applyToEnv(doc) {
  // Keep the previous (server env) AI key as a fallback so a stale/invalid
  // dashboard key can never make the assistant silently stop working.
  if (doc && doc.aiApiKey) {
    const current = String(process.env.AI_API_KEY || '').trim();
    const incoming = String(doc.aiApiKey || '').trim();
    if (current && incoming && current !== incoming && !process.env.AI_API_KEY_FALLBACK) {
      process.env.AI_API_KEY_FALLBACK = current;
    }
  }
  if (!doc) return;
  const map = {
    aiEnabled: ['SUPPORT_AI_ENABLED', (v) => String(Boolean(v))],
    aiProvider: ['AI_PROVIDER', String],
    aiBaseUrl: ['AI_BASE_URL', String],
    aiModel: ['SUPPORT_AI_MODEL', String],
    aiApiKey: ['AI_API_KEY', String],
    aiMaxTokens: ['AI_MAX_TOKENS', String],
    agentEnabled: ['SUPPORT_AGENT_ENABLED', (v) => String(Boolean(v))],
    telegramEnabled: ['TELEGRAM_ENABLED', (v) => String(Boolean(v))],
    telegramChatId: ['TELEGRAM_CHAT_ID', String],
    emailEnabled: ['EMAIL_ENABLED', (v) => String(Boolean(v))],
    notifyEmail: ['SUPPORT_NOTIFY_EMAIL', String],
    welcomeMessage: ['SUPPORT_WELCOME_MESSAGE', String],
    escalationMessage: ['SUPPORT_ESCALATION_MESSAGE', String],
  };
  for (const [field, [envName, cast]] of Object.entries(map)) {
    const value = doc[field];
    if (value === null || value === undefined || value === '') continue;
    process.env[envName] = cast(value);
  }
}

/** Load persisted settings into the process at boot. */
async function loadIntoEnv() {
  try {
    const doc = await raw();
    if (doc) {
      applyToEnv(doc);
      return true;
    }
    return false;
  } catch (error) {
    console.warn('Could not load support settings:', error.message);
    return false;
  }
}

module.exports.applyToEnv = applyToEnv;
module.exports.loadIntoEnv = loadIntoEnv;

module.exports = { raw, effective, save, invalidate, publicView, applyToEnv, loadIntoEnv };
