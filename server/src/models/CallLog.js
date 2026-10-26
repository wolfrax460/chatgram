const mongoose = require('mongoose');

/**
 * One record per call room, written when the room ends (or is missed / declined /
 * busy / failed / cancelled).
 *
 * Per-user visibility is handled with `hiddenFor` (delete from history / clear
 * history) and per-user direction is derived: callerId is "outgoing", everyone
 * else is "incoming". The per-user outcome is derived in the controller from
 * answeredBy / declinedBy / busyBy / failedBy and the room-level status, so one
 * group call can read as "completed" for a participant and "missed" for a
 * member who never joined.
 *
 * Chunk 2 additions: `callId` (the in-memory room id, so a history row can be
 * matched to the live room/card), `busyBy`, `failedBy` and `endReason`.
 *
 * No media, no SDP and no ICE candidates are stored.
 */
const callLogSchema = new mongoose.Schema(
  {
    /** The client-generated room id (not a Mongo id). */
    callId: { type: String, default: null, index: true },
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
      enum: ['completed', 'missed', 'declined', 'busy', 'cancelled', 'failed'],
      default: 'missed',
      index: true,
    },
    /** Coarse reason behind `status` ('ended', 'missed', 'declined', 'busy', 'failed', 'cancelled'). */
    endReason: { type: String, default: null },
    answeredBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    declinedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    /** People who were rung while already on another call (never joined). */
    busyBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    /** People whose ICE/media connection failed during the call. */
    failedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    /** Users who removed this call from their own history. */
    hiddenFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true },
);

callLogSchema.index({ participants: 1, startedAt: -1 });

module.exports = mongoose.model('CallLog', callLogSchema);
