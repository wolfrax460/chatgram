// User controller
const mongoose = require('mongoose');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const Report = require('../models/Report');
const realtime = require('../utils/realtime');
const presence = require('../utils/presence');
const { blockStatus } = require('../utils/blocks');

const PUBLIC_FIELDS = '_id displayName avatarUrl about isOnline lastSeen phone email showOnlineStatus onlineStatusExceptions';

// Fields the profile endpoint needs on top of PUBLIC_FIELDS. Never selected by
// list/search endpoints — privacy switches must not leak.
const PROFILE_FIELDS =
  PUBLIC_FIELDS +
  ' showPhone showEmail showAbout showProfilePhoto whoCanAddToGroups readReceipts contacts blocked';

const PRIVACY_FIELDS =
  'showOnlineStatus onlineStatusExceptions showPhone showEmail showAbout showProfilePhoto readReceipts whoCanAddToGroups';

const bool = (value) => value === true || value === 'true';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function privacyShape(me) {
  return {
    showOnlineStatus: me?.showOnlineStatus !== false,
    hiddenFrom: (me?.onlineStatusExceptions || []).filter(Boolean),
    showPhone: me?.showPhone !== false,
    showEmail: me?.showEmail !== false,
    showAbout: me?.showAbout !== false,
    showProfilePhoto: me?.showProfilePhoto !== false,
    readReceipts: me?.readReceipts !== false,
    whoCanAddToGroups: me?.whoCanAddToGroups === 'contacts' ? 'contacts' : 'everyone',
  };
}

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
      .select(PRIVACY_FIELDS)
      .populate('onlineStatusExceptions', '_id displayName avatarUrl');

    res.json(privacyShape(me));
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
    const body = req.body || {};
    const update = {};

    if (body.showOnlineStatus !== undefined) update.showOnlineStatus = bool(body.showOnlineStatus);
    if (body.showPhone !== undefined) update.showPhone = bool(body.showPhone);
    if (body.showEmail !== undefined) update.showEmail = bool(body.showEmail);
    if (body.showAbout !== undefined) update.showAbout = bool(body.showAbout);
    if (body.showProfilePhoto !== undefined) update.showProfilePhoto = bool(body.showProfilePhoto);
    if (body.readReceipts !== undefined) update.readReceipts = bool(body.readReceipts);
    if (body.whoCanAddToGroups !== undefined) {
      update.whoCanAddToGroups = body.whoCanAddToGroups === 'contacts' ? 'contacts' : 'everyone';
    }

    if (Array.isArray(body.hiddenFrom)) {
      // Only real, existing users; never yourself.
      const ids = body.hiddenFrom
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .filter((id) => String(id) !== req.user._id.toString());
      const existing = await User.find({ _id: { $in: ids } }).select('_id');
      update.onlineStatusExceptions = existing.map((u) => u._id);
    }

    const me = await User.findByIdAndUpdate(req.user._id, { $set: update }, { new: true })
      .select(PRIVACY_FIELDS)
      .populate('onlineStatusExceptions', '_id displayName avatarUrl');

    res.json({ message: 'Privacy settings saved', ...privacyShape(me) });
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

/* ----------------------------------------------------------- profile panel */

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/gi;

// @desc    Privacy-aware profile for the profile panel
// @route   GET /api/users/:id/profile
// @access  Private
const getProfile = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    const targetId = req.params.id;
    const viewerId = req.user._id.toString();
    const isSelf = targetId === viewerId;

    const target = await User.findById(targetId).select(PROFILE_FIELDS);
    if (!target) return res.status(404).json({ message: 'User not found' });

    // Blocking is evaluated before anything is returned.
    const blocks = await blockStatus(req.user._id, targetId);

    // If the other person blocked the viewer, pretend the account is gone.
    if (!isSelf && blocks.blockedMe) {
      return res.status(404).json({ message: 'Profile not available', code: 'PROFILE_UNAVAILABLE' });
    }

    // If *I* blocked them, I can still open a minimal card (that is how the
    // block gets undone) — but no contact details, media or groups.
    if (!isSelf && blocks.iBlocked) {
      return res.json({
        profile: {
          id: target._id,
          displayName: target.displayName,
          avatarUrl: '',
          about: '',
          isOnline: false,
          lastSeen: null,
          presenceHidden: true,
          phone: null,
          email: null,
          phoneHidden: Boolean(target.phone),
          emailHidden: Boolean(target.email),
        },
        isSelf: false,
        isContact: false,
        iBlocked: true,
        blockedMe: false,
        canMessage: false,
        mutedChatId: null,
        commonGroups: [],
        sharedMedia: [],
        sharedLinks: [],
      });
    }

    const me = await User.findById(req.user._id).select('contacts');
    const isContact =
      isSelf || ((me?.contacts || []).some((id) => String(id) === targetId.toString()));

    const presenceAllowed = presence.canSeePresence(target, req.user._id);
    const phoneAllowed = isSelf || (isContact && target.showPhone !== false);
    const emailAllowed = isSelf || (isContact && target.showEmail !== false);
    const aboutAllowed = isSelf || target.showAbout !== false;
    const photoAllowed = isSelf || target.showProfilePhoto !== false;

    const profile = {
      id: target._id,
      displayName: target.displayName,
      avatarUrl: photoAllowed ? target.avatarUrl || '' : '',
      photoHidden: !photoAllowed,
      about: aboutAllowed ? target.about || '' : '',
      aboutHidden: !aboutAllowed,
      isOnline: presenceAllowed ? target.isOnline === true : false,
      lastSeen: presenceAllowed ? target.lastSeen || null : null,
      presenceHidden: !presenceAllowed,
      phone: phoneAllowed ? target.phone || null : null,
      email: emailAllowed ? target.email || null : null,
      phoneHidden: !phoneAllowed && Boolean(target.phone),
      emailHidden: !emailAllowed && Boolean(target.email),
    };

    // Shared groups.
    const commonGroupsRaw = await Chat.find({
      type: 'group',
      participants: { $all: [req.user._id, target._id] },
    })
      .select('groupName groupAvatar participants')
      .limit(50)
      .lean();
    const commonGroups = commonGroupsRaw.map((chat) => ({
      id: String(chat._id),
      name: chat.groupName || 'Group',
      avatarUrl: chat.groupAvatar || '',
      memberCount: (chat.participants || []).length,
    }));

    // Shared media / links from the direct conversation (if one exists).
    let sharedMedia = [];
    let sharedLinks = [];
    const direct = await Chat.findOne({
      type: 'direct',
      participants: { $all: [req.user._id, target._id], $size: 2 },
    })
      .select('_id')
      .lean();

    if (direct) {
      const mediaRows = await Message.find({
        chatId: direct._id,
        isDeleted: { $ne: true },
        mediaUrl: { $ne: null },
      })
        .sort({ sentAt: -1 })
        .limit(12)
        .select('_id type mediaUrl sentAt')
        .lean();
      sharedMedia = mediaRows.map((row) => ({
        messageId: String(row._id),
        type: row.type,
        url: row.mediaUrl,
        at: row.sentAt,
        chatId: String(direct._id),
      }));

      const linkRows = await Message.find({
        chatId: direct._id,
        isDeleted: { $ne: true },
        type: 'text',
        content: { $regex: 'https?://' },
      })
        .sort({ sentAt: -1 })
        .limit(12)
        .select('_id content sentAt')
        .lean();
      sharedLinks = linkRows.flatMap((row) => {
        const urls = String(row.content || '').match(URL_IN_TEXT) || [];
        return urls.map((url) => ({
          messageId: String(row._id),
          url,
          at: row.sentAt,
          chatId: String(direct._id),
        }));
      }).slice(0, 12);
    }

    const mutedEntry = (req.user.mutedChats || []).find(
      (entry) => String(entry.chatId) === String(direct?._id)
    );

    return res.json({
      profile,
      isSelf,
      isContact,
      iBlocked: blocks.iBlocked,
      blockedMe: blocks.blockedMe,
      canMessage: !blocks.either,
      mutedChatId: mutedEntry ? String(mutedEntry.chatId) : null,
      commonGroups,
      sharedMedia,
      sharedLinks,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({ message: 'Server error fetching the profile' });
  }
};

// @desc    Block a user
// @route   POST /api/users/:id/block
// @access  Private
const blockUser = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    const targetId = req.params.id;
    if (targetId === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot block yourself' });
    }
    const target = await User.findById(targetId).select('_id displayName');
    if (!target) return res.status(404).json({ message: 'User not found' });

    await User.findByIdAndUpdate(req.user._id, { $addToSet: { blocked: targetId } });

    // Keep the contact list of the blocker clean.
    await User.findByIdAndUpdate(req.user._id, { $pull: { contacts: targetId } });

    return res.json({
      message: `${target.displayName} is blocked. They can no longer message you or see your profile.`,
      blocked: true,
      blockedUserId: targetId,
    });
  } catch (error) {
    console.error('Block user error:', error);
    return res.status(500).json({ message: 'Server error blocking the user' });
  }
};

// @desc    Unblock a user
// @route   DELETE /api/users/:id/block
// @access  Private
const unblockUser = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    await User.findByIdAndUpdate(req.user._id, { $pull: { blocked: req.params.id } });
    return res.json({ message: 'User unblocked', blocked: false, blockedUserId: req.params.id });
  } catch (error) {
    console.error('Unblock user error:', error);
    return res.status(500).json({ message: 'Server error unblocking the user' });
  }
};

// @desc    List blocked users
// @route   GET /api/users/me/blocked
// @access  Private
const getBlockedUsers = async (req, res) => {
  try {
    const me = await User.findById(req.user._id)
      .select('blocked')
      .populate('blocked', '_id displayName avatarUrl about');
    return res.json((me?.blocked || []).filter(Boolean));
  } catch (error) {
    console.error('List blocked users error:', error);
    return res.status(500).json({ message: 'Server error listing blocked users' });
  }
};

/* ------------------------------------------------------------------- mute */

// @desc    Mute (or unmute) notifications for one chat
// @route   POST /api/users/me/muted/:chatId
// @access  Private
const muteChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({ message: 'Invalid chat ID' });
    }
    const chat = await Chat.findById(chatId).select('participants');
    if (!chat) return res.status(404).json({ message: 'Chat not found' });
    if (!chat.participants.some((id) => String(id) === req.user._id.toString())) {
      return res.status(403).json({ message: 'You are not a member of this chat' });
    }

    // `until` in milliseconds from now, or omitted/null for forever.
    const untilMs = req.body && req.body.untilMs != null ? Number(req.body.untilMs) : null;
    const until =
      Number.isFinite(untilMs) && untilMs > 0 ? new Date(Date.now() + untilMs) : null;

    await User.findByIdAndUpdate(req.user._id, {
      $pull: { mutedChats: { chatId } },
    });
    await User.findByIdAndUpdate(req.user._id, {
      $push: { mutedChats: { chatId, mutedAt: new Date(), until } },
    });

    return res.json({ message: 'Chat muted', chatId, muted: true, until });
  } catch (error) {
    console.error('Mute chat error:', error);
    return res.status(500).json({ message: 'Server error muting the chat' });
  }
};

// @desc    Unmute a chat
// @route   DELETE /api/users/me/muted/:chatId
// @access  Private
const unmuteChat = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { mutedChats: { chatId: req.params.chatId } },
    });
    return res.json({ message: 'Chat unmuted', chatId: req.params.chatId, muted: false });
  } catch (error) {
    console.error('Unmute chat error:', error);
    return res.status(500).json({ message: 'Server error unmuting the chat' });
  }
};

// @desc    List muted chats
// @route   GET /api/users/me/muted
// @access  Private
const getMutedChats = async (req, res) => {
  try {
    const me = await User.findById(req.user._id).select('mutedChats');
    const now = Date.now();
    const rows = (me?.mutedChats || []).filter(
      (entry) => !entry.until || new Date(entry.until).getTime() > now
    );
    return res.json(
      rows.map((entry) => ({
        chatId: String(entry.chatId),
        mutedAt: entry.mutedAt,
        until: entry.until || null,
      }))
    );
  } catch (error) {
    console.error('List muted chats error:', error);
    return res.status(500).json({ message: 'Server error listing muted chats' });
  }
};

/* ----------------------------------------------------------------- report */

// @desc    Report a user
// @route   POST /api/users/:id/report
// @access  Private
const reportUser = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    const targetId = req.params.id;
    if (targetId === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot report yourself' });
    }
    const target = await User.findById(targetId).select('_id displayName');
    if (!target) return res.status(404).json({ message: 'User not found' });

    const body = req.body || {};
    const allowed = ['spam', 'abuse', 'harassment', 'impersonation', 'scam', 'other'];
    const reason = allowed.includes(body.reason) ? body.reason : 'other';
    const details = String(body.details || '').slice(0, 2000);

    const report = await Report.create({
      reporterId: req.user._id,
      targetUserId: targetId,
      chatId: mongoose.Types.ObjectId.isValid(body.chatId) ? body.chatId : null,
      targetMessageId: mongoose.Types.ObjectId.isValid(body.messageId) ? body.messageId : null,
      reason,
      details,
    });

    // Best-effort owner alert; never block the report on a notification channel.
    try {
      const supportNotifier = require('../support/notifier');
      const text =
        `🚩 User report\n\n` +
        `Reporter: ${req.user.displayName} (${req.user._id})\n` +
        `Reported: ${target.displayName} (${targetId})\n` +
        `Reason: ${reason}\n` +
        `Details: ${details || '(none)'}`;
      await supportNotifier.notifyAlert?.(text);
    } catch (notifyError) {
      console.warn('Report notification failed:', notifyError.message);
    }

    return res.status(201).json({
      message: 'Report received. Thank you — our team will review it.',
      reportId: String(report._id),
      reason,
    });
  } catch (error) {
    console.error('Report user error:', error);
    return res.status(500).json({ message: 'Server error sending the report' });
  }
};

module.exports = {
  getUsers,
  getPrivacy,
  updatePrivacy,
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
};
