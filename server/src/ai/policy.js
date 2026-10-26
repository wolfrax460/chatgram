/**
 * Admin-editable AI policy (item 9e / step 4): blocked topics, per-user limits and
 * the max input size. Stored in the AiSettings document; env vars remain defaults.
 *
 * The `group*` fields are the group "@Chatgram AI" safety/limit knobs added with
 * the Oct-26 mention fix. They are part of the same "AI safety & limits" record
 * (AiSettings.aiPolicy) and are validated by the same PUT /api/admin/ai/policy
 * endpoint. The web panel does not render them yet — the server API was the
 * deliverable for that fix (see docs/reports/ai-mentions.md for the web wiring).
 */
const { AiSettings, invalidate } = require('./settings');
const { AiError } = require('./errors');

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envZeroNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function envTopics() {
  return String(process.env.AI_BLOCKED_TOPICS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

const GROUP_DEFAULTS = {
  groupUserHourlyLimit: 10,
  groupChatHourlyLimit: 60,
  groupQueueLimit: 5,
  groupMaxInputChars: 2000,
  groupMaxOutputTokens: 1200,
  // A separate notice for every mention would be spam; one per user per minute.
  groupNoticeCooldownMs: 60 * 1000,
  // Minimum gap between two idle answers in the same group (kept from the
  // original implementation, but now it produces a visible notice, not silence).
  groupMinGapMs: 20 * 1000,
};

function shape(doc) {
  const policy = doc?.aiPolicy || {};
  const group = policy.group || {};
  return {
    blockedTopics: Array.isArray(policy.blockedTopics) && policy.blockedTopics.length > 0 ? policy.blockedTopics : envTopics(),
    hourlyLimit: Number(policy.hourlyLimit) > 0 ? Number(policy.hourlyLimit) : envNumber('AI_HOURLY_LIMIT', 30),
    dailyLimit: Number(policy.dailyLimit) > 0 ? Number(policy.dailyLimit) : envNumber('AI_DAILY_LIMIT', 200),
    maxInputChars: Number(policy.maxInputChars) > 0 ? Number(policy.maxInputChars) : envNumber('AI_MAX_INPUT_CHARS', 4000),
    alertsEnabled: policy.alertsEnabled === true || String(process.env.AI_ALERT_NOTIFY || '') === 'true',
    updatedAt: policy.updatedAt || null,
    source: policy.updatedAt ? 'database' : 'environment',
    // Group "@Chatgram AI" limits (admin-editable, server API).
    groupUserHourlyLimit:
      Number(group.userHourlyLimit) > 0 ? Number(group.userHourlyLimit) : envNumber('GROUP_AI_USER_HOURLY_LIMIT', GROUP_DEFAULTS.groupUserHourlyLimit),
    groupChatHourlyLimit:
      Number(group.chatHourlyLimit) > 0 ? Number(group.chatHourlyLimit) : envNumber('GROUP_AI_CHAT_HOURLY_LIMIT', GROUP_DEFAULTS.groupChatHourlyLimit),
    groupQueueLimit:
      Number(group.queueLimit) > 0 ? Number(group.queueLimit) : envNumber('GROUP_AI_QUEUE_LIMIT', GROUP_DEFAULTS.groupQueueLimit),
    groupMaxInputChars:
      Number(group.maxInputChars) > 0 ? Number(group.maxInputChars) : envNumber('GROUP_AI_MAX_INPUT_CHARS', GROUP_DEFAULTS.groupMaxInputChars),
    groupMaxOutputTokens:
      Number(group.maxOutputTokens) > 0 ? Number(group.maxOutputTokens) : envNumber('GROUP_AI_MAX_OUTPUT_TOKENS', GROUP_DEFAULTS.groupMaxOutputTokens),
    groupNoticeCooldownMs:
      Number(group.noticeCooldownMs) >= 0 ? Number(group.noticeCooldownMs) : envZeroNumber('GROUP_AI_NOTICE_COOLDOWN_MS', GROUP_DEFAULTS.groupNoticeCooldownMs),
    groupMinGapMs: Number(group.minGapMs) >= 0 ? Number(group.minGapMs) : envZeroNumber('GROUP_AI_MIN_GAP_MS', GROUP_DEFAULTS.groupMinGapMs),
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

function intInRange(value, min, max, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new AiError('unavailable', `${label} must be between ${min} and ${max}.`);
  }
  return Math.floor(number);
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
    group: {
      userHourlyLimit: current.groupUserHourlyLimit,
      chatHourlyLimit: current.groupChatHourlyLimit,
      queueLimit: current.groupQueueLimit,
      maxInputChars: current.groupMaxInputChars,
      maxOutputTokens: current.groupMaxOutputTokens,
      noticeCooldownMs: current.groupNoticeCooldownMs,
      minGapMs: current.groupMinGapMs,
    },
  };
  if (Array.isArray(patch.blockedTopics)) {
    next.blockedTopics = patch.blockedTopics
      .map((entry) => String(entry || '').trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 100);
  } else if (typeof patch.blockedTopics === 'string') {
    next.blockedTopics = patch.blockedTopics.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean).slice(0, 100);
  }
  if (patch.hourlyLimit !== undefined) next.hourlyLimit = intInRange(patch.hourlyLimit, 1, 10000, 'Hourly limit');
  if (patch.dailyLimit !== undefined) next.dailyLimit = intInRange(patch.dailyLimit, 1, 100000, 'Daily limit');
  if (patch.maxInputChars !== undefined) next.maxInputChars = intInRange(patch.maxInputChars, 100, 20000, 'Max input');
  if (patch.alertsEnabled !== undefined) next.alertsEnabled = Boolean(patch.alertsEnabled);

  // Group limits can be sent flat (groupUserHourlyLimit) or nested under `group`.
  const group = patch.group && typeof patch.group === 'object' ? patch.group : {};
  const pick = (flat, nested) => (patch[flat] !== undefined ? patch[flat] : group[nested]);
  if (pick('groupUserHourlyLimit', 'userHourlyLimit') !== undefined) {
    next.group.userHourlyLimit = intInRange(pick('groupUserHourlyLimit', 'userHourlyLimit'), 1, 1000, 'Group per-user hourly limit');
  }
  if (pick('groupChatHourlyLimit', 'chatHourlyLimit') !== undefined) {
    next.group.chatHourlyLimit = intInRange(pick('groupChatHourlyLimit', 'chatHourlyLimit'), 1, 10000, 'Group hourly limit');
  }
  if (pick('groupQueueLimit', 'queueLimit') !== undefined) {
    next.group.queueLimit = intInRange(pick('groupQueueLimit', 'queueLimit'), 1, 50, 'Group queue length');
  }
  if (pick('groupMaxInputChars', 'maxInputChars') !== undefined) {
    next.group.maxInputChars = intInRange(pick('groupMaxInputChars', 'maxInputChars'), 100, 20000, 'Group max input');
  }
  if (pick('groupMaxOutputTokens', 'maxOutputTokens') !== undefined) {
    next.group.maxOutputTokens = intInRange(pick('groupMaxOutputTokens', 'maxOutputTokens'), 100, 8000, 'Group max output tokens');
  }
  if (pick('groupNoticeCooldownMs', 'noticeCooldownMs') !== undefined) {
    next.group.noticeCooldownMs = intInRange(pick('groupNoticeCooldownMs', 'noticeCooldownMs'), 0, 600000, 'Group notice cooldown');
  }
  if (pick('groupMinGapMs', 'minGapMs') !== undefined) {
    next.group.minGapMs = intInRange(pick('groupMinGapMs', 'minGapMs'), 0, 300000, 'Group minimum gap');
  }

  doc.aiPolicy = next;
  doc.markModified('aiPolicy');
  await doc.save();
  invalidate();
  return shape(doc);
}

module.exports = { getPolicy, updatePolicy, GROUP_DEFAULTS };
