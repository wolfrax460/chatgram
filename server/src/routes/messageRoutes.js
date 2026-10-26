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
  getMessageReaders,
  editMessage,
  starMessage,
  forwardMessage,
  reportMessage,
  shareWithGroup,
} = require('../controllers/messageController');
const upload = require('../utils/upload');

// All routes require authentication
router.use(protect);

// Upload media file (declared before the `/:id/...` routes for clarity)
router.post('/media', require('../utils/platformSettings').featureGate('fileUploadsEnabled', 'UPLOADS_DISABLED', 'File uploads are temporarily disabled.'), upload.single('file'), uploadMedia);

// Send a message over REST (also broadcast over Socket.IO)
router.post('/', sendMessage);

// Get messages for a chat -> { messages, hasMore, nextCursor }
router.get('/', getMessages);

// Mark every unread message in a chat as read
router.post('/chat/:chatId/read', markChatAsRead);

// Reactions (additive)
router.post('/:id/reactions', reactToMessage);

// "Seen by": the sender asks who read one of their messages
router.get('/:id/readers', getMessageReaders);

// Delete: ?scope=me (default) or ?scope=everyone (sender only)
router.delete('/:id', deleteMessage);

// Edit my own text · star for me · forward · report a message
router.patch('/:id', editMessage);
router.post('/:id/star', starMessage);
router.delete('/:id/star', starMessage);
router.post('/:id/forward', forwardMessage);
router.post('/:id/report', reportMessage);
// Share a private group AI answer (question + reply thread) with the group.
// Bearer-token auth (not cookie sessions), so no separate CSRF token is used.
router.post('/:id/share-with-group', shareWithGroup);

// Mark a single message as delivered / read
router.post('/:id/delivered', markAsDelivered);
router.post('/:id/read', markAsRead);

module.exports = router;

// Translate multer errors into specific, user-facing messages.
const uploadErrorHandler = (err, req, res, next) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') {
    const bytes = err.limit || 0;
    return res.status(413).json({ message: `File too large (max ${Math.round(bytes / (1024 * 1024))} MB)` });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ message: 'Unexpected file field' });
  }
  if (/unsupported|mime|type/i.test(String(err.message || ''))) {
    return res.status(415).json({ message: 'Unsupported file type' });
  }
  return res.status(500).json({ message: 'Storage unavailable, try again' });
};
module.exports.uploadErrorHandler = uploadErrorHandler;