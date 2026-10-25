/**
 * Platform settings singleton (9b item 10): feature flags, maintenance/read-only
 * mode and upload limits. Cached in utils/platformSettings.
 */
const mongoose = require('mongoose');

const platformSettingsSchema = new mongoose.Schema(
  {
    singleton: { type: String, default: 'platform', unique: true, index: true },
    registrationEnabled: { type: Boolean, default: true },
    statusEnabled: { type: Boolean, default: true },
    groupsEnabled: { type: Boolean, default: true },
    fileUploadsEnabled: { type: Boolean, default: true },
    aiEnabled: { type: Boolean, default: true },
    supportWidgetEnabled: { type: Boolean, default: true },
    maintenanceMode: { type: Boolean, default: false },
    maintenanceMessage: { type: String, default: 'Chatgram is under maintenance. We will be back shortly.', maxlength: 500 },
    readOnlyMode: { type: Boolean, default: false },
    maxUploadMb: { type: Number, default: 100 },
    // 9b Safety & abuse.
    blockedWords: { type: [String], default: [] },
    blockedLinkDomains: { type: [String], default: [] },
    blockedEmailDomains: { type: [String], default: [] },
    messagesPerMinute: { type: Number, default: 60 },
    signupsPerHourPerIp: { type: Number, default: 20 },
    massMessageHourly: { type: Number, default: 200 },
    signupThrottleEnabled: { type: Boolean, default: true },
    // 9b Settings page.
    siteName: { type: String, default: 'Chatgram' },
    siteUrl: { type: String, default: 'https://chatgram-xi.vercel.app' },
    supportEmail: { type: String, default: '' },
    smtpFromName: { type: String, default: 'Chatgram' },
    smtpFromAddress: { type: String, default: '' },
    privacyUrl: { type: String, default: '/docs/#privacy' },
    termsUrl: { type: String, default: '/docs/#terms' },
    dataRetentionDays: { type: Number, default: 365 },
    reviewLogRetentionDays: { type: Number, default: 730 },
    lastBackupAt: { type: Date, default: null },
    lastBackupSizeBytes: { type: Number, default: 0 },
    lastBackupPath: { type: String, default: '' },
    // [{ ip, reason, createdAt }] managed by the Safety controller.
    ipBans: { type: [{ ip: String, reason: String, createdAt: Date }], default: [] },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.PlatformSettings || mongoose.model('PlatformSettings', platformSettingsSchema);
