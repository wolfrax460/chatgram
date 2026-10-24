// Chat routes
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { clearChatMessages } = require('../controllers/messageController');
const upload = require('../utils/upload');
const {
  createChat,
  getChats,
  getChatById,
  getGroups,
  updateGroup,
  updateGroupAvatar,
  setGroupAdmin,
  addParticipants,
  removeParticipant,
  getGroupMembers,
  leaveGroup,
  getInvite,
  createInvite,
  revokeInvite,
  previewInvite,
  joinViaInvite,
  pinMessage,
  unpinMessage,
  getChatMedia,
} = require('../controllers/chatController');

// All routes require authentication
router.use(protect);

// Create a new chat (direct or group)
router.post('/', createChat);

// Get user's chats
router.get('/', getChats);

// Groups only — must be declared before `/:id` so "groups" is not read as an id.
router.get('/groups', getGroups);

// Invite links — `/invite/...` must also be declared before `/:id`.
router.get('/invite/:token', previewInvite);
router.post('/invite/:token/join', joinViaInvite);

// Get chat by ID
router.get('/:id', getChatById);

// Group members + leave
router.get('/:id/participants', getGroupMembers);
router.delete('/:id/leave', leaveGroup);

// Invite link management (admins)
router.get('/:id/invite', getInvite);
router.post('/:id/invite', createInvite);
router.delete('/:id/invite', revokeInvite);

// Pinned message + shared media
router.post('/:id/pin', pinMessage);
router.delete('/:id/pin', unpinMessage);
router.get('/:id/media', getChatMedia);

// Edit a group (name, photo, description, settings)
router.patch('/:id', updateGroup);
router.post('/:id/avatar', upload.single('avatar'), updateGroupAvatar);

// Group membership / roles
router.post('/:id/participants', addParticipants);
router.delete('/:id/participants/:userId', removeParticipant);
router.post('/:id/admins', setGroupAdmin);

// Clear this chat's messages for me only (additive)
router.delete('/:id/messages', clearChatMessages);

module.exports = router;
