// User controller
const mongoose = require('mongoose');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const Report = require('../models/Report');
const realtime = require('../utils/realtime');
const presence = require('../utils/presence');
const { blockStatus } = require('../utils/blocks');
const { pendingDeletionShape } = require('../utils/accountDeletion');

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

function notificationPrefsShape(me) {
  const prefs = me?.notificationPrefs || {};
  return {
    dndEnabled: prefs.dndEnabled === true,
    dndStart: prefs.dndStart || '22:00',
    dndEnd: prefs.dndEnd || '07:00',
    // Opt-in smart replies (also exposed by /api/users/me/ai-settings).
    suggestReplies: me?.suggestReplies === true,
  };
}

const DISAPPEARING_VALUES = ['off', '24h', '7d', '90d'];

function aiSettingsShape(me) {
  return { suggestReplies: me?.suggestReplies === true };
}

function autoReplyShape(me) {
  const prefs = me?.autoReply || {};
  const schedule = prefs.schedule || {};
  const outside = schedule.mode === 'outsideHours';
  return {
    enabled: prefs.enabled === true,
    message: String(prefs.message || '').slice(0, 500),
    // Web contract sends/reads the dashed spelling; the DB keeps the enum value.
    schedule: outside ? 'outside-hours' : 'always',
    startTime: schedule.start || '18:00',
    endTime: schedule.end || '08:00',
    audience: prefs.audience === 'everyone' ? 'everyone' : 'contacts',
  };
}

function disappearingShape(me) {
  const duration = DISAPPEARING_VALUES.includes(me?.disappearingDefault) ? me.disappearingDefault : 'off';
  return { duration, seconds: require('../utils/disappearing').secondsFor(duration) };
}

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
    const users = await User.find({ _id: { $ne: req.user._id }, pendingDeletionAt: null })
      .select(PUBLIC_FIELDS)
      .sort({ displayName: 1 });

    res.json(presence.sortByPresence(presence.maskPresenceList(users, req.user._id)));
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
      // Accounts inside the deletion grace period are hidden from discovery.
      pendingDeletionAt: null,
      // The Chatgram AI contact is a system account, not a person to add.
      isAiAccount: { $ne: true },
      $or: [
        { displayName: { $regex: searchRegex } },
        { phone: { $regex: searchRegex } },
        { email: { $regex: searchRegex } },
      ],
    })
      .select(PUBLIC_FIELDS)
      .sort({ displayName: 1 })
      .limit(50);

    res.json(presence.sortByPresence(presence.maskPresenceList(users, req.user._id)));
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

// @desc    Read my notification preferences (DND schedule)
// @route   GET /api/users/me/notifications
// @access  Private
const getNotificationPrefs = async (req, res) => {
  try {
    const me = await User.findById(req.user._id).select('notificationPrefs');
    res.json(notificationPrefsShape(me));
  } catch (error) {
    console.error('Get notification prefs error:', error);
    res.status(500).json({ message: 'Server error fetching notification settings' });
  }
};

// @desc    Update my notification preferences (DND schedule)
// @route   PUT /api/users/me/notifications
// @access  Private
const updateNotificationPrefs = async (req, res) => {
  try {
    const body = req.body || {};
    const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
    const update = {};

    if (body.dndEnabled !== undefined) update['notificationPrefs.dndEnabled'] = bool(body.dndEnabled);
    if (body.dndStart !== undefined) {
      if (!timePattern.test(String(body.dndStart))) {
        return res.status(400).json({ message: 'Use a 24-hour time like 22:00 for the start.', code: 'INVALID_TIME' });
      }
      update['notificationPrefs.dndStart'] = String(body.dndStart);
    }
    if (body.dndEnd !== undefined) {
      if (!timePattern.test(String(body.dndEnd))) {
        return res.status(400).json({ message: 'Use a 24-hour time like 07:00 for the end.', code: 'INVALID_TIME' });
      }
      update['notificationPrefs.dndEnd'] = String(body.dndEnd);
    }
    // Opt-in smart replies travel with the same settings payload for
    // compatibility with the existing Settings screen.
    if (body.suggestReplies !== undefined) update.suggestReplies = bool(body.suggestReplies);

    const me = await User.findByIdAndUpdate(req.user._id, { $set: update }, { new: true }).select('notificationPrefs');
    res.json({ message: 'Notification settings saved', ...notificationPrefsShape(me) });
  } catch (error) {
    console.error('Update notification prefs error:', error);
    res.status(500).json({ message: 'Server error saving notification settings' });
  }
};

/* ------------------------------------------------ AI + privacy settings pages */

// @desc    Get my AI preferences (opt-in smart replies)
// @route   GET /api/users/me/ai-settings
// @access  Private
const getAiSettings = async (req, res) => {
  try {
    const me = await User.findById(req.user._id).select('suggestReplies');
    return res.json(aiSettingsShape(me));
  } catch (error) {
    console.error('Get AI settings error:', error);
    return res.status(500).json({ message: 'Server error fetching AI settings' });
  }
};

// @desc    Update my AI preferences
// @route   PUT /api/users/me/ai-settings
// @access  Private
const updateAiSettings = async (req, res) => {
  try {
    const body = req.body || {};
    if (body.suggestReplies !== undefined && typeof body.suggestReplies !== 'boolean') {
      return res.status(400).json({ message: 'suggestReplies must be true or false.', code: 'INVALID_SUGGEST_REPLIES' });
    }
    const update = {};
    if (body.suggestReplies !== undefined) update.suggestReplies = body.suggestReplies;
    const me = await User.findByIdAndUpdate(req.user._id, { $set: update }, { new: true }).select('suggestReplies');
    return res.json(aiSettingsShape(me));
  } catch (error) {
    console.error('Update AI settings error:', error);
    return res.status(500).json({ message: 'Server error saving AI settings' });
  }
};

// @desc    Get my auto-reply / away message
// @route   GET /api/users/me/auto-reply
// @access  Private
const getAutoReply = async (req, res) => {
  try {
    const me = await User.findById(req.user._id).select('autoReply');
    return res.json(autoReplyShape(me));
  } catch (error) {
    console.error('Get auto-reply error:', error);
    return res.status(500).json({ message: 'Server error fetching the auto-reply settings' });
  }
};

// @desc    Update my auto-reply / away message (validated)
// @route   PUT /api/users/me/auto-reply
// @access  Private
const updateAutoReply = async (req, res) => {
  try {
    const body = req.body || {};
    const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
    const me = await User.findById(req.user._id).select('autoReply');
    const next = autoReplyShape(me);

    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') {
        return res.status(400).json({ message: 'enabled must be true or false.', code: 'INVALID_ENABLED' });
      }
      next.enabled = body.enabled;
    }
    if (body.message !== undefined) {
      if (typeof body.message !== 'string') {
        return res.status(400).json({ message: 'The auto-reply message must be text.', code: 'INVALID_MESSAGE' });
      }
      const message = body.message.trim();
      if (message.length > 500) {
        return res.status(400).json({ message: 'The auto-reply message is too long (max 500 characters).', code: 'MESSAGE_TOO_LONG' });
      }
      next.message = message;
    }

    let mode = body.schedule?.mode ?? body.schedule ?? body.mode;
    if (mode !== undefined) {
      const value = String(mode).trim();
      if (value === 'always') next.schedule = 'always';
      else if (value === 'outsideHours' || value === 'outside-hours') next.schedule = 'outside-hours';
      else return res.status(400).json({ message: 'Schedule must be always or outside-hours.', code: 'INVALID_SCHEDULE' });
    }
    const startRaw = body.startTime ?? body.start ?? body.schedule?.start;
    const endRaw = body.endTime ?? body.end ?? body.schedule?.end;
    if (startRaw !== undefined) {
      if (!timePattern.test(String(startRaw))) {
        return res.status(400).json({ message: 'Use a 24-hour time like 18:00 for the start.', code: 'INVALID_TIME' });
      }
      next.startTime = String(startRaw);
    }
    if (endRaw !== undefined) {
      if (!timePattern.test(String(endRaw))) {
        return res.status(400).json({ message: 'Use a 24-hour time like 08:00 for the end.', code: 'INVALID_TIME' });
      }
      next.endTime = String(endRaw);
    }
    if (body.audience !== undefined) {
      const audience = String(body.audience).trim();
      if (audience !== 'contacts' && audience !== 'everyone') {
        return res.status(400).json({ message: 'Audience must be contacts or everyone.', code: 'INVALID_AUDIENCE' });
      }
      next.audience = audience;
    }

    if (next.enabled && !String(next.message || '').trim()) {
      return res.status(400).json({ message: 'Write the auto-reply message before enabling it.', code: 'MESSAGE_REQUIRED' });
    }

    const updated = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          'autoReply.enabled': next.enabled,
          'autoReply.message': next.message,
          'autoReply.schedule.mode': next.schedule === 'outside-hours' ? 'outsideHours' : 'always',
          'autoReply.schedule.start': next.startTime,
          'autoReply.schedule.end': next.endTime,
          'autoReply.audience': next.audience,
        },
      },
      { new: true },
    ).select('autoReply');
    return res.json(autoReplyShape(updated));
  } catch (error) {
    console.error('Update auto-reply error:', error);
    return res.status(500).json({ message: 'Server error saving the auto-reply settings' });
  }
};

// @desc    Get my global disappearing-messages default (new direct chats only)
// @route   GET /api/users/me/disappearing-default
// @access  Private
const getDisappearingDefault = async (req, res) => {
  try {
    const me = await User.findById(req.user._id).select('disappearingDefault');
    return res.json(disappearingShape(me));
  } catch (error) {
    console.error('Get disappearing default error:', error);
    return res.status(500).json({ message: 'Server error fetching the disappearing-messages default' });
  }
};

// @desc    Update my global disappearing-messages default
// @route   PUT /api/users/me/disappearing-default
// @access  Private
const updateDisappearingDefault = async (req, res) => {
  try {
    const raw = req.body?.duration ?? req.body?.value ?? req.body?.default;
    const duration = require('../utils/disappearing').normalize(raw);
    if (!duration) {
      return res.status(400).json({
        message: 'Duration must be one of: off, 24h, 7d, 90d.',
        code: 'INVALID_DURATION',
      });
    }
    const me = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { disappearingDefault: duration } },
      { new: true },
    ).select('disappearingDefault');
    return res.json(disappearingShape(me));
  } catch (error) {
    console.error('Update disappearing default error:', error);
    return res.status(500).json({ message: 'Server error saving the disappearing-messages default' });
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
      // Live sockets only: the persisted flag can be left stuck by a restart.
      isOnline: presenceAllowed ? presence.livePresence(target._id) : false,
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

// @desc    Current user's own record (sign-in client contract)
// @route   GET /api/users/me
// @access  Private
const getMe = async (req, res) => {
  try {
    const me = req.user.toObject ? req.user.toObject() : { ...req.user };
    // Additive: null normally, { deleteAt, reason? } during the 14-day grace.
    me.pendingDeletion = pendingDeletionShape(req.user);
    return res.json(me);
  } catch (error) {
    console.error('Get me error:', error);
    return res.status(500).json({ message: 'Server error fetching the profile' });
  }
};

module.exports = {
  getMe,
  getAiSettings,
  updateAiSettings,
  getAutoReply,
  updateAutoReply,
  getDisappearingDefault,
  updateDisappearingDefault,
  getNotificationPrefs,
  updateNotificationPrefs,
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
