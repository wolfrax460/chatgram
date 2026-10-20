// User controller
const mongoose = require('mongoose');
const User = require('../models/User');
const realtime = require('../utils/realtime');
const presence = require('../utils/presence');

const PUBLIC_FIELDS = '_id displayName avatarUrl about isOnline lastSeen phone email showOnlineStatus onlineStatusExceptions';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// @desc    Get all users (for contacts)
// @route   GET /api/users
// @access  Private
const getUsers = async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user._id } })
      .select(PUBLIC_FIELDS)
      .sort({ isOnline: -1, displayName: 1 });

    res.json(presence.maskPresenceList(users, req.user._id));
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error fetching users' });
  }
};

// @desc    Search users
// @route   GET /api/users/search?query=
// @access  Private
const searchUsers = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || String(query).trim() === '') {
      return res.status(400).json({ message: 'Search query is required' });
    }

    // Escape user input: an unescaped "(" would be an invalid regex and the
    // old code returned a 500 for it.
    const searchRegex = new RegExp(escapeRegex(String(query).trim()), 'i');

    const users = await User.find({
      _id: { $ne: req.user._id },
      $or: [
        { displayName: { $regex: searchRegex } },
        { phone: { $regex: searchRegex } },
        { email: { $regex: searchRegex } },
      ],
    })
      .select(PUBLIC_FIELDS)
      .sort({ isOnline: -1, displayName: 1 })
      .limit(50);

    res.json(presence.maskPresenceList(users, req.user._id));
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ message: 'Server error searching users' });
  }
};

// @desc    Get user by ID
// @route   GET /api/users/:id
// @access  Private
const getUserById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    const user = await User.findById(req.params.id).select(PUBLIC_FIELDS);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Hide presence when this person keeps it private.
    res.json(presence.maskPresence(user, req.user._id));
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({ message: 'Server error fetching user' });
  }
};

// @desc    Read my privacy settings
// @route   GET /api/users/me/privacy
// @access  Private
const getPrivacy = async (req, res) => {
  try {
    const me = await User.findById(req.user._id)
      .select('showOnlineStatus onlineStatusExceptions')
      .populate('onlineStatusExceptions', '_id displayName avatarUrl');

    res.json({
      showOnlineStatus: me?.showOnlineStatus !== false,
      hiddenFrom: (me?.onlineStatusExceptions || []).filter(Boolean),
    });
  } catch (error) {
    console.error('Get privacy error:', error);
    res.status(500).json({ message: 'Server error reading privacy settings' });
  }
};

// @desc    Update my privacy settings
// @route   PUT /api/users/me/privacy
// @access  Private
const updatePrivacy = async (req, res) => {
  try {
    const { showOnlineStatus, hiddenFrom } = req.body;
    const update = {};

    if (showOnlineStatus !== undefined) {
      update.showOnlineStatus = showOnlineStatus === true || showOnlineStatus === 'true';
    }

    if (Array.isArray(hiddenFrom)) {
      // Only real, existing users; never yourself.
      const ids = hiddenFrom
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .filter((id) => String(id) !== req.user._id.toString());
      const existing = await User.find({ _id: { $in: ids } }).select('_id');
      update.onlineStatusExceptions = existing.map((u) => u._id);
    }

    const me = await User.findByIdAndUpdate(req.user._id, { $set: update }, { new: true })
      .select('showOnlineStatus onlineStatusExceptions')
      .populate('onlineStatusExceptions', '_id displayName avatarUrl');

    res.json({
      message: 'Privacy settings saved',
      showOnlineStatus: me.showOnlineStatus !== false,
      hiddenFrom: (me.onlineStatusExceptions || []).filter(Boolean),
    });
  } catch (error) {
    console.error('Update privacy error:', error);
    res.status(500).json({ message: 'Server error saving privacy settings' });
  }
};

// @desc    Update user profile
// @route   PUT /api/users/:id
// @access  Private (self only)
const updateUser = async (req, res) => {
  try {
    const userId = req.params.id;

    if (userId !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to update this profile' });
    }

    const { displayName, about, avatarUrl } = req.body;
    const updateFields = {};

    if (displayName !== undefined) {
      if (!String(displayName).trim()) {
        return res.status(400).json({ message: 'Display name cannot be empty' });
      }
      updateFields.displayName = String(displayName).trim();
    }
    if (about !== undefined) updateFields.about = String(about);
    if (avatarUrl !== undefined) updateFields.avatarUrl = String(avatarUrl);

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updateFields },
      { new: true, runValidators: true }
    ).select(PUBLIC_FIELDS);

    if (!user) return res.status(404).json({ message: 'User not found' });

    // Let contacts update the profile in real time.
    realtime.getIo()?.emit('user:updated', user);

    res.json(user);
  } catch (error) {
    console.error('Update user error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Invalid input data' });
    }
    res.status(500).json({ message: 'Server error updating user' });
  }
};

// @desc    Upload/update the user's avatar
// @route   POST /api/users/:id/avatar
// @access  Private (self only)
//
// Previously returned 501 Not Implemented.
const updateAvatar = async (req, res) => {
  try {
    const userId = req.params.id;

    if (userId !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to update this avatar' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No image uploaded' });
    }

    // Cloudinary when configured, local disk otherwise.
    const stored = await require('../utils/storage').persistUpload(req, 'avatars');
    const url = stored.url;

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { avatarUrl: url } },
      { new: true }
    ).select(PUBLIC_FIELDS);

    if (!user) return res.status(404).json({ message: 'User not found' });

    realtime.getIo()?.emit('user:updated', user);

    res.json({ message: 'Avatar updated', user, url });
  } catch (error) {
    console.error('Update avatar error:', error);
    res.status(500).json({ message: 'Server error updating avatar' });
  }
};

module.exports = {
  getUsers,
  getPrivacy,
  updatePrivacy,
  searchUsers,
  getUserById,
  updateUser,
  updateAvatar,
};
