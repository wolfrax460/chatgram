/**
 * Empty-screen recommendations (item 4).
 *
 * One card is shown when no chat is selected; the list is server-driven so it can
 * be edited in /web/admin (Announcements page). Recommendations can be hidden for
 * people who already did the thing (2FA on, profile photo set) and dismissed per
 * user. Nothing here claims a feature that does not exist.
 */
const mongoose = require('mongoose');

const recommendationSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, default: '', maxlength: 300 },
    ctaLabel: { type: String, default: 'Open', maxlength: 40 },
    // What the button does in the app. 'ai' opens Chatgram AI, 'downloads' opens
    // the download page, 'profile' opens Settings, 'invite' shares the app link.
    action: { type: String, enum: ['ai', 'downloads', 'profile', 'invite', 'url'], default: 'url' },
    url: { type: String, default: '', maxlength: 500 },
    enabled: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    // Hide the card when the user already completed the thing.
    hideWhen: { type: String, enum: ['never', 'twoFactor', 'profilePhoto'], default: 'never' },
  },
  { timestamps: true },
);

const Recommendation = mongoose.models.Recommendation || mongoose.model('Recommendation', recommendationSchema);

const DEFAULTS = [
  {
    key: 'download-apps',
    title: 'Chatgram for Windows and Android',
    body: 'Use Chatgram on your desktop and phone — same chats, same files.',
    ctaLabel: 'See downloads',
    action: 'downloads',
    order: 10,
    hideWhen: 'never',
  },
  {
    key: 'two-step-verification',
    title: 'Turn on two-step verification',
    body: 'Add a second step at sign-in so a stolen password is not enough.',
    ctaLabel: 'Open security settings',
    action: 'profile',
    order: 20,
    hideWhen: 'twoFactor',
  },
  {
    key: 'profile-photo',
    title: 'Add a profile photo',
    body: 'Help people recognise you in chats, groups and status replies.',
    ctaLabel: 'Edit profile',
    action: 'profile',
    order: 30,
    hideWhen: 'profilePhoto',
  },
  {
    key: 'ask-chatgram-ai',
    title: 'Ask Chatgram AI anything',
    body: 'Questions, writing, translations (EN/RW/FR/SW), summaries and code help.',
    ctaLabel: 'Open Chatgram AI',
    action: 'ai',
    order: 40,
    hideWhen: 'never',
  },
  {
    key: 'invite-a-friend',
    title: 'Invite a friend to Chatgram',
    body: 'Share your Chatgram link and start a conversation today.',
    ctaLabel: 'Share invite',
    action: 'invite',
    order: 50,
    hideWhen: 'never',
  },
];

/** Seed the default list once (idempotent: only inserts missing keys). */
async function ensureDefaults() {
  const count = await Recommendation.estimatedDocumentCount();
  if (count > 0) return;
  await Recommendation.insertMany(DEFAULTS.map((row) => ({ ...row, enabled: true })));
}

function serialize(row) {
  return {
    key: row.key,
    title: row.title,
    body: row.body || '',
    ctaLabel: row.ctaLabel || 'Open',
    action: row.action || 'url',
    url: row.url || '',
    enabled: row.enabled !== false,
    order: row.order || 0,
    hideWhen: row.hideWhen || 'never',
  };
}

function completedFor(row, user) {
  if (row.hideWhen === 'twoFactor') return user?.twoFactorEnabled === true;
  if (row.hideWhen === 'profilePhoto') return Boolean(user?.avatarUrl);
  return false;
}

/** Authenticated user list: enabled, not completed, not dismissed, sorted. */
async function listForUser(user) {
  await ensureDefaults();
  const rows = await Recommendation.find({ enabled: true }).sort({ order: 1, key: 1 }).lean();
  const dismissed = new Set((user?.dismissedRecommendations || []).map(String));
  return rows
    .filter((row) => !dismissed.has(row.key) && !completedFor(row, user))
    .map((row) => {
      const item = serialize(row);
      // Users only get what the card needs; enabled/order/hideWhen are admin fields.
      delete item.enabled;
      delete item.order;
      delete item.hideWhen;
      return item;
    });
}

async function dismissForUser(userId, key) {
  const exists = await Recommendation.findOne({ key: String(key) });
  if (!exists) return false;
  await mongoose.model('User').updateOne({ _id: userId }, { $addToSet: { dismissedRecommendations: String(key) } });
  return true;
}

async function listAll() {
  await ensureDefaults();
  const rows = await Recommendation.find({}).sort({ order: 1, key: 1 }).lean();
  return rows.map(serialize);
}

/** Replace the editable fields of the whole list (admin editor). */
async function updateAll(items) {
  if (!Array.isArray(items)) {
    const error = new Error('Send an array of recommendations.');
    error.code = 'INVALID';
    throw error;
  }
  if (items.length > 30) {
    const error = new Error('At most 30 recommendations are supported.');
    error.code = 'INVALID';
    throw error;
  }
  const allowedActions = ['ai', 'downloads', 'profile', 'invite', 'url'];
  const allowedHide = ['never', 'twoFactor', 'profilePhoto'];
  const seen = new Set();
  const writes = [];
  for (const [index, raw] of items.entries()) {
    const key = String(raw?.key || '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    if (!key) {
      const error = new Error(`Recommendation ${index + 1} needs a key.`);
      error.code = 'INVALID';
      throw error;
    }
    if (seen.has(key)) {
      const error = new Error(`Duplicate recommendation key "${key}".`);
      error.code = 'INVALID';
      throw error;
    }
    seen.add(key);
    const action = allowedActions.includes(raw.action) ? raw.action : 'url';
    const hideWhen = allowedHide.includes(raw.hideWhen) ? raw.hideWhen : 'never';
    const title = String(raw.title || '').trim().slice(0, 120);
    if (!title) {
      const error = new Error(`Recommendation "${key}" needs a title.`);
      error.code = 'INVALID';
      throw error;
    }
    writes.push({
      updateOne: {
        filter: { key },
        update: {
          $set: {
            title,
            body: String(raw.body || '').trim().slice(0, 300),
            ctaLabel: String(raw.ctaLabel || 'Open').trim().slice(0, 40) || 'Open',
            action,
            url: action === 'url' ? String(raw.url || '').trim().slice(0, 500) : '',
            enabled: raw.enabled !== false,
            order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : index * 10,
            hideWhen,
          },
        },
        upsert: true,
      },
    });
  }
  // Remove rows the editor deleted (defaults are re-seeded only when the whole
  // collection is empty, so deliberate deletions stick).
  const keep = [...seen];
  await Recommendation.deleteMany({ key: { $nin: keep } });
  if (writes.length) await Recommendation.bulkWrite(writes);
  return listAll();
}

module.exports = {
  Recommendation,
  DEFAULTS,
  ensureDefaults,
  listForUser,
  dismissForUser,
  listAll,
  updateAll,
};
