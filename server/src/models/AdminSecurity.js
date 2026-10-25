/**
 * Admin panel two-step verification (TOTP) state.
 *
 * One document (singleton) holds the encrypted TOTP secret, whether 2FA is on,
 * and hashed single-use recovery codes. The secret is encrypted with the same
 * AES-256-GCM helper the user 2FA flow uses (key derived from TOTP_ENCRYPTION_KEY
 * / JWT_SECRET), so it never appears in any API response or the database in clear.
 */
const mongoose = require('mongoose');

const adminSecuritySchema = new mongoose.Schema(
  {
    singleton: { type: String, default: 'admin', unique: true, index: true },
    totpEnabled: { type: Boolean, default: false },
    // Encrypted pending (during enrolment) or active secret.
    totpSecret: { type: String, default: '', select: false },
    // SHA-256 hashes of the recovery codes (never the codes themselves).
    recoveryCodes: { type: [String], default: [] },
    // Optional IP allowlist (9a). Off by default; entries are IPs or IPv4 CIDRs.
    ipAllowlistEnabled: { type: Boolean, default: false },
    ipAllowlist: { type: [String], default: [] },
  },
  { timestamps: true },
);

module.exports = mongoose.models.AdminSecurity || mongoose.model('AdminSecurity', adminSecuritySchema);
