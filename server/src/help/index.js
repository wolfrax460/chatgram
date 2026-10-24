// Help-centre routes: public articles + widget conversations, plus admin CRUD.
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const upload = require('../utils/upload');
const controller = require('./controller');

const JWT_SECRET = () => process.env.JWT_SECRET || 'your-secret-key';

/** Attach req.user when a valid bearer token is present; never reject. */
async function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next();
  try {
    const decoded = jwt.verify(header.split(' ')[1], JWT_SECRET());
    const user = await User.findById(decoded.userId);
    if (user && (Number(decoded.tv) || 0) === (Number(user.tokenVersion) || 0)) req.user = user;
  } catch {
    /* anonymous request */
  }
  return next();
}

// --- public help centre -----------------------------------------------------
router.get('/collections', controller.getCollections);
router.get('/collections/:slug', controller.getCollection);
router.get('/articles/:slug', controller.getArticle);
router.get('/search', controller.searchArticles);

// --- widget conversations (user or guest) -----------------------------------
router.use(optionalAuth);
router.post('/uploads', upload.single('file'), controller.uploadAttachment);
router.post('/conversations', controller.createConversation);
router.get('/conversations', controller.listConversations);
router.get('/conversations/:id', controller.getConversation);
router.post('/conversations/:id/messages', controller.postMessage);
router.post('/conversations/:id/read', controller.markRead);
router.post('/conversations/:id/resolve', controller.resolveConversation);
router.delete('/conversations/:id', controller.deleteConversation);
router.post('/conversations/:id/handoff', controller.handoff);
router.post('/conversations/:id/transcript', controller.emailTranscript);
router.post('/messages/:id/feedback', controller.messageFeedback);

// --- admin editor (support account only) ------------------------------------
router.get('/admin/collections', protect, controller.requireSupportAccount, controller.adminListCollections);
router.put('/admin/collections', protect, controller.requireSupportAccount, controller.adminUpsertCollection);
router.delete('/admin/collections/:slug', protect, controller.requireSupportAccount, controller.adminDeleteCollection);
router.get('/admin/articles', protect, controller.requireSupportAccount, controller.adminListArticles);
router.put('/admin/articles', protect, controller.requireSupportAccount, controller.adminUpsertArticle);
router.delete('/admin/articles/:slug', protect, controller.requireSupportAccount, controller.adminDeleteArticle);

module.exports = router;
