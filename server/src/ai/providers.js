/**
 * Multi-provider registry + per-feature routing (item 9c).
 *
 * Providers are stored in the AiSettings document with encrypted keys (same
 * AES-256-GCM scheme as the single-provider settings). Keys are never returned:
 * listProviders exposes only hasKey + last4. Feature assignments map a feature
 * (chatgramAI, support, help) to a primary provider key and a fallback order.
 * One undo step is kept.
 */
const { AiSettings, encrypt, decrypt, keyLast4, invalidate } = require('./settings');
const { PROVIDERS } = require('./adapters');
const { validateBaseUrl } = require('./ssrf');
const { AiError } = require('./errors');

const FEATURES = ['chatgramAI', 'support', 'help'];
const FEATURE_LABELS = { chatgramAI: 'Chatgram AI assistant', support: 'Chatgram Support replies', help: 'Help widget assistant' };

const health = new Map(); // providerKey -> stats

function recordHealth(key, patch = {}) {
  if (!key) return;
  const current = health.get(key) || {
    requests: 0,
    successes: 0,
    failures: 0,
    tokens: 0,
    latencyTotal: 0,
    latencyCount: 0,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorCode: null,
  };
  const next = { ...current };
  if (patch.ok === true) {
    next.requests += 1;
    next.successes += 1;
    next.tokens += Number(patch.tokens) || 0;
    if (typeof patch.latencyMs === 'number') {
      next.latencyTotal += patch.latencyMs;
      next.latencyCount += 1;
    }
    next.lastSuccessAt = new Date().toISOString();
  } else if (patch.ok === false) {
    next.requests += 1;
    next.failures += 1;
    next.lastErrorAt = new Date().toISOString();
    next.lastErrorCode = patch.error || 'unknown';
  }
  health.set(key, next);
}

function healthFor(key) {
  const stats = health.get(key);
  if (!stats) return null;
  return {
    ...stats,
    averageLatencyMs: stats.latencyCount ? Math.round(stats.latencyTotal / stats.latencyCount) : null,
    errorRate: stats.requests ? Math.round((stats.failures / stats.requests) * 100) : 0,
  };
}

async function rawDoc() {
  try {
    return (await AiSettings.findOne({ key: 'global' })) || null;
  } catch {
    return null;
  }
}

function sanitize(entry) {
  return {
    key: entry.key,
    label: entry.label || entry.key,
    provider: entry.provider,
    model: entry.model,
    baseUrl: entry.baseUrl || PROVIDERS[entry.provider]?.baseUrl || '',
    enabled: entry.enabled !== false,
    timeoutMs: entry.timeoutMs || 20000,
    dailyTokenBudget: entry.dailyTokenBudget || 200000,
    hasKey: Boolean(entry.apiKeyEncrypted),
    keyLast4: entry.apiKeyLast4 || '',
    health: healthFor(entry.key),
  };
}

async function listProviders() {
  const doc = await rawDoc();
  const providers = (doc?.providers || []).map(sanitize);
  const features = {};
  for (const feature of FEATURES) {
    const assignment = doc?.features?.[feature];
    features[feature] = {
      label: FEATURE_LABELS[feature],
      primary: assignment?.primary || null,
      fallbacks: Array.isArray(assignment?.fallbacks) ? assignment.fallbacks : [],
    };
  }
  return {
    providers,
    features,
    availableProviders: Object.entries(PROVIDERS).map(([id, entry]) => ({
      id,
      label: entry.label,
      needsKey: Boolean(entry.keyEnv),
      defaultBaseUrl: entry.baseUrl,
    })),
    canUndo: Boolean(doc?.lastFeatureChange),
  };
}

async function upsertProvider(input = {}) {
  const provider = String(input.provider || '').trim();
  if (!PROVIDERS[provider]) throw new AiError('unavailable', `Unknown provider "${provider}".`);
  const model = String(input.model || '').trim();
  if (!model) throw new AiError('unavailable', 'A model name is required.');
  const key = String(input.key || input.label || provider)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || provider;

  let baseUrl = String(input.baseUrl || PROVIDERS[provider]?.baseUrl || '').trim();
  if (input.baseUrl) {
    const checked = await validateBaseUrl(baseUrl);
    if (!checked.ok) throw new AiError('unavailable', checked.message);
  }

  const doc = (await AiSettings.findOne({ key: 'global' })) || new AiSettings({ key: 'global' });
  const existing = (doc.providers || []).find((entry) => entry.key === key);
  const next = {
    key,
    label: String(input.label || existing?.label || provider).slice(0, 80),
    provider,
    model: model.slice(0, 120),
    baseUrl,
    enabled: input.enabled === undefined ? existing?.enabled !== false : Boolean(input.enabled),
    timeoutMs: Math.min(120000, Math.max(1000, Number(input.timeoutMs) || existing?.timeoutMs || 20000)),
    dailyTokenBudget: Math.min(100000000, Math.max(1000, Number(input.dailyTokenBudget) || existing?.dailyTokenBudget || 200000)),
    apiKeyEncrypted: existing?.apiKeyEncrypted || null,
    apiKeyLast4: existing?.apiKeyLast4 || null,
  };
  const apiKey = String(input.apiKey || '').trim();
  if (apiKey) {
    next.apiKeyEncrypted = encrypt(apiKey);
    next.apiKeyLast4 = keyLast4(apiKey);
  }
  if (input.clearKey === true) {
    next.apiKeyEncrypted = null;
    next.apiKeyLast4 = null;
  }

  const providers = [...(doc.providers || [])];
  const index = providers.findIndex((entry) => entry.key === key);
  if (index >= 0) providers[index] = next;
  else providers.push(next);
  doc.providers = providers;
  await doc.save();
  invalidate();
  return sanitize(next);
}

async function deleteProvider(key) {
  const doc = await AiSettings.findOne({ key: 'global' });
  if (!doc) throw new AiError('unavailable', 'No provider settings stored.');
  doc.providers = (doc.providers || []).filter((entry) => entry.key !== key);
  const features = doc.features || {};
  for (const feature of FEATURES) {
    const assignment = features[feature];
    if (!assignment) continue;
    if (assignment.primary === key) assignment.primary = null;
    assignment.fallbacks = (assignment.fallbacks || []).filter((fallbackKey) => fallbackKey !== key);
  }
  doc.features = features;
  doc.markModified('features');
  await doc.save();
  invalidate();
  return { message: 'Provider deleted.' };
}

async function testProvider(key) {
  const doc = await rawDoc();
  const entry = (doc?.providers || []).find((candidate) => candidate.key === key);
  if (!entry) throw new AiError('unavailable', 'Provider not found.');
  const apiKey = decrypt(entry.apiKeyEncrypted);
  const { service } = require('./service');
  const started = Date.now();
  const result = await service.testConnection({
    provider: entry.provider,
    model: entry.model,
    baseUrl: entry.baseUrl || PROVIDERS[entry.provider]?.baseUrl || '',
    apiKey,
  });
  if (result.ok) recordHealth(entry.key, { ok: true, latencyMs: Date.now() - started, tokens: 0 });
  else recordHealth(entry.key, { ok: false, error: result.code || 'unavailable' });
  return { ...result, key: entry.key, testedAt: new Date().toISOString() };
}

function validateAssignment(features, providers) {
  const keys = new Set(providers.map((entry) => entry.key));
  for (const feature of FEATURES) {
    const assignment = features?.[feature];
    if (!assignment) continue;
    if (assignment.primary && !keys.has(assignment.primary)) {
      throw new AiError('unavailable', `Unknown primary provider for ${FEATURE_LABELS[feature]}.`);
    }
    for (const fallback of assignment.fallbacks || []) {
      if (!keys.has(fallback)) throw new AiError('unavailable', `Unknown fallback provider for ${FEATURE_LABELS[feature]}.`);
    }
  }
}

async function setFeatures(input = {}) {
  const doc = (await AiSettings.findOne({ key: 'global' })) || new AiSettings({ key: 'global' });
  const providers = doc.providers || [];
  const incoming = input.features || {};
  const next = {};
  for (const feature of FEATURES) {
    const assignment = incoming[feature];
    if (!assignment) continue;
    next[feature] = {
      primary: assignment.primary || null,
      fallbacks: Array.isArray(assignment.fallbacks) ? assignment.fallbacks.slice(0, 5) : [],
    };
  }
  validateAssignment(next, providers);
  doc.lastFeatureChange = {
    features: JSON.parse(JSON.stringify(doc.features || {})),
    at: new Date().toISOString(),
    by: String(input.by || 'admin').slice(0, 80),
  };
  doc.features = next;
  doc.markModified('features');
  doc.markModified('lastFeatureChange');
  await doc.save();
  invalidate();
  return listProviders();
}

async function undoLastChange() {
  const doc = await AiSettings.findOne({ key: 'global' });
  if (!doc || !doc.lastFeatureChange?.features) throw new AiError('unavailable', 'Nothing to undo.');
  doc.features = doc.lastFeatureChange.features;
  doc.lastFeatureChange = null;
  doc.markModified('features');
  doc.markModified('lastFeatureChange');
  await doc.save();
  invalidate();
  return listProviders();
}

/** Chain for one feature; null when the feature has no assignment. */
async function resolveFeatureChain(feature) {
  const doc = await rawDoc();
  const assignment = doc?.features?.[feature];
  if (!assignment || (!assignment.primary && (assignment.fallbacks || []).length === 0)) return null;
  const providers = doc.providers || [];
  const order = [assignment.primary, ...(assignment.fallbacks || [])].filter(Boolean);
  const chain = [];
  for (const key of order) {
    const entry = providers.find((candidate) => candidate.key === key);
    if (!entry || entry.enabled === false) continue;
    chain.push({
      key: entry.key,
      provider: entry.provider,
      model: entry.model,
      baseUrl: entry.baseUrl || PROVIDERS[entry.provider]?.baseUrl || '',
      apiKey: decrypt(entry.apiKeyEncrypted),
    });
  }
  return chain.length > 0 ? chain : null;
}

module.exports = {
  FEATURES,
  listProviders,
  upsertProvider,
  deleteProvider,
  testProvider,
  setFeatures,
  undoLastChange,
  resolveFeatureChain,
  recordHealth,
  healthFor,
};
