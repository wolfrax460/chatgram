// Message routes
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  sendMessage,
  getMessages,
  markAsDelivered,
  markAsRead,
  markChatAsRead,
  uploadMedia,
  deleteMessage,
  reactToMessage,
} = require('../controllers/messageController');
const upload = require('../utils/upload');

// All routes require authentication
router.use(protect);

// Upload media file (declared before the `/:id/...` routes for clarity)
router.post('/media', upload.single('file'), uploadMedia);

// Send a message over REST (also broadcast over Socket.IO)
router.post('/', sendMessage);

// Get messages for a chat -> { messages, hasMore, nextCursor }
router.get('/', getMessages);

// Mark every unread message in a chat as read
router.post('/chat/:chatId/read', markChatAsRead);

// Reactions (additive)
router.post('/:id/reactions', reactToMessage);

// Delete: ?scope=me (default) or ?scope=everyone (sender only)
router.delete('/:id', deleteMessage);

// Mark a single message as delivered / read
router.post('/:id/delivered', markAsDelivered);
router.post('/:id/read', markAsRead);

module.exports = router;
