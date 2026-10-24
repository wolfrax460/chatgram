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

router.post('/auth/login', login);
router.get('/auth/session', requireAdminSession, sessionInfo);
router.get('/auth/sessions', requireAdminSession, listSessions);
router.get('/auth/audit', requireAdminSession, listAudit);
router.post('/auth/logout', requireAdminSession, requireAdminCsrf, logout);
router.post('/auth/logout-all', requireAdminSession, requireAdminCsrf, logoutAll);
router.post('/auth/change-password', requireAdminSession, requireAdminCsrf, changePassword);

// Dashboard (Change 2): Overview + Users. Read-only fields only; no secrets.
router.get('/overview', requireAdminSession, overview);
router.get('/users', requireAdminSession, listUsers);
router.get('/users/:id', requireAdminSession, userDetail);
router.post('/users/:id/force-logout', requireAdminSession, requireAdminCsrf, forceLogout);
router.post('/users/:id/reset-2fa', requireAdminSession, requireAdminCsrf, resetTwoFactor);

module.exports = router;
