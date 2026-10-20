// Help & feedback routes
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { openSupportChat, supportInfo } = require('../controllers/supportController');
const { createTicket, getTicket } = require('../controllers/supportTicketController');
const { askSupportAssistant } = require('../controllers/supportAssistantController');

// --- public help-widget endpoints (no auth) ---
router.post('/assistant', askSupportAssistant);
router.post('/tickets', createTicket);
router.get('/tickets/:ticketId', getTicket);

router.use(protect);

// Is support configured?
router.get('/', supportInfo);

// Open (or create) my conversation with the support account.
router.post('/chat', openSupportChat);

module.exports = router;
