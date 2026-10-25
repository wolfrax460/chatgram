/**
 * Admin announcements/broadcasts (9b item 8).
 *
 * kind 'banner': an in-app banner shown at the top of the chat list while the
 *   publish window is open.
 * kind 'message': a real direct message sent from the official Chatgram account
 *   (support account, falling back to the configured admin account) to every
 *   recipient in a segment, either immediately or scheduled.
 */
const mongoose = require('mongoose');

const broadcastSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['banner', 'message'], required: true },
    title: { type: String, default: '', trim: true, maxlength: 120 },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    link: { type: String, default: '', trim: true, maxlength: 300 },
    segment: { type: String, enum: ['all', 'active', 'new', 'selected'], default: 'all' },
    // Only used by the 'selected' segment (tests, individual follow-ups).
    recipientIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed'],
      default: 'draft',
      index: true,
    },
    scheduledAt: { type: Date, default: null, index: true },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    recipientCount: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    createdBy: { type: String, default: '' },
    publishedAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);

broadcastSchema.index({ kind: 1, status: 1, createdAt: -1 });

module.exports = mongoose.models.Broadcast || mongoose.model('Broadcast', broadcastSchema);
