/**
 * A signed-in device/session for a user (9b Users extras + 9d devices view).
 * Recorded on login, touched on refresh; the token itself is never stored.
 */
const mongoose = require('mongoose');

const userSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '', maxlength: 300 },
    deviceLabel: { type: String, default: '', maxlength: 120 },
    createdAt: { type: Date, default: Date.now, index: true },
    lastSeenAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: false },
);

userSessionSchema.index({ userId: 1, lastSeenAt: -1 });
userSessionSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

module.exports = mongoose.models.UserSession || mongoose.model('UserSession', userSessionSchema);
