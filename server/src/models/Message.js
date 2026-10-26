// Message model
const mongoose = require('mongoose');

/**
 * Chunk 2: a persisted call card. One Message of type 'call' per call room,
 * updated live (content + metadata) while the room rings / is active / ends.
 * No media, SDP or ICE is stored — only who, when, for how long and the outcome.
 */
const callParticipantSchema = new mongoose.Schema(
  {
    id: { type: String },
    displayName: { type: String },
    avatarUrl: { type: String, default: null },
    audioOnly: { type: Boolean, default: false },
    muted: { type: Boolean, default: false },
    cameraOn: { type: Boolean, default: false },
    screenSharing: { type: Boolean, default: false },
    sharingKind: { type: String, default: null },
    trackKind: { type: String, default: null },
    hasSystemAudio: { type: Boolean, default: false },
  },
  { _id: false },
);

const callCardSchema = new mongoose.Schema(
  {
    callId: { type: String },
    chatId: { type: String },
    video: { type: Boolean, default: false },
    mode: { type: String, enum: ['voice', 'video'], default: 'voice' },
    isGroup: { type: Boolean, default: false },
    title: { type: String, default: '' },
    /** ringing (nobody else joined yet) | active | ended */
    state: { type: String, default: 'ringing' },
    /** ringing (live) | completed | missed | declined | busy | failed | cancelled */
    status: { type: String, default: 'ringing' },
    startedBy: {
      id: { type: String },
      displayName: { type: String },
      avatarUrl: { type: String, default: null },
    },
    startedAt: { type: Date, default: null },
    answeredAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    durationSeconds: { type: Number, default: 0 },
    participantCount: { type: Number, default: 0 },
    participants: { type: [callParticipantSchema], default: [] },
    capacity: { type: Number, default: 12 },
    videoCapacity: { type: Number, default: 0 },
    cameraCount: { type: Number, default: 0 },
    endReason: { type: String, default: null },
  },
  { _id: false },
);

const messageSchema = new mongoose.Schema({
  chatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    // 'system' rows are created by the server for group events ("X left");
    // 'call' rows are persisted, live-updating call cards (chunk 2). Older
    // clients simply render the card's text content as a normal bubble.
    enum: ['text', 'image', 'video', 'audio', 'file', 'system', 'call'],
    default: 'text'
  },
  content: {
    type: String,
    default: ''
  },
  mediaUrl: {
    type: String,
    default: null
  },
  sentAt: {
    type: Date,
    default: Date.now
  },
  deliveredTo: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  readBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],

  // ---- additive: reactions, per-user deletion, delete-for-everyone ----
  // Kept optional with defaults so existing documents and the Flutter client
  // are unaffected.
  reactions: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    emoji: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }],
  deletedFor: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  isDeleted: {
    type: Boolean,
    default: false
  },
  // Users mentioned with @displayName in a group message (for notifications).
  mentionUserIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // Set when the sender edits the text; the client shows an "edited" label.
  editedAt: {
    type: Date,
    default: null
  },
  // Per-user stars (bookmarks). No document is copied — just this list.
  starredBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],

  // ---- additive: private group AI replies (chunk 1C) ----
  // Empty/absent = visible to every member of the chat. When non-empty the
  // message may only be read by the listed users: the group AI mention privacy
  // setting stores the asker's id here (on the question and on every AI reply /
  // notice) and the REST + socket paths filter it out for everyone else.
  visibleTo: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // A private AI answer/notice points at the asker's mention message so the
  // "Share with group" endpoint can reveal the question + answers as one thread.
  aiReplyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null
  },
  // Chunk 2: call card metadata (only set on type: 'call' messages).
  call: {
    type: callCardSchema,
    default: null
  }
}, {
  timestamps: true
});

// Indexes for faster queries
messageSchema.index({ chatId: 1, sentAt: -1 });
messageSchema.index({ chatId: 1, isDeleted: 1 });
messageSchema.index({ deletedFor: 1 });
messageSchema.index({ senderId: 1 });
messageSchema.index({ 'deliveredTo': 1 });
messageSchema.index({ 'readBy': 1 });
messageSchema.index({ starredBy: 1 });
messageSchema.index({ visibleTo: 1 });
messageSchema.index({ aiReplyTo: 1 });
messageSchema.index({ 'call.callId': 1 });

// Indexes for delivery/read receipts
messageSchema.index({ chatId: 1, 'deliveredTo': 1 });
messageSchema.index({ chatId: 1, 'readBy': 1 });

// Hide internal fields when converting to JSON
messageSchema.methods.toJSON = function() {
  const message = this.toObject();
  // Remove internal Mongoose properties if needed
  return message;
};

/**
 * Query fragment matching every message `userId` is allowed to read.
 * Empty/absent `visibleTo` = public to the chat; a non-empty list is an
 * allow-list (used for private group AI answers).
 */
messageSchema.statics.visibilityFilter = function visibilityFilter(userId) {
  return {
    $or: [
      { visibleTo: { $exists: false } },
      { visibleTo: { $size: 0 } },
      { visibleTo: userId },
    ],
  };
};

/** True when `userId` may read this message. Works with lean docs and JSON. */
messageSchema.statics.isVisibleTo = function isVisibleTo(message, userId) {
  const list = Array.isArray(message?.visibleTo) ? message.visibleTo : [];
  if (list.length === 0) return true;
  return list.some((id) => String(id?._id ?? id) === String(userId));
};

module.exports = mongoose.model('Message', messageSchema);