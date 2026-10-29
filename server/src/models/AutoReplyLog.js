/**
 * One row per auto-reply actually sent. Used to enforce:
 *  - at most one auto-reply per sender per 24 h,
 *  - at most 30 auto-replies per recipient per 24 h.
 * Rows expire after 7 days; no message text is stored here.
 */
const mongoose = require('mongoose');

const autoReplyLogSchema = new mongoose.Schema(
  {
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', default: null },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    at: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

autoReplyLogSchema.index({ recipientId: 1, senderId: 1, at: -1 });
autoReplyLogSchema.index({ at: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports =
  mongoose.models.AutoReplyLog || mongoose.model('AutoReplyLog', autoReplyLogSchema);
