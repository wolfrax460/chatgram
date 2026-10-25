const mongoose = require('mongoose');

/**
 * One record per call, written when the call ends (or is missed/declined).
 *
 * Per-user visibility is handled with `hiddenFor` (delete from history / clear
 * history) and per-user direction is derived: callerId is "outgoing", everyone
 * else is "incoming". No media, no SDP, no ICE candidates are stored.
 */
const callLogSchema = new mongoose.Schema(
  {
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', index: true },
    callerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
    type: { type: String, enum: ['voice', 'video'], default: 'voice' },
    isGroup: { type: Boolean, default: false },
    title: { type: String, default: '' },
    startedAt: { type: Date, default: Date.now, index: true },
    answeredAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    durationSeconds: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['completed', 'missed', 'declined', 'cancelled', 'failed'],
      default: 'missed',
      index: true,
    },
    answeredBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    declinedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    /** Users who removed this call from their own history. */
    hiddenFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true },
);

callLogSchema.index({ participants: 1, startedAt: -1 });

module.exports = mongoose.model('CallLog', callLogSchema);
