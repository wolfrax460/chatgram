/**
 * Deferred media cleanup for deleted accounts.
 *
 * The account purge removes the user, sessions, statuses and tokens, but media
 * may live behind a provider (Cloudinary) whose deletion helper is only wired
 * for the normal status/avatar paths. Rather than inventing external deletion
 * calls, the purger records every URL it could not prove it removed here. Ops
 * can drain this queue with the provider's own tooling (or a future helper).
 *
 * Rows contain no content and no user identity beyond the id: kind, URL,
 * provider/public id and where the reference came from.
 */
const mongoose = require('mongoose');

const pendingMediaDeletionSchema = new mongoose.Schema(
  {
    // What the URL belonged to: avatar | status | status-thumbnail | message.
    kind: { type: String, enum: ['avatar', 'status', 'status-thumbnail', 'message'], required: true },
    url: { type: String, required: true },
    publicId: { type: String, default: null },
    provider: { type: String, default: null },
    // The account that owned it (kept after the user document is gone for the
    // operator's records; it is an id, never an email/phone/display name).
    userId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    source: { type: String, default: 'account-deletion' },
    createdAt: { type: Date, default: Date.now, index: true },
    // Set by whatever drains the queue; null means "still needs provider cleanup".
    processedAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: false },
);

pendingMediaDeletionSchema.index({ processedAt: 1, createdAt: 1 });

module.exports =
  mongoose.models.PendingMediaDeletion ||
  mongoose.model('PendingMediaDeletion', pendingMediaDeletionSchema);
