// Admin panel API. Every route except login requires an admin session cookie;
// state-changing routes also require the per-session CSRF header.
const express = require('express');
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
} = require('../controllers/adminOverviewController');
const { systemHealth, auditList } = require('../controllers/adminHealthController');
const moderation = require('../controllers/adminModerationController');
const adminSecurity = require('../controllers/adminSecurityController');
const groups = require('../controllers/adminGroupsController');
const media = require('../controllers/adminMediaController');

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
router.get('/users', requireAdminSession, listUsers);
router.get('/users/:id', requireAdminSession, userDetail);
router.post('/users/:id/force-logout', requireAdminSession, requireAdminCsrf, forceLogout);
router.post('/users/:id/reset-2fa', requireAdminSession, requireAdminCsrf, resetTwoFactor);

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

module.exports = router;
