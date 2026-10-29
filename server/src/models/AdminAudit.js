/** Append-only audit trail for the admin panel. */
const mongoose = require('mongoose');

const adminAuditSchema = new mongoose.Schema(
  {
    action: { type: String, required: true, index: true },
    detail: { type: String, default: '' },
    // Optional subject of a non-admin lifecycle event (e.g. account deletion):
    // an id only, never the email/phone/reason/code.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    sessionId: { type: String, default: '' },
    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);

module.exports = mongoose.models.AdminAudit || mongoose.model('AdminAudit', adminAuditSchema);
