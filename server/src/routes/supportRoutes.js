// Help & feedback routes
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { openSupportChat, supportInfo } = require('../controllers/supportController');
const { createTicket, getTicket, deleteTicket, getTicketByChat, closeTicket } = require('../controllers/supportTicketController');
const { askSupportAssistant } = require('../controllers/supportAssistantController');
const { webhookHandler: telegramWebhook } = require('../support/telegramBot');
// --- public help-widget endpoints (no auth) ---
router.post('/assistant', askSupportAssistant);
// Telegram bot webhook (secret in the path).
router.post('/telegram/:secret', telegramWebhook);
router.post('/tickets', createTicket);
router.get('/tickets/:ticketId', getTicket);
router.delete('/tickets/:ticketId', deleteTicket);

// The old support-account dashboard is retired: support operations now live under
// the admin session at /api/admin/support/*, so these paths must 404.
router.use('/admin', (req, res) => res.status(404).json({ message: 'Not found.' }));

router.use(protect);

// Is support configured?
// Support-account ticket badge + close (auth required, declared after protect)
router.get('/tickets/by-chat/:chatId', getTicketByChat);
router.post('/tickets/:ticketId/close', closeTicket);

router.get('/', supportInfo);

// Open (or create) my conversation with the support account.
router.post('/chat', openSupportChat);

module.exports = router;
