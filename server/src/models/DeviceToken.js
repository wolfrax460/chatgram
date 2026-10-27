/**
 * A registered FCM device token for one user (Android app or web push).
 *
 * One row per token; re-registering the same device updates the row instead of
 * duplicating it. `invalid` marks tokens Firebase rejected as permanently
 * unregistered, so the sender stops retrying them until the app registers anew.
 */
const mongoose = require('mongoose');

const deviceTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    token: { type: String, required: true, unique: true },
    platform: { type: String, enum: ['android', 'web'], required: true },
    deviceLabel: { type: String, default: '', maxlength: 80 },
    createdAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    invalid: { type: Boolean, default: false },
  },
  { timestamps: false },
);

deviceTokenSchema.index({ userId: 1, token: 1 });

module.exports =
  mongoose.models.DeviceToken || mongoose.model('DeviceToken', deviceTokenSchema);
