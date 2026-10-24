/** Append-only audit trail for the admin panel. */
const mongoose = require('mongoose');

const adminAuditSchema = new mongoose.Schema(
  {
    action: { type: String, required: true, index: true },
    detail: { type: String, default: '' },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    sessionId: { type: String, default: '' },
    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);

module.exports = mongoose.models.AdminAudit || mongoose.model('AdminAudit', adminAuditSchema);
