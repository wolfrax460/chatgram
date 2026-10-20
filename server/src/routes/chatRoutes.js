// Chat routes
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { clearChatMessages } = require('../controllers/messageController');
const {
  createChat,
  getChats,
  getChatById,
  getGroups,
  updateGroup,
  setGroupAdmin,
  addParticipants,
  removeParticipant,
} = require('../controllers/chatController');

// All routes require authentication
router.use(protect);

// Create a new chat (direct or group)
router.post('/', createChat);

// Get user's chats
router.get('/', getChats);

// Groups only — must be declared before `/:id` so "groups" is not read as an id.
router.get('/groups', getGroups);

// Get chat by ID
router.get('/:id', getChatById);

// Edit a group (admin)
router.patch('/:id', updateGroup);

// Group membership / roles
router.post('/:id/participants', addParticipants);
router.delete('/:id/participants/:userId', removeParticipant);
router.post('/:id/admins', setGroupAdmin);

// Clear this chat's messages for me only (additive)
router.delete('/:id/messages', clearChatMessages);

module.exports = router;
