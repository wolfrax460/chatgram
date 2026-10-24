/**
 * AI settings: env first, database second (admin-saved values win).
 *
 * The saved API key is encrypted at rest with AES-256-GCM (key derived from
 * `AI_SETTINGS_SECRET`, falling back to `JWT_SECRET`) and is never returned to
 * the browser — only its last 4 characters are.
 */
const crypto = require('crypto');
const mongoose = require('mongoose');
const { PROVIDERS } = require('./adapters');
const { validateBaseUrl } = require('./ssrf');
const { AiError } = require('./errors');

const aiSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true },
    enabled: { type: Boolean, default: null },
    provider: { type: String, default: null },
    model: { type: String, default: null },
    baseUrl: { type: String, default: null },
    apiKeyEncrypted: { type: String, default: null },
    apiKeyLast4: { type: String, default: null },
    temperature: { type: Number, default: null },
    maxOutputTokens: { type: Number, default: null },
    timeoutMs: { type: Number, default: null },
    dailyTokenBudget: { type: Number, default: null },
    fallbacks: {
      type: [
        new mongoose.Schema(
          {
            provider: { type: String, required: true },
            model: { type: String, required: true },
            keyEnv: { type: String, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);

const AiSettings = mongoose.models.AiSettings || mongoose.model('AiSettings', aiSettingsSchema);

let cache = null;
let cachedAt = 0;
const TTL_MS = 15_000;

function secretKey() {
  const secret = process.env.AI_SETTINGS_SECRET || process.env.JWT_SECRET || 'chatgram-ai-settings';
  return crypto.createHash('sha256').update(String(secret)).digest();
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decrypt(payload) {
  if (!payload) return '';
  try {
    const [ivPart, tagPart, dataPart] = String(payload).split('.');
    if (!ivPart || !tagPart || !dataPart) return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function keyLast4(key) {
  const value = String(key || '');
  return value.length >= 4 ? value.slice(-4) : '';
}

function envFallbacks() {
  const raw = String(process.env.SUPPORT_AI_FALLBACKS || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [provider, model, keyEnv] = entry.split(':');
      return { provider, model, keyEnv: keyEnv || null };
    })
    .filter((entry) => PROVIDERS[entry.provider] && entry.model);
}

function fallbackBaseUrlFor(provider) {
  // Per-provider override, e.g. SUPPORT_AI_BASE_URL_ANTHROPIC, so fallbacks can
  // point at a self-hosted gateway or a test server.
  const envName = `SUPPORT_AI_BASE_URL_${String(provider).toUpperCase().replace(/-/g, '_')}`;
  return process.env[envName] || PROVIDERS[provider]?.baseUrl || '';
}

async function rawDoc() {
  const now = Date.now();
  if (cache !== null && now - cachedAt < TTL_MS) return cache;
  try {
    cache = (await AiSettings.findOne({ key: 'global' })) || null;
  } catch {
    cache = null; // database unavailable: env-only mode
  }
  cachedAt = now;
  return cache;
}

function invalidate() {
  cache = null;
  cachedAt = 0;
}

const num = (value, fallback) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : fallback);
const str = (value, fallback) => (value === null || value === undefined || value === '' ? fallback : String(value));
const bool = (value, fallback) => (value === null || value === undefined ? fallback : Boolean(value));

/** Effective configuration (database overrides env). */
async function getEffectiveSettings() {
  const doc = await rawDoc();

  const provider = str(doc?.provider, process.env.SUPPORT_AI_PROVIDER || '');
  const model = str(doc?.model, process.env.SUPPORT_AI_MODEL || '');
  const baseUrl = str(doc?.baseUrl, process.env.SUPPORT_AI_BASE_URL || PROVIDERS[provider]?.baseUrl || '');
  const enabled = bool(doc?.enabled, String(process.env.SUPPORT_AI_ENABLED || 'false') === 'true');

  let apiKey = decrypt(doc?.apiKeyEncrypted);
  if (!apiKey) apiKey = String(process.env.SUPPORT_AI_API_KEY || '');
  if (!apiKey && PROVIDERS[provider]?.keyEnv) apiKey = String(process.env[PROVIDERS[provider].keyEnv] || '');

  const fallbacks = (doc?.fallbacks && doc.fallbacks.length > 0 ? doc.fallbacks : envFallbacks()).map((entry) => {
    const fallbackKey =
      (entry.keyEnv && process.env[entry.keyEnv]) ||
      process.env.SUPPORT_AI_API_KEY ||
      (PROVIDERS[entry.provider]?.keyEnv ? process.env[PROVIDERS[entry.provider].keyEnv] : '') ||
      '';
    return {
      provider: entry.provider,
      model: entry.model,
      apiKey: String(fallbackKey || ''),
      baseUrl: fallbackBaseUrlFor(entry.provider),
    };
  });

  return {
    enabled: enabled && Boolean(provider) && Boolean(model),
    provider,
    model,
    baseUrl,
    apiKey,
    temperature: num(doc?.temperature, num(process.env.SUPPORT_AI_TEMPERATURE, 0.2)),
    maxOutputTokens: num(doc?.maxOutputTokens, num(process.env.SUPPORT_AI_MAX_OUTPUT_TOKENS, 400)),
    timeoutMs: num(doc?.timeoutMs, num(process.env.SUPPORT_AI_TIMEOUT_MS, 20_000)),
    dailyTokenBudget: num(doc?.dailyTokenBudget, num(process.env.SUPPORT_AI_DAILY_TOKEN_BUDGET, 200_000)),
    fallbacks,
    configured: Boolean(provider) && Boolean(model) && Boolean(baseUrl),
    source: doc && doc.provider ? 'database' : 'environment',
  };
}

/** Browser-safe settings (key masked). */
async function maskedSettings() {
  const effective = await getEffectiveSettings();
  return {
    enabled: effective.enabled,
    provider: effective.provider,
    model: effective.model,
    baseUrl: effective.baseUrl,
    hasKey: Boolean(effective.apiKey),
    keyLast4: keyLast4(effective.apiKey),
    temperature: effective.temperature,
    maxOutputTokens: effective.maxOutputTokens,
    timeoutMs: effective.timeoutMs,
    dailyTokenBudget: effective.dailyTokenBudget,
    fallbacks: effective.fallbacks.map((entry) => ({ provider: entry.provider, model: entry.model, hasKey: Boolean(entry.apiKey) })),
    configured: effective.configured,
    source: effective.source,
    providers: Object.entries(PROVIDERS).map(([id, entry]) => ({
      id,
      label: entry.label,
      needsKey: Boolean(entry.keyEnv),
      defaultBaseUrl: entry.baseUrl,
      note: entry.note || null,
    })),
    envNames: [
      'SUPPORT_AI_ENABLED',
      'SUPPORT_AI_PROVIDER',
      'SUPPORT_AI_MODEL',
      'SUPPORT_AI_API_KEY',
      'SUPPORT_AI_BASE_URL',
      'SUPPORT_AI_TEMPERATURE',
      'SUPPORT_AI_MAX_OUTPUT_TOKENS',
      'SUPPORT_AI_TIMEOUT_MS',
      'SUPPORT_AI_DAILY_TOKEN_BUDGET',
      'SUPPORT_AI_FALLBACKS',
      'AI_SETTINGS_SECRET',
      'AI_ALLOWED_LOCAL_HOSTS',
    ],
  };
}

/** Save admin changes. Only supplied fields are written. */
async function updateSettings(input = {}) {
  const doc = (await AiSettings.findOne({ key: 'global' })) || new AiSettings({ key: 'global' });
  const body = input || {};

  if (body.provider !== undefined) {
    if (body.provider && !PROVIDERS[body.provider]) {
      throw new AiError('unavailable', `Unknown provider "${body.provider}".`);
    }
    doc.provider = body.provider || null;
  }
  if (body.model !== undefined) doc.model = body.model ? String(body.model).slice(0, 120) : null;
  if (body.enabled !== undefined) doc.enabled = Boolean(body.enabled);
  if (body.temperature !== undefined) doc.temperature = Math.min(2, Math.max(0, Number(body.temperature) || 0));
  if (body.maxOutputTokens !== undefined) doc.maxOutputTokens = Math.min(8000, Math.max(1, Number(body.maxOutputTokens) || 400));
  if (body.timeoutMs !== undefined) doc.timeoutMs = Math.min(120_000, Math.max(1000, Number(body.timeoutMs) || 20_000));
  if (body.dailyTokenBudget !== undefined) {
    doc.dailyTokenBudget = Math.min(100_000_000, Math.max(1000, Number(body.dailyTokenBudget) || 200_000));
  }
  if (body.baseUrl !== undefined) {
    if (!body.baseUrl) doc.baseUrl = null;
    else {
      const checked = await validateBaseUrl(body.baseUrl);
      if (!checked.ok) throw new AiError('unavailable', checked.message);
      doc.baseUrl = String(body.baseUrl).trim();
    }
  }
  if (body.apiKey !== undefined) {
    const key = String(body.apiKey || '').trim();
    if (key) {
      doc.apiKeyEncrypted = encrypt(key);
      doc.apiKeyLast4 = keyLast4(key);
    }
  }
  if (body.clearKey === true) {
    doc.apiKeyEncrypted = null;
    doc.apiKeyLast4 = null;
  }
  if (Array.isArray(body.fallbacks)) {
    doc.fallbacks = body.fallbacks
      .slice(0, 5)
      .map((entry) => ({
        provider: String(entry?.provider || ''),
        model: String(entry?.model || '').slice(0, 120),
        keyEnv: entry?.keyEnv ? String(entry.keyEnv).slice(0, 60) : null,
      }))
      .filter((entry) => PROVIDERS[entry.provider] && entry.model);
  }

  await doc.save();
  invalidate();
  return maskedSettings();
}

module.exports = {
  AiSettings,
  getEffectiveSettings,
  updateSettings,
  maskedSettings,
  keyLast4,
  invalidate,
};
