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
  }]
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

// Indexes for delivery/read receipts
messageSchema.index({ chatId: 1, 'deliveredTo': 1 });
messageSchema.index({ chatId: 1, 'readBy': 1 });

// Hide internal fields when converting to JSON
messageSchema.methods.toJSON = function() {
  const message = this.toObject();
  // Remove internal Mongoose properties if needed
  return message;
};

module.exports = mongoose.model('Message', messageSchema);