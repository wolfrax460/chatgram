/**
 * A time-boxed admin security-review session (9d).
 *
 * Opening a user's conversations never happens from a bare session: the admin
 * must first write a reason, which creates one of these records. Every read is
 * audited against it, it expires after 15 minutes of inactivity, and it can
 * only be used by the admin panel session that created it.
 */
const mongoose = require('mongoose');

const reviewSessionSchema = new mongoose.Schema(
  {
    adminSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminSession', required: true, index: true },
    // The account whose content is being reviewed.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    // Optional ticket/report reference the review relates to.
    reference: { type: String, default: '', trim: true, maxlength: 120 },
    scope: { type: String, enum: ['conversations', 'search'], default: 'conversations' },
    status: { type: String, enum: ['active', 'ended', 'expired'], default: 'active', index: true },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now, index: true },
    lastActivityAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
    endedAt: { type: Date, default: null },
    // How many content reads (message pages) this review performed.
    views: { type: Number, default: 0 },
  },
  { timestamps: false },
);

reviewSessionSchema.index({ createdAt: -1 });
reviewSessionSchema.index({ adminSessionId: 1, createdAt: -1 });

module.exports = mongoose.models.ReviewSession || mongoose.model('ReviewSession', reviewSessionSchema);
