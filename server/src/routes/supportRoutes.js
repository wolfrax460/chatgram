// Help & feedback routes
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { openSupportChat, supportInfo } = require('../controllers/supportController');
const { createTicket, getTicket, deleteTicket, getTicketByChat, closeTicket } = require('../controllers/supportTicketController');
const { askSupportAssistant } = require('../controllers/supportAssistantController');
const { webhookHandler: telegramWebhook } = require('../support/telegramBot');
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
} = require('../controllers/supportAdminController');

/** Only the built-in support account may use the dashboard. */
const requireSupportAccount = (req, res, next) => {
  if (!req.user?.isSupportAccount) {
    return res.status(403).json({ message: 'Support account required.' });
  }
  return next();
};

// --- public help-widget endpoints (no auth) ---
router.post('/assistant', askSupportAssistant);
// Telegram bot webhook (secret in the path).
router.post('/telegram/:secret', telegramWebhook);
router.post('/tickets', createTicket);
router.get('/tickets/:ticketId', getTicket);
router.delete('/tickets/:ticketId', deleteTicket);

router.use(protect);

// Is support configured?
// Support-account ticket badge + close (auth required, declared after protect)
router.get('/tickets/by-chat/:chatId', getTicketByChat);
router.post('/tickets/:ticketId/close', closeTicket);

// Admin dashboard (support account only)
router.get('/admin/settings', requireSupportAccount, getAdminSettings);
router.put('/admin/settings', requireSupportAccount, updateAdminSettings);
router.get('/admin/stats', requireSupportAccount, getAdminStats);
router.post('/admin/test-ai', requireSupportAccount, testAi);
router.get('/admin/kb', requireSupportAccount, getKb);
router.put('/admin/kb', requireSupportAccount, updateKb);
router.post('/admin/kb/reset', requireSupportAccount, resetKb);
router.get('/admin/tickets', requireSupportAccount, listTickets);
router.get('/admin/tickets/:ticketId', requireSupportAccount, getTicketDetail);
router.post('/admin/tickets/:ticketId/reply', requireSupportAccount, replyToTicketAdmin);

router.get('/', supportInfo);

// Open (or create) my conversation with the support account.
router.post('/chat', openSupportChat);

module.exports = router;
