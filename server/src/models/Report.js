// User / message reports (abuse). Kept forever-ish (365 days) for moderation.
const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  reporterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  targetUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  targetMessageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null
  },
  chatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    default: null
  },
  reason: {
    type: String,
    enum: ['spam', 'abuse', 'harassment', 'impersonation', 'scam', 'other'],
    default: 'other'
  },
  details: {
    type: String,
    default: '',
    maxlength: 2000
  },
  // A snapshot of the message text (if any) so the report stays meaningful even
  // after the message is deleted for everyone.
  messageSnapshot: {
    type: String,
    default: '',
    maxlength: 4000
  },
  status: {
    type: String,
    enum: ['open', 'reviewed', 'actioned'],
    default: 'open',
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    // Retention: reports are deleted after one year.
    expires: 365 * 24 * 60 * 60
  }
}, {
  timestamps: false
});

reportSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema);
