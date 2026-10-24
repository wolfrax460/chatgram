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

router.post('/auth/login', login);
router.get('/auth/session', requireAdminSession, sessionInfo);
router.get('/auth/sessions', requireAdminSession, listSessions);
router.get('/auth/audit', requireAdminSession, listAudit);
router.post('/auth/logout', requireAdminSession, requireAdminCsrf, logout);
router.post('/auth/logout-all', requireAdminSession, requireAdminCsrf, logoutAll);
router.post('/auth/change-password', requireAdminSession, requireAdminCsrf, changePassword);

// Dashboard (Change 2): Overview + Users. Read-only fields only; no secrets.
router.get('/overview', requireAdminSession, overview);
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
