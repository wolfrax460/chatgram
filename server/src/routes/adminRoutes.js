// Admin panel API. Every route except login requires an admin session cookie;
// state-changing routes also require the per-session CSRF header.
const express = require('express');
const expressRateLimit = require('express-rate-limit');
const router = express.Router();
const { requireAdminSession, requireAdminCsrf } = require('../middleware/adminAuth');
const {
  login,
  sessionInfo,
  logout,
  listSessions,
  logoutAll,
  changePassword,
  listAudit,
} = require('../controllers/adminAuthController');
const {
  overview,
  listUsers,
  userDetail,
  forceLogout,
  resetTwoFactor,
  verifyEmail,
  warnUser,
  updateProfile,
  removePhoto,
  scheduleDeletion,
  cancelDeletion,
  userSessions,
  bulkUsers,
} = require('../controllers/adminOverviewController');
const { systemHealth, auditList } = require('../controllers/adminHealthController');
const accountDeletions = require('../controllers/adminAccountDeletionController');
const systemAdmin = require('../controllers/adminSystemController');
const moderation = require('../controllers/adminModerationController');
const adminSecurity = require('../controllers/adminSecurityController');
const groups = require('../controllers/adminGroupsController');
const media = require('../controllers/adminMediaController');
const releases = require('../controllers/appReleasesController');
const platform = require('../controllers/adminPlatformController');
const dataRequests = require('../controllers/adminDataRequestController');
const reviews = require('../controllers/adminReviewController');
const safetyAdmin = require('../controllers/adminSafetyController');
const siteSettings = require('../controllers/adminSettingsController');
const broadcasts = require('../controllers/adminBroadcastsController');

router.post('/auth/login', login);
router.get('/auth/session', requireAdminSession, sessionInfo);
router.get('/auth/sessions', requireAdminSession, listSessions);
router.get('/auth/audit', requireAdminSession, listAudit);
router.post('/auth/logout', requireAdminSession, requireAdminCsrf, logout);
router.post('/auth/logout-all', requireAdminSession, requireAdminCsrf, logoutAll);

// Admin security (9a): optional TOTP two-step + recovery codes.
router.get('/security', requireAdminSession, adminSecurity.state);
router.post('/security/totp/start', requireAdminSession, requireAdminCsrf, adminSecurity.start);
router.post('/security/totp/enable', requireAdminSession, requireAdminCsrf, adminSecurity.enable);
router.post('/security/totp/disable', requireAdminSession, requireAdminCsrf, adminSecurity.disable);
router.post('/security/recovery-codes', requireAdminSession, requireAdminCsrf, adminSecurity.regenerateCodes);
router.put('/security/ip-allowlist', requireAdminSession, requireAdminCsrf, adminSecurity.setIpAllowlist);
router.post('/auth/change-password', requireAdminSession, requireAdminCsrf, changePassword);

// Dashboard (Change 2): Overview + Users. Read-only fields only; no secrets.
router.get('/overview', requireAdminSession, overview);
// Moderation (9b): account states + the report queue. Every change is audited.
router.post('/users/:id/suspend', requireAdminSession, requireAdminCsrf, moderation.suspend);
router.post('/users/:id/ban', requireAdminSession, requireAdminCsrf, moderation.ban);
router.post('/users/:id/unban', requireAdminSession, requireAdminCsrf, moderation.unban);
// Statuses & media (9b item 5).
// Data requests (9b item 15): tracked export / delete of one user's data.
router.get('/data-requests', requireAdminSession, dataRequests.listRequests);
router.post('/data-requests', requireAdminSession, requireAdminCsrf, dataRequests.createRequest);
router.post('/data-requests/:id/process', requireAdminSession, requireAdminCsrf, dataRequests.processRequest);
router.post('/data-requests/:id/cancel', requireAdminSession, requireAdminCsrf, dataRequests.cancelRequest);
router.get('/data-requests/:id/download', requireAdminSession, dataRequests.downloadExport);

router.get('/platform-settings', requireAdminSession, platform.getSettings);
router.put('/platform-settings', requireAdminSession, requireAdminCsrf, platform.saveSettings);

router.get('/releases', requireAdminSession, releases.listReleases);
// Chunk 7A: counts by platform/version + last check time (audited read).
router.get('/releases/versions', requireAdminSession, releases.versionsInUse);
router.put('/releases', requireAdminSession, requireAdminCsrf, releases.saveReleases);

router.get('/statuses', requireAdminSession, media.listStatuses);
router.delete('/statuses/:id', requireAdminSession, requireAdminCsrf, media.deleteStatusAdmin);
router.get('/media', requireAdminSession, media.listMedia);
router.get('/media/storage', requireAdminSession, media.storageStats);
router.post('/media/remove', requireAdminSession, requireAdminCsrf, media.removeMedia);

router.get('/groups', requireAdminSession, groups.listGroups);
router.get('/groups/:id', requireAdminSession, groups.groupDetail);
router.post('/groups/:id/freeze', requireAdminSession, requireAdminCsrf, groups.freezeGroup);
router.post('/groups/:id/owner', requireAdminSession, requireAdminCsrf, groups.changeOwner);
router.post('/groups/:id/members/:userId/remove', requireAdminSession, requireAdminCsrf, groups.removeMember);
router.delete('/groups/:id', requireAdminSession, requireAdminCsrf, groups.deleteGroup);

router.get('/reports', requireAdminSession, moderation.listReports);
router.get('/reports/:id', requireAdminSession, moderation.reportDetail);
router.post('/reports/:id/resolve', requireAdminSession, requireAdminCsrf, moderation.resolveReport);
router.get('/health', requireAdminSession, systemHealth);
router.get('/audit', requireAdminSession, auditList);

// System health extras: MongoDB storage usage and allowlisted host diagnostics.
// Storage is read-only; diagnostics run a fixed command from the server-side
// allowlist (never a user-supplied command line) and every run is audited.
const diagnosticLimiter = expressRateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' || process.env.AUTH_RATE_LIMIT_DISABLED === 'true',
  message: { message: 'Too many diagnostics — wait a minute and try again.' },
});
router.get('/system/storage', requireAdminSession, systemAdmin.storage);
router.get('/system/diagnostics', requireAdminSession, systemAdmin.diagnostics);
router.post('/system/diagnostics/run', requireAdminSession, requireAdminCsrf, diagnosticLimiter, systemAdmin.runDiagnostic);
router.get('/users', requireAdminSession, listUsers);
// Protected account deletion lifecycle (14-day grace): no content, ids and dates.
router.get('/account-deletions', requireAdminSession, accountDeletions.listAccountDeletions);
router.get('/users/:id', requireAdminSession, userDetail);
router.post('/users/bulk', requireAdminSession, requireAdminCsrf, bulkUsers);
router.post('/users/:id/force-logout', requireAdminSession, requireAdminCsrf, forceLogout);
router.post('/users/:id/reset-2fa', requireAdminSession, requireAdminCsrf, resetTwoFactor);
router.get('/users/:id/sessions', requireAdminSession, userSessions);
router.post('/users/:id/verify-email', requireAdminSession, requireAdminCsrf, verifyEmail);
router.post('/users/:id/warn', requireAdminSession, requireAdminCsrf, warnUser);
router.patch('/users/:id/profile', requireAdminSession, requireAdminCsrf, updateProfile);
router.post('/users/:id/remove-photo', requireAdminSession, requireAdminCsrf, removePhoto);
router.post('/users/:id/delete', requireAdminSession, requireAdminCsrf, scheduleDeletion);
router.post('/users/:id/cancel-delete', requireAdminSession, requireAdminCsrf, cancelDeletion);

// Empty-screen recommendations editor (item 4, Announcements page).
const recommendations = require('../ai/recommendations');
router.get('/recommendations', requireAdminSession, async (req, res) => {
  try {
    return res.json({ recommendations: await recommendations.listAll() });
  } catch (error) {
    return res.status(500).json({ message: 'Could not load recommendations.' });
  }
});
router.put('/recommendations', requireAdminSession, requireAdminCsrf, async (req, res) => {
  try {
    const rows = await recommendations.updateAll(req.body?.recommendations);
    const admin = require('../admin/auth');
    await admin.audit('recommendations_update', req, `${rows.length} entries`);
    return res.json({ recommendations: rows });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'Could not save recommendations.' });
  }
});

// 9d oversight: time-boxed, reasoned, audited read-only conversation review.
router.get('/reviews', requireAdminSession, reviews.list);
router.get('/reviews/stats', requireAdminSession, reviews.stats);
router.post('/reviews', requireAdminSession, requireAdminCsrf, reviews.start);
router.get('/reviews/:id', requireAdminSession, reviews.current);
router.post('/reviews/:id/end', requireAdminSession, requireAdminCsrf, reviews.end);
router.get('/reviews/:id/conversations', requireAdminSession, reviews.conversations);
router.get('/reviews/:id/messages', requireAdminSession, reviews.messages);
router.get('/reviews/:id/search', requireAdminSession, reviews.search);

// 9b Safety & abuse: blocked words/links/domains, IP bans, limits, spam signals.
router.get('/safety', requireAdminSession, safetyAdmin.state);
router.put('/safety', requireAdminSession, requireAdminCsrf, safetyAdmin.save);
router.get('/safety/signals', requireAdminSession, safetyAdmin.signals);
router.post('/safety/ip-bans', requireAdminSession, requireAdminCsrf, safetyAdmin.addIpBan);
router.delete('/safety/ip-bans/:ip', requireAdminSession, requireAdminCsrf, safetyAdmin.removeIpBan);

// 9b Settings: site/retention/legal settings, SMTP/Telegram status and backups.
router.get('/settings', requireAdminSession, siteSettings.state);
router.put('/settings', requireAdminSession, requireAdminCsrf, siteSettings.save);
router.post('/settings/backup', requireAdminSession, requireAdminCsrf, siteSettings.backupNow);
// 1A: "Send test message" button for AI-report Telegram alerts.
router.post('/settings/telegram-test', requireAdminSession, requireAdminCsrf, siteSettings.telegramTest);

// 9b Announcements: in-app banner + official-account broadcasts.
router.get('/broadcasts', requireAdminSession, broadcasts.list);
router.post('/broadcasts', requireAdminSession, requireAdminCsrf, broadcasts.create);
router.get('/broadcasts/:id/preview', requireAdminSession, broadcasts.preview);
router.post('/broadcasts/:id/send', requireAdminSession, requireAdminCsrf, broadcasts.send);
router.post('/broadcasts/:id/cancel', requireAdminSession, requireAdminCsrf, broadcasts.cancel);
router.delete('/broadcasts/:id', requireAdminSession, requireAdminCsrf, broadcasts.remove);
// Operational: deliver any scheduled broadcasts that are due right now (the
// scheduler also runs this every minute in the API process).
router.post('/broadcasts/run-due', requireAdminSession, requireAdminCsrf, async (req, res) => {
  try {
    const delivered = await broadcasts.runDue();
    return res.json({ delivered });
  } catch (error) {
    return res.status(500).json({ message: 'Could not run the scheduled announcements.' });
  }
});

module.exports = router;
