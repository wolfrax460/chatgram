// User routes
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getMe,
  getAiSettings,
  updateAiSettings,
  getAutoReply,
  updateAutoReply,
  getDisappearingDefault,
  updateDisappearingDefault,
  getUsers,
  searchUsers,
  getUserById,
  getProfile,
  blockUser,
  unblockUser,
  getBlockedUsers,
  muteChat,
  unmuteChat,
  getMutedChats,
  reportUser,
  updateUser,
  updateAvatar,
  getPrivacy,
  updatePrivacy,
  getNotificationPrefs,
  updateNotificationPrefs,
} = require('../controllers/userController');
const upload = require('../utils/upload');

// All routes require authentication
router.use(protect);

// Get all users (for contacts list)
router.get('/', getUsers);

// Current user's own record, including pendingDeletion during the grace period.
// Must be declared before `/:id`.
router.get('/me', getMe);

// Search users (must be declared before `/:id`)
router.get('/search', searchUsers);

// Privacy settings — also before `/:id` so "me" is not read as a user id.
router.get('/me/privacy', getPrivacy);
router.put('/me/privacy', updatePrivacy);

// Do-not-disturb schedule for desktop notifications and sounds.
router.get('/me/notifications', getNotificationPrefs);
router.put('/me/notifications', updateNotificationPrefs);

// Opt-in smart replies (AI preferences). Default: off.
router.get('/me/ai-settings', getAiSettings);
router.put('/me/ai-settings', updateAiSettings);

// Away / auto-reply settings.
router.get('/me/auto-reply', getAutoReply);
router.put('/me/auto-reply', updateAutoReply);

// Global disappearing-messages default for NEW direct chats only.
router.get('/me/disappearing-default', getDisappearingDefault);
router.put('/me/disappearing-default', updateDisappearingDefault);

// Blocked users and muted chats (before `/:id`, they start with "me").
router.get('/me/blocked', getBlockedUsers);
router.get('/me/muted', getMutedChats);
router.post('/me/muted/:chatId', muteChat);
router.delete('/me/muted/:chatId', unmuteChat);

// Privacy-aware profile for the profile panel
router.get('/:id/profile', getProfile);

// Block / unblock / report
router.post('/:id/block', blockUser);
router.delete('/:id/block', unblockUser);
router.post('/:id/report', reportUser);

// Get specific user by ID
router.get('/:id', getUserById);

// Update user profile
router.put('/:id', updateUser);

// Upload/replace the user's avatar
router.post('/:id/avatar', upload.single('avatar'), updateAvatar);

module.exports = router;
