/**
 * A pending one-time code (email verification / phone OTP).
 *
 * This used to live in a `Map` inside the API process. That is why users said
 * codes "expire too quickly": a PM2 restart, a second API instance or a rolling
 * deploy dropped every pending code, so a code the user was still typing was
 * suddenly "expired". One row per `channel:target`, shared by all instances.
 *
 * The code itself is never stored: only a keyed hash (see utils/verificationStore).
 * `expiresAt` is the lifetime; the TTL index removes the row a little later so
 * the API can still answer "expired" instead of the ambiguous "no code".
 */
const mongoose = require('mongoose');

const verificationCodeSchema = new mongoose.Schema(
  {
    channel: { type: String, enum: ['email', 'phone'], required: true },
    // Normalized (lower-cased email / digits-only phone) so one address always
    // maps to one row.
    target: { type: String, required: true },
    codeHash: { type: String, required: true },
    // A re-send replaces the code above, but the copy already in the user's
    // inbox stays usable until its own expiry (see issue() in the store): users
    // tap "resend" when delivery is slow, then type whichever mail arrived.
    previousCodeHash: { type: String, default: null },
    previousExpiresAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// One code per target; the upsert in issue() relies on this being unique.
verificationCodeSchema.index({ channel: 1, target: 1 }, { unique: true });
// Mongo removes expired rows; the delay keeps a short window where check() can
// still report `expired` (and tell the user to request a new code) instead of
// `missing`. Keep in sync with EXPIRED_RETENTION_MS in utils/verificationStore.
verificationCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 10 * 60 });

module.exports =
  mongoose.models.VerificationCode || mongoose.model('VerificationCode', verificationCodeSchema);
