/** Login history entry (9b Users extras). Destination-free: ip + user agent + time. */
const mongoose = require('mongoose');

const loginEventSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '', maxlength: 300 },
    method: { type: String, default: 'password' },
    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);

loginEventSchema.index({ userId: 1, at: -1 });

module.exports = mongoose.models.LoginEvent || mongoose.model('LoginEvent', loginEventSchema);
