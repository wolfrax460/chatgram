/**
 * Persisted metrics for group "@Chatgram AI" mentions.
 *
 * One row per mention event so the admin Chatgram AI usage page can report the
 * last 24 h (answered / queued / rejected by reason / failed) and the per-user /
 * per-group hourly caps can be counted without keeping process memory. Rows are
 * intentionally tiny and contain no message text (no user content, no prompts) —
 * only ids, a reason code and the provider key. A 30-day TTL keeps the
 * collection small.
 */
const mongoose = require('mongoose');

const groupAiEventSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['answered', 'queued', 'rejected', 'failed'], required: true },
    // Short machine reason (rate_gap, user_hourly, chat_hourly, queue_full,
    // too_long, blocked, feature_off, no_system_account, <provider error code>).
    reason: { type: String, default: null },
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', default: null },
    askerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    providerKey: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

groupAiEventSchema.index({ type: 1, createdAt: -1 });
groupAiEventSchema.index({ askerId: 1, type: 1, createdAt: -1 });
groupAiEventSchema.index({ chatId: 1, type: 1, createdAt: -1 });
groupAiEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.models.GroupAiEvent || mongoose.model('GroupAiEvent', groupAiEventSchema);
