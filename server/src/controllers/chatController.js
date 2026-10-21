// Chat controller
const Chat = require('../models/Chat');
const User = require('../models/User');
const Message = require('../models/Message');
const mongoose = require('mongoose');
const realtime = require('../utils/realtime');

const PARTICIPANT_FIELDS = '_id displayName avatarUrl about isOnline lastSeen phone email';

// @desc    Create a new chat (direct or group)
// @route   POST /api/chats
// @access  Private
const createChat = async (req, res) => {
  try {
    const { type } = req.body;

    if (!type || !['direct', 'group'].includes(type)) {
      return res.status(400).json({ message: 'Invalid chat type' });
    }

    // ------------------------------------------------------------- direct
    if (type === 'direct') {
      const participantId = req.body.participantId;
      if (!participantId) {
        return res.status(400).json({ message: 'Participant ID is required for direct chat' });
      }
      if (!mongoose.Types.ObjectId.isValid(participantId)) {
        return res.status(400).json({ message: 'Invalid participant ID' });
      }
      if (participantId === req.user._id.toString()) {
        return res.status(400).json({ message: 'Cannot start a direct chat with yourself' });
      }

      const participant = await User.findById(participantId);
      if (!participant) {
        return res.status(404).json({ message: 'Participant not found' });
      }

      const existingChat = await Chat.findOne({
        type: 'direct',
        participants: { $all: [req.user._id, participantId], $size: 2 },
      }).populate('participants', PARTICIPANT_FIELDS);

      if (existingChat) {
        return res.status(200).json(existingChat);
      }

      const chat = await Chat.create({
        type: 'direct',
        participants: [req.user._id, participantId],
      });

      const populatedChat = await Chat.findById(chat._id).populate(
        'participants',
        PARTICIPANT_FIELDS
      );

      // Both sides must be in the new room to receive real-time messages
      // without reconnecting.
      realtime.joinUsersToChat(chat._id, [req.user._id.toString(), participantId]);
      realtime.emitToUser(participantId, 'chat:new', populatedChat);
      realtime.emitToUser(req.user._id, 'chat:new', populatedChat);

      return res.status(201).json(populatedChat);
    }

    // -------------------------------------------------------------- group
    // The original implementation only ever put the creator in `participants`,
    // while the Chat schema requires >= 2 participants for a group, so every
    // group creation failed validation and returned 500.
    const groupName = (req.body.groupName || '').trim();
    if (!groupName) {
      return res.status(400).json({ message: 'Group name is required for group chat' });
    }

    const rawParticipants =
      req.body.participantIds || req.body.participants || [];
    if (!Array.isArray(rawParticipants)) {
      return res.status(400).json({ message: 'participantIds must be an array' });
    }

    const ids = [...new Set(rawParticipants.map(String))]
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .filter((id) => id !== req.user._id.toString());

    if (ids.length === 0) {
      return res.status(400).json({ message: 'Add at least one other member to the group' });
    }

    const existingUsers = await User.find({ _id: { $in: ids } }).select('_id');
    if (existingUsers.length !== ids.length) {
      return res.status(404).json({ message: 'One or more members were not found' });
    }

    const chat = await Chat.create({
      type: 'group',
      groupName,
      participants: [req.user._id, ...ids],
      groupAdmins: [req.user._id],
    });

    const populatedChat = await Chat.findById(chat._id).populate(
      'participants',
      PARTICIPANT_FIELDS
    );

    realtime.joinUsersToChat(chat._id, [req.user._id.toString(), ...ids]);
    for (const id of [req.user._id.toString(), ...ids]) {
      realtime.emitToUser(id, 'chat:new', populatedChat);
    }

    return res.status(201).json(populatedChat);
  } catch (error) {
    console.error('Create chat error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Chat already exists' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        message: Object.values(error.errors || {})[0]?.message || 'Invalid chat data',
      });
    }
    return res.status(500).json({ message: 'Server error creating chat' });
  }
};

// @desc    Get only the group chats I belong to
// @route   GET /api/chats/groups
// @access  Private
const getGroups = async (req, res) => {
  try {
    const groups = await Chat.find({ type: 'group', participants: req.user._id })
      .populate('participants', PARTICIPANT_FIELDS)
      .populate({
        path: 'lastMessage',
        select: '_id content type mediaUrl senderId sentAt',
        populate: { path: 'senderId', select: '_id displayName avatarUrl' },
      })
      .sort({ updatedAt: -1 })
      .lean();

    res.json(
      groups.map((group) => ({
        ...group,
        memberCount: group.participants.length,
        isAdmin: (group.groupAdmins || []).some(
          (a) => a.toString() === req.user._id.toString()
        ),
      }))
    );
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({ message: 'Server error fetching groups' });
  }
};

// @desc    Rename a group / change its avatar (admins only)
// @route   PATCH /api/chats/:id
// @access  Private (group admin)
const updateGroup = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid chat ID' });
    }

    const chat = await Chat.findById(id);
    if (!chat) return res.status(404).json({ message: 'Chat not found' });
    if (chat.type !== 'group') {
      return res.status(400).json({ message: 'Only groups can be edited' });
    }
    if (!chat.groupAdmins.some((a) => a.equals(req.user._id))) {
      return res.status(403).json({ message: 'Only group admins can edit the group' });
    }

    const { groupName, groupAvatar } = req.body;

    if (groupName !== undefined) {
      const name = String(groupName).trim();
      if (!name) return res.status(400).json({ message: 'Group name cannot be empty' });
      chat.groupName = name;
    }
    if (groupAvatar !== undefined) chat.groupAvatar = String(groupAvatar);

    await chat.save();

    const populated = await Chat.findById(chat._id).populate('participants', PARTICIPANT_FIELDS);
    realtime.joinUsersToChat(chat._id, populated.participants.map((p) => p._id.toString()));
    for (const participant of populated.participants) {
      realtime.emitToUser(participant._id, 'chat:updated', populated);
    }

    res.json(populated);
  } catch (error) {
    console.error('Update group error:', error);
    res.status(500).json({ message: 'Server error updating the group' });
  }
};

// @desc    Promote or demote a group admin
// @route   POST /api/chats/:id/admins
// @access  Private (group admin)
const setGroupAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, isAdmin = true } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid id' });
    }

    const chat = await Chat.findById(id);
    if (!chat) return res.status(404).json({ message: 'Chat not found' });
    if (chat.type !== 'group') {
      return res.status(400).json({ message: 'Only groups have admins' });
    }
    if (!chat.groupAdmins.some((a) => a.equals(req.user._id))) {
      return res.status(403).json({ message: 'Only group admins can change admins' });
    }
    if (!chat.participants.some((p) => p.equals(userId))) {
      return res.status(400).json({ message: 'That person is not in this group' });
    }

    if (isAdmin) {
      if (!chat.groupAdmins.some((a) => a.equals(userId))) chat.groupAdmins.push(userId);
    } else {
      // Never leave a group with no admin.
      const remaining = chat.groupAdmins.filter((a) => !a.equals(userId));
      if (remaining.length === 0) {
        return res.status(400).json({ message: 'A group needs at least one admin' });
      }
      chat.groupAdmins = remaining;
    }

    await chat.save();
    const populated = await Chat.findById(chat._id).populate('participants', PARTICIPANT_FIELDS);

    for (const participant of populated.participants) {
      realtime.emitToUser(participant._id, 'chat:updated', populated);
    }

    res.json(populated);
  } catch (error) {
    console.error('Set group admin error:', error);
    res.status(500).json({ message: 'Server error updating admins' });
  }
};

// @desc    Get user's chats
// @route   GET /api/chats
// @access  Private
const getChats = async (req, res) => {
  try {
    const chats = await Chat.find({ participants: req.user._id })
      .populate('participants', PARTICIPANT_FIELDS)
      .populate({
        path: 'lastMessage',
        select: '_id content type mediaUrl senderId sentAt readBy deliveredTo',
        populate: { path: 'senderId', select: '_id displayName avatarUrl' },
      })
      .sort({ updatedAt: -1 })
      .lean();

    // Unread counts in a single aggregation instead of one query per chat.
    const chatIds = chats.map((c) => c._id);
    const unread = chatIds.length
      ? await Message.aggregate([
          {
            $match: {
              chatId: { $in: chatIds },
              senderId: { $ne: req.user._id },
              readBy: { $nin: [req.user._id] },
            },
          },
          { $group: { _id: '$chatId', count: { $sum: 1 } } },
        ])
      : [];
    const unreadMap = new Map(unread.map((u) => [u._id.toString(), u.count]));

    const result = chats.map((chat) => ({
      ...chat,
      unreadCount: unreadMap.get(chat._id.toString()) || 0,
    }));

    res.json(result);
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({ message: 'Server error fetching chats' });
  }
};

// @desc    Get chat by ID
// @route   GET /api/chats/:id
// @access  Private
const getChatById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid chat ID' });
    }

    const chat = await Chat.findById(req.params.id)
      .populate('participants', PARTICIPANT_FIELDS)
      .populate({
        path: 'lastMessage',
        select: '_id content type mediaUrl senderId sentAt',
        populate: { path: 'senderId', select: '_id displayName avatarUrl' },
      });

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    const isParticipant = chat.participants.some((p) => p._id.equals(req.user._id));
    if (!isParticipant) {
      return res.status(403).json({ message: 'Not authorized to access this chat' });
    }

    res.json(chat);
  } catch (error) {
    console.error('Get chat by ID error:', error);
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ message: 'Invalid chat ID' });
    }
    res.status(500).json({ message: 'Server error fetching chat' });
  }
};

// @desc    Add members to a group
// @route   POST /api/chats/:id/participants
// @access  Private (group admin)
const addParticipants = async (req, res) => {
  try {
    const { participantIds } = req.body;
    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      return res.status(400).json({ message: 'participantIds array is required' });
    }

    const chat = await Chat.findById(req.params.id);
    if (!chat) return res.status(404).json({ message: 'Chat not found' });
    if (chat.type !== 'group') {
      return res.status(400).json({ message: 'Can only add members to a group chat' });
    }
    if (!chat.groupAdmins.some((a) => a.equals(req.user._id))) {
      return res.status(403).json({ message: 'Only group admins can add members' });
    }

    const ids = participantIds
      .map(String)
      .filter((id) => mongoose.Types.ObjectId.isValid(id));
    const existing = new Set(chat.participants.map((p) => p.toString()));
    const toAdd = ids.filter((id) => !existing.has(id));

    if (!toAdd.length) {
      return res.status(400).json({ message: 'All users are already members' });
    }

    chat.participants.push(...toAdd);
    await chat.save();

    const populated = await Chat.findById(chat._id).populate('participants', PARTICIPANT_FIELDS);
    realtime.joinUsersToChat(chat._id, toAdd);
    for (const id of [...existing, ...toAdd]) {
      realtime.emitToUser(id, 'chat:updated', populated);
    }

    res.json(populated);
  } catch (error) {
    console.error('Add participants error:', error);
    res.status(500).json({ message: 'Server error adding members' });
  }
};

// @desc    Remove a member from a group (or leave it)
// @route   DELETE /api/chats/:id/participants/:userId
// @access  Private (group admin, or the user themself)
const removeParticipant = async (req, res) => {
  try {
    const { id, userId } = req.params;

    const chat = await Chat.findById(id);
    if (!chat) return res.status(404).json({ message: 'Chat not found' });
    if (chat.type !== 'group') {
      return res.status(400).json({ message: 'Can only remove members from a group chat' });
    }

    const isSelf = userId === req.user._id.toString();
    const isAdmin = chat.groupAdmins.some((a) => a.equals(req.user._id));
    if (!isSelf && !isAdmin) {
      return res.status(403).json({ message: 'Only group admins can remove members' });
    }

    chat.participants = chat.participants.filter((p) => p.toString() !== userId);
    chat.groupAdmins = chat.groupAdmins.filter((a) => a.toString() !== userId);

    if (chat.participants.length === 0) {
      await Chat.findByIdAndDelete(id);
      return res.json({ message: 'Group deleted' });
    }

    await chat.save();
    const populated = await Chat.findById(chat._id).populate('participants', PARTICIPANT_FIELDS);
    realtime.emitToUser(userId, 'chat:removed', { chatId: id });

    res.json(populated);
  } catch (error) {
    console.error('Remove participant error:', error);
    res.status(500).json({ message: 'Server error removing member' });
  }
};


// @desc    Full member list for a group (with admin flags + online state)
// @route   GET /api/chats/:id/participants
// @access  Private (must be a member)
const getGroupMembers = async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.id).populate(
      'participants',
      'displayName avatarUrl about isOnline lastSeen showOnlineStatus'
    );
    if (!chat) return res.status(404).json({ message: 'Chat not found' });
    if (chat.type !== 'group') {
      return res.status(400).json({ message: 'This chat is not a group' });
    }

    const me = String(req.user._id);
    const isMember = (chat.participants || []).some((p) => String(p._id) === me);
    if (!isMember) return res.status(403).json({ message: 'You are not a member of this group' });

    const adminIds = (chat.groupAdmins || []).map(String);
    const members = (chat.participants || []).map((p) => ({
      _id: p._id,
      displayName: p.displayName,
      avatarUrl: p.avatarUrl,
      about: p.about,
      isAdmin: adminIds.includes(String(p._id)),
      isYou: String(p._id) === me,
      // Respect the privacy setting: hide presence when the member opted out.
      isOnline: p.showOnlineStatus === false ? false : Boolean(p.isOnline),
      lastSeen: p.showOnlineStatus === false ? null : p.lastSeen,
    }));

    return res.json({ chatId: chat._id, members, memberCount: members.length });
  } catch (error) {
    console.error('Get group members error:', error.message);
    return res.status(500).json({ message: 'Could not load the members' });
  }
};

// @desc    Leave a group
// @route   DELETE /api/chats/:id/leave
// @access  Private (member)
const leaveGroup = async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.id);
    if (!chat) return res.status(404).json({ message: 'Chat not found' });
    if (chat.type !== 'group') {
      return res.status(400).json({ message: 'You can only leave a group' });
    }

    const me = String(req.user._id);
    if (!chat.participants.map(String).includes(me)) {
      return res.status(400).json({ message: 'You are not a member of this group' });
    }

    const leaver = await User.findById(me).select('displayName');
    const leaverName = leaver?.displayName || 'A member';

    chat.participants = chat.participants.filter((p) => String(p) !== me);
    chat.groupAdmins = (chat.groupAdmins || []).filter((a) => String(a) !== me);

    let systemNote = `${leaverName} left`;

    if (chat.participants.length === 0) {
      // The group is empty. A group chat requires at least one participant, so
      // it cannot be saved in that state - delete it (and its messages) instead.
      try {
        await Message.deleteMany({ chatId: chat._id });
      } catch { /* history cleanup is best effort */ }
      await Chat.deleteOne({ _id: chat._id });
      try {
        const realtime = require('../utils/realtime');
        realtime.emitToUser(me, 'chat:removed', { chatId: chat._id });
      } catch { /* sockets are best effort */ }
      return res.json({ message: 'You left the group', removed: true, deleted: true });
    }

    // If the last admin left, promote the longest-standing member.
    let promoted = null;
    if (chat.groupAdmins.length === 0) {
      promoted = chat.participants[0];
      chat.groupAdmins = [promoted];
      const promotedUser = await User.findById(promoted).select('displayName');
      systemNote += `. ${promotedUser?.displayName || 'A member'} is now an admin`;
    }

    await chat.save();

    // System message so the others see what happened.
    try {
      const message = await Message.create({
        chatId: chat._id,
        senderId: me,
        type: 'text',
        content: systemNote,
        isSystem: true,
        sentAt: new Date(),
      });
      const populated = await Message.findById(message._id).populate('senderId', '_id displayName avatarUrl');
      const realtime = require('../utils/realtime');
      const io = realtime.getIo();
      io?.to(realtime.roomForChat(chat._id)).emit('message:new', populated);
      // Live member-list refresh for everyone still in the group.
      io?.to(realtime.roomForChat(chat._id)).emit('group:members', { chatId: chat._id, action: 'leave', userId: me });
      realtime.emitToUser(me, 'chat:removed', { chatId: chat._id });
    } catch (error) {
      console.warn('Leave-group notification failed:', error.message);
    }

    return res.json({ message: 'You left the group', removed: true, promoted: promoted ? String(promoted) : null });
  } catch (error) {
    console.error('Leave group error:', error.message);
    return res.status(500).json({ message: 'Could not leave the group' });
  }
};

module.exports = {
  createChat,
  getChats,
  getChatById,
  getGroups,
  updateGroup,
  setGroupAdmin,
  addParticipants,
  removeParticipant,
  getGroupMembers,
  leaveGroup,
};
