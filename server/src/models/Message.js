// Message model
const mongoose = require('mongoose');

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
    // 'system' rows are created by the server for group events ("X left").
    enum: ['text', 'image', 'video', 'audio', 'file', 'system'],
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