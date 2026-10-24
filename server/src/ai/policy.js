/**
 * Admin-editable AI policy (item 9e / step 4): blocked topics, per-user limits and
 * the max input size. Stored in the AiSettings document; env vars remain defaults.
 */
const { AiSettings, invalidate } = require('./settings');
const { AiError } = require('./errors');

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envTopics() {
  return String(process.env.AI_BLOCKED_TOPICS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function shape(doc) {
  const policy = doc?.aiPolicy || {};
  return {
    blockedTopics: Array.isArray(policy.blockedTopics) && policy.blockedTopics.length > 0 ? policy.blockedTopics : envTopics(),
    hourlyLimit: Number(policy.hourlyLimit) > 0 ? Number(policy.hourlyLimit) : envNumber('AI_HOURLY_LIMIT', 30),
    dailyLimit: Number(policy.dailyLimit) > 0 ? Number(policy.dailyLimit) : envNumber('AI_DAILY_LIMIT', 200),
    maxInputChars: Number(policy.maxInputChars) > 0 ? Number(policy.maxInputChars) : envNumber('AI_MAX_INPUT_CHARS', 4000),
    alertsEnabled: policy.alertsEnabled === true || String(process.env.AI_ALERT_NOTIFY || '') === 'true',
    updatedAt: policy.updatedAt || null,
    source: policy.updatedAt ? 'database' : 'environment',
  };
}

async function getPolicy() {
  try {
    const doc = await AiSettings.findOne({ key: 'global' });
    return shape(doc);
  } catch {
    return shape(null);
  }
}

async function updatePolicy(patch = {}) {
  const doc = (await AiSettings.findOne({ key: 'global' })) || new AiSettings({ key: 'global' });
  const current = shape(doc);
  const next = {
    blockedTopics: current.blockedTopics,
    hourlyLimit: current.hourlyLimit,
    dailyLimit: current.dailyLimit,
    maxInputChars: current.maxInputChars,
    alertsEnabled: current.alertsEnabled,
    updatedAt: new Date(),
  };
  if (Array.isArray(patch.blockedTopics)) {
    next.blockedTopics = patch.blockedTopics
      .map((entry) => String(entry || '').trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 100);
  } else if (typeof patch.blockedTopics === 'string') {
    next.blockedTopics = patch.blockedTopics.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean).slice(0, 100);
  }
  if (patch.hourlyLimit !== undefined) {
    const value = Number(patch.hourlyLimit);
    if (!Number.isFinite(value) || value < 1 || value > 10000) throw new AiError('unavailable', 'Hourly limit must be between 1 and 10000.');
    next.hourlyLimit = Math.floor(value);
  }
  if (patch.dailyLimit !== undefined) {
    const value = Number(patch.dailyLimit);
    if (!Number.isFinite(value) || value < 1 || value > 100000) throw new AiError('unavailable', 'Daily limit must be between 1 and 100000.');
    next.dailyLimit = Math.floor(value);
  }
  if (patch.maxInputChars !== undefined) {
    const value = Number(patch.maxInputChars);
    if (!Number.isFinite(value) || value < 100 || value > 20000) throw new AiError('unavailable', 'Max input must be between 100 and 20000 characters.');
    next.maxInputChars = Math.floor(value);
  }
  if (patch.alertsEnabled !== undefined) next.alertsEnabled = Boolean(patch.alertsEnabled);
  doc.aiPolicy = next;
  doc.markModified('aiPolicy');
  await doc.save();
  invalidate();
  return shape(doc);
}

module.exports = { getPolicy, updatePolicy };
