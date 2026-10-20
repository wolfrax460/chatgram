// User routes
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getUsers,
  searchUsers,
  getUserById,
  updateUser,
  updateAvatar,
  getPrivacy,
  updatePrivacy,
} = require('../controllers/userController');
const upload = require('../utils/upload');

// All routes require authentication
router.use(protect);

// Get all users (for contacts list)
router.get('/', getUsers);

// Search users (must be declared before `/:id`)
router.get('/search', searchUsers);

// Presence privacy — also before `/:id` so "me" is not read as a user id.
router.get('/me/privacy', getPrivacy);
router.put('/me/privacy', updatePrivacy);

// Get specific user by ID
router.get('/:id', getUserById);

// Update user profile
router.put('/:id', updateUser);

// Upload/replace the user's avatar
router.post('/:id/avatar', upload.single('avatar'), updateAvatar);

module.exports = router;
