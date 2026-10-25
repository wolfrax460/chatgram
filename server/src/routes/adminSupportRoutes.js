/**
 * Support operations under the admin session (9a/9b).
 *
 * These endpoints used to live under /api/support/admin/* and /api/help/admin/*
 * behind the old "support account" role guard. That guard is removed: the only
 * way in is the admin session cookie (plus CSRF for writes), so a normal user
 * token — even the Support account's — can never reach them.
 */
const express = require('express');
const router = express.Router();
const { requireAdminSession, requireAdminCsrf } = require('../middleware/adminAuth');
const {
  getAdminSettings,
  updateAdminSettings,
  getAdminStats,
  testAi,
  getKb,
  updateKb,
  resetKb,
  listTickets,
  getTicketDetail,
  replyToTicketAdmin,
  getAiLayerSettings,
  updateAiLayerSettings,
  testAiLayer,
} = require('../controllers/supportAdminController');
const help = require('../help/controller');

router.use(requireAdminSession);

// Support account settings, stats, Telegram status and AI connection test.
router.get('/settings', getAdminSettings);
router.put('/settings', requireAdminCsrf, updateAdminSettings);
router.get('/stats', getAdminStats);
router.post('/test-ai', requireAdminCsrf, testAi);

// Provider-agnostic AI layer for support.
router.get('/ai', getAiLayerSettings);
router.put('/ai', requireAdminCsrf, updateAiLayerSettings);
router.post('/ai/test', requireAdminCsrf, testAiLayer);

// Support knowledge base.
router.get('/kb', getKb);
router.put('/kb', requireAdminCsrf, updateKb);
router.post('/kb/reset', requireAdminCsrf, resetKb);

// Tickets.
router.get('/tickets', listTickets);
router.get('/tickets/:ticketId', getTicketDetail);
router.post('/tickets/:ticketId/reply', requireAdminCsrf, replyToTicketAdmin);

// Help-centre editor.
router.get('/help/collections', help.adminListCollections);
router.put('/help/collections', requireAdminCsrf, help.adminUpsertCollection);
router.delete('/help/collections/:slug', requireAdminCsrf, help.adminDeleteCollection);
router.get('/help/articles', help.adminListArticles);
router.put('/help/articles', requireAdminCsrf, help.adminUpsertArticle);
router.delete('/help/articles/:slug', requireAdminCsrf, help.adminDeleteArticle);

module.exports = router;
