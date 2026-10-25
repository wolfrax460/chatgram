/**
 * Data requests (9b item 15): tracked export and delete requests for a user.
 *
 * Exports are built on demand and stored on the request (never returned by list
 * endpoints); a completed export can be downloaded once as JSON. Deletion is
 * explicit: an admin confirms it, and the user's profile, messages, statuses,
 * contacts and chat memberships are removed. Deletion can also be scheduled with
 * a grace period and then cancelled before it is executed.
 */
const mongoose = require('mongoose');

const dataRequestSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['export', 'delete'], required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userLabel: { type: String, default: '' },
    reason: { type: String, default: '', maxlength: 500 },
    status: { type: String, enum: ['pending', 'scheduled', 'completed', 'cancelled', 'failed'], default: 'pending', index: true },
    scheduledFor: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    error: { type: String, default: '' },
    // Built export JSON (select:false so lists never return it).
    exportData: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
    exportBytes: { type: Number, default: 0 },
  },
  { timestamps: true },
);

dataRequestSchema.index({ status: 1, createdAt: -1 });

module.exports =
  mongoose.models.DataRequest || mongoose.model('DataRequest', dataRequestSchema);
