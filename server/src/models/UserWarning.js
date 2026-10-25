/** A moderation warning issued by an admin (9b Users extras). */
const mongoose = require('mongoose');

const userWarningSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    issuedBy: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);

module.exports = mongoose.models.UserWarning || mongoose.model('UserWarning', userWarningSchema);
