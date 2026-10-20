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
    enum: ['text', 'image', 'video', 'audio', 'file'],
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
  }]
}, {
  timestamps: true
});

// Indexes for faster queries
messageSchema.index({ chatId: 1, sentAt: -1 });
messageSchema.index({ senderId: 1 });
messageSchema.index({ 'deliveredTo': 1 });
messageSchema.index({ 'readBy': 1 });

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