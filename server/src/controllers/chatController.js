// Chat controller
const Chat = require('../models/Chat');
const User = require('../models/User');
const Message = require('../models/Message');
const mongoose = require('mongoose');
const realtime = require('../utils/realtime');
const { livePresence, chatWithLivePresence } = require('../utils/presence');
const { blockedBetween } = require('../utils/blocks');
const groupSystem = require('../utils/groupSystem');
const crypto = require('crypto');
const storage = require('../utils/storage');

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

      // A blocked pair cannot start a new conversation with each other.
      if (await blockedBetween(req.user._id, participantId)) {
        return res.status(403).json({
          message: 'You cannot start a chat with this person.',
          code: 'BLOCKED',
        });
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

      return res.status(201).json(chatWithLivePresence(populatedChat, req.user._id));
    }

    // -------------------------------------------------------------- group
    // The original implementation only ever put the creator in `participants`,
    // while the Chat schema requires >= 2 participants for a group, so every
    // group creation failed validation and returned 500.
    const groupName = (req.body.groupName || '').trim();
    if (!groupName) {
      return res.status(400).json({ message: 'Group name is required for group chat' });
    }
    if (groupName.length > 100) {
      return res.status(400).json({ message: 'Group name is too long (max 100 characters)', code: 'GROUP_NAME_TOO_LONG' });
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

    const existingUsers = await User.find({ _id: { $in: ids } }).select(
      '_id displayName whoCanAddToGroups contacts'
    );
    if (existingUsers.length !== ids.length) {
      return res.status(404).json({ message: 'One or more members were not found' });
    }

    // "Who can add me to groups" privacy applies at creation time too.
    const onlyContacts = existingUsers.filter(
      (user) =>
        user.whoCanAddToGroups === 'contacts' &&
        !(user.contacts || []).some((id) => String(id) === String(req.user._id))
    );
    if (onlyContacts.length > 0) {
      return res.status(403).json({
        message: `${onlyContacts
          .map((user) => user.displayName)
          .join(', ')} only allow people in their contacts to add them to groups.`,
        code: 'GROUP_ADD_NOT_ALLOWED',
        userIds: onlyContacts.map((user) => String(user._id)),
      });
    }

    const chat = await Chat.create({
      type: 'group',
      groupName,
      groupDescription: String(req.body.groupDescription || req.body.description || '').slice(0, 1024),
      groupCreatedBy: req.user._id,
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

    return res.status(201).json(chatWithLivePresence(populatedChat, req.user._id));
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
      groups.map((group) => {
        const shaped = chatWithLivePresence(group, req.user._id);
        return {
          ...shaped,
          memberCount: shaped.participants.length,
          isAdmin: (group.groupAdmins || []).some(
            (a) => a.toString() === req.user._id.toString()
          ),
        };
      })
    );
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({ message: 'Server error fetching groups' });
  }
};

// @desc    Rename a group / change its avatar, description or permissions
// @route   PATCH /api/chats/:id
// @access  Private (per group settings: anyone or admins)
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
    if (!groupSystem.canEditInfo(chat, req.user._id)) {
      return res.status(403).json({
        message: 'Only group admins can edit this group. Ask an admin to change it.',
        code: 'GROUP_EDIT_FORBIDDEN',
      });
    }

    const body = req.body || {};
    const changes = [];
    const groupName = body.groupName;
    const groupDescription = body.groupDescription ?? body.description;
    const groupAvatar = body.groupAvatar;

    if (groupName !== undefined) {
      const name = String(groupName).trim();
      if (!name) return res.status(400).json({ message: 'Group name cannot be empty' });
      if (name.length > 100) return res.status(400).json({ message: 'Group name is too long (max 100 characters)' });
      if (name !== chat.groupName) {
        chat.groupName = name;
        changes.push(`changed the group name to "${name}"`);
      }
    }
    if (groupAvatar !== undefined) {
      chat.groupAvatar = String(groupAvatar);
      changes.push('changed the group photo');
    }
    if (groupDescription !== undefined) {
      const description = String(groupDescription).slice(0, 1024);
      if (description !== chat.groupDescription) {
        chat.groupDescription = description;
        changes.push(description ? 'changed the group description' : 'removed the group description');
      }
    }

    let settingsChanged = false;
    if (body.groupSettings && typeof body.groupSettings === 'object') {
      if (!groupSystem.isAdmin(chat, req.user._id)) {
        return res.status(403).json({
          message: 'Only group admins can change group settings.',
          code: 'GROUP_SETTINGS_FORBIDDEN',
        });
      }
      const next = { ...groupSystem.settingsOf(chat) };
      for (const key of ['whoCanEditInfo', 'whoCanSendMessages', 'whoCanAddMembers']) {
        if (body.groupSettings[key] !== undefined) {
          next[key] = body.groupSettings[key] === 'admins' ? 'admins' : 'all';
          settingsChanged = true;
        }
      }
      if (body.groupSettings.requireApproval !== undefined) {
        next.requireApproval = Boolean(body.groupSettings.requireApproval);
        settingsChanged = true;
      }
      if (body.groupSettings.aiMentions !== undefined) {
        next.aiMentions = Boolean(body.groupSettings.aiMentions);
        settingsChanged = true;
      }
      chat.groupSettings = next;
      if (settingsChanged) changes.push('changed the group permissions');
    }

    if (!changes.length && !settingsChanged) {
      const unchanged = await Chat.findById(chat._id).populate('participants', PARTICIPANT_FIELDS);
      return res.json(unchanged);
    }

    await chat.save();

    const me = await User.findById(req.user._id).select('displayName');
    if (changes.length) {
      await groupSystem.postSystemMessage(chat, `${me?.displayName || 'A member'} ${changes.join(', ')}`);
    }

    const populated = await groupSystem.broadcastChatUpdate(chat._id);
    groupSystem.broadcastMemberList(chat._id);
    res.json(chatWithLivePresence(populated, req.user._id));
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
        return res.status(400).json({
          message: 'A group needs at least one admin. Promote somebody else first.',
          code: 'LAST_ADMIN',
        });
      }
      chat.groupAdmins = remaining;
    }

    await chat.save();

    const target = await User.findById(userId).select('displayName');
    const actor = await User.findById(req.user._id).select('displayName');
    const targetName = target?.displayName || 'A member';
    await groupSystem.postSystemMessage(
      chat,
      isAdmin
        ? `${targetName} is now an admin`
        : `${targetName} is no longer an admin`,
    );
    void actor;

    const populated = await groupSystem.broadcastChatUpdate(chat._id);
    groupSystem.broadcastMemberList(chat._id);

    res.json(chatWithLivePresence(populated, req.user._id));
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
      ...chatWithLivePresence(chat, req.user._id),
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

    res.json(chatWithLivePresence(chat, req.user._id));
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
    if (!chat.groupAdmins.some((a) => a.equals(req.user._id)) && !groupSystem.canAddMembers(chat, req.user._id)) {
      return res.status(403).json({
        message: 'Only group admins can add members to this group.',
        code: 'GROUP_ADD_FORBIDDEN',
      });
    }

    const ids = participantIds
      .map(String)
      .filter((id) => mongoose.Types.ObjectId.isValid(id));
    const existing = new Set(chat.participants.map((p) => p.toString()));
    const toAdd = ids.filter((id) => !existing.has(id));

    if (!toAdd.length) {
      return res.status(400).json({ message: 'All users are already members' });
    }

    // "Who can add me to groups" privacy: when the target chose "only my
    // contacts", the requester must be one of their contacts.
    const targets = await User.find({ _id: { $in: toAdd } }).select(
      '_id displayName whoCanAddToGroups contacts'
    );
    const knownIds = new Set(targets.map((user) => String(user._id)));
    const onlyContacts = targets.filter(
      (user) =>
        user.whoCanAddToGroups === 'contacts' &&
        !(user.contacts || []).some((id) => String(id) === String(req.user._id))
    );
    if (onlyContacts.length > 0) {
      return res.status(403).json({
        message: `${onlyContacts
          .map((user) => user.displayName)
          .join(', ')} only allow people in their contacts to add them to groups.`,
        code: 'GROUP_ADD_NOT_ALLOWED',
        userIds: onlyContacts.map((user) => String(user._id)),
      });
    }

    // Ignore ids that do not resolve to a real account.
    const addable = toAdd.filter((id) => knownIds.has(id));
    if (!addable.length) {
      return res.status(400).json({ message: 'No matching users to add' });
    }

    chat.participants.push(...addable);
    await chat.save();

    const actor = await User.findById(req.user._id).select('displayName');
    const added = await User.find({ _id: { $in: addable } }).select('displayName');
    await groupSystem.postSystemMessage(
      chat,
      `${actor?.displayName || 'A member'} added ${added.map((u) => u.displayName).join(', ')}`,
    );

    realtime.joinUsersToChat(chat._id, addable);
    const populated = await groupSystem.broadcastChatUpdate(chat._id);
    groupSystem.broadcastMemberList(chat._id);

    res.json(chatWithLivePresence(populated, req.user._id));
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

    const removedUser = await User.findById(userId).select('displayName');
    const actor = await User.findById(req.user._id).select('displayName');
    const actorName = isSelf ? (removedUser?.displayName || 'A member') : (actor?.displayName || 'An admin');
    await groupSystem.postSystemMessage(
      chat,
      isSelf ? `${actorName} left` : `${actorName} removed ${removedUser?.displayName || 'a member'}`,
    );

    realtime.emitToUser(userId, 'chat:removed', { chatId: id });
    const populated = await groupSystem.broadcastChatUpdate(chat._id);
    groupSystem.broadcastMemberList(chat._id);

    res.json(chatWithLivePresence(populated, req.user._id));
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
      // ObjectId contains a creation timestamp: a good proxy for "joined".
      joinedAt: p._id && typeof p._id.getTimestamp === 'function' ? p._id.getTimestamp() : null,
      isAdmin: adminIds.includes(String(p._id)),
      isYou: String(p._id) === me,
      // Respect the privacy setting: hide presence when the member opted out.
      // Live sockets only: the persisted flag can be left stuck by a restart.
      isOnline: p.showOnlineStatus === false ? false : livePresence(p._id),
      lastSeen: p.showOnlineStatus === false ? null : p.lastSeen,
    }));

    const creator = chat.groupCreatedBy
      ? await User.findById(chat.groupCreatedBy).select('_id displayName').lean()
      : null;

    return res.json({
      chatId: chat._id,
      members,
      memberCount: members.length,
      group: {
        id: String(chat._id),
        name: chat.groupName || 'Group',
        description: chat.groupDescription || '',
        avatarUrl: chat.groupAvatar || '',
        createdBy: creator ? { id: String(creator._id), displayName: creator.displayName } : null,
        createdAt: chat.createdAt || null,
        settings: groupSystem.settingsOf(chat),
        inviteEnabled: chat.inviteEnabled === true,
        inviteToken: groupSystem.isAdmin(chat, me) && chat.inviteEnabled ? chat.inviteToken : null,
        pinnedMessageId: chat.pinnedMessageId ? String(chat.pinnedMessageId) : null,
      },
    });
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

    // System message so the others see what happened, a live member-list
    // refresh, and a chat:removed to the leaver.
    try {
      await groupSystem.postSystemMessage(chat, systemNote, { senderId: me });
      groupSystem.broadcastMemberList(chat._id);
      groupSystem.broadcastChatUpdate(chat._id).catch(() => {});
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

/* ------------------------------------------------------------ invite links */

const MAX_GROUP_MEMBERS = 256;

function invitePath(token) {
  return `/join/${token}`;
}

// @desc    Read the group's invite link (admins only)
// @route   GET /api/chats/:id/invite
// @access  Private (group admin)
const getInvite = async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.id);
    if (!chat) return res.status(404).json({ message: 'Chat not found' });
    if (chat.type !== 'group') return res.status(400).json({ message: 'Only groups have invite links' });
    if (!groupSystem.isAdmin(chat, req.user._id)) {
      return res.status(403).json({ message: 'Only group admins can manage the invite link' });
    }
    return res.json({
      chatId: String(chat._id),
      inviteEnabled: chat.inviteEnabled === true,
      token: chat.inviteEnabled ? chat.inviteToken : null,
      path: chat.inviteEnabled && chat.inviteToken ? invitePath(chat.inviteToken) : null,
    });
  } catch (error) {
    console.error('Get invite error:', error);
    return res.status(500).json({ message: 'Could not read the invite link' });
  }
};

// @desc    Create or reset the group invite link (admins only)
// @route   POST /api/chats/:id/invite
// @access  Private (group admin)
const createInvite = async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.id);
    if (!chat) return res.status(404).json({ message: 'Chat not found' });
    if (chat.type !== 'group') return res.status(400).json({ message: 'Only groups have invite links' });
    if (!groupSystem.isAdmin(chat, req.user._id)) {
      return res.status(403).json({ message: 'Only group admins can manage the invite link' });
    }

    chat.inviteToken = crypto.randomBytes(18).toString('base64url');
    chat.inviteEnabled = true;
    await chat.save();

    return res.json({
      message: chat.inviteToken ? 'Invite link ready' : 'Invite link created',
      chatId: String(chat._id),
      inviteEnabled: true,
      token: chat.inviteToken,
      path: invitePath(chat.inviteToken),
    });
  } catch (error) {
    console.error('Create invite error:', error);
    return res.status(500).json({ message: 'Could not create the invite link' });
  }
};

// @desc    Revoke the invite link (admins only)
// @route   DELETE /api/chats/:id/invite
// @access  Private (group admin)
const revokeInvite = async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.id);
    if (!chat) return res.status(404).json({ message: 'Chat not found' });
    if (!groupSystem.isAdmin(chat, req.user._id)) {
      return res.status(403).json({ message: 'Only group admins can manage the invite link' });
    }
    chat.inviteToken = null;
    chat.inviteEnabled = false;
    await chat.save();
    return res.json({ message: 'Invite link revoked', chatId: String(chat._id), inviteEnabled: false, token: null });
  } catch (error) {
    console.error('Revoke invite error:', error);
    return res.status(500).json({ message: 'Could not revoke the invite link' });
  }
};

// @desc    Preview a group from its invite link
// @route   GET /api/chats/invite/:token
// @access  Private
const previewInvite = async (req, res) => {
  try {
    const token = String(req.params.token || '');
    const chat = await Chat.findOne({ inviteToken: token, inviteEnabled: true });
    if (!chat) {
      return res.status(404).json({ message: 'This invite link is not valid or was revoked.', code: 'INVITE_INVALID' });
    }
    const alreadyMember = chat.participants.some((p) => String(p) === String(req.user._id));
    return res.json({
      chatId: String(chat._id),
      name: chat.groupName || 'Group',
      description: chat.groupDescription || '',
      avatarUrl: chat.groupAvatar || '',
      memberCount: chat.participants.length,
      alreadyMember,
      full: chat.participants.length >= MAX_GROUP_MEMBERS,
    });
  } catch (error) {
    console.error('Preview invite error:', error);
    return res.status(500).json({ message: 'Could not read the invite link' });
  }
};

// @desc    Join a group via its invite link
// @route   POST /api/chats/invite/:token/join
// @access  Private
const joinViaInvite = async (req, res) => {
  try {
    const token = String(req.params.token || '');
    const chat = await Chat.findOne({ inviteToken: token, inviteEnabled: true });
    if (!chat) {
      return res.status(404).json({ message: 'This invite link is not valid or was revoked.', code: 'INVITE_INVALID' });
    }
    if (chat.participants.some((p) => String(p) === String(req.user._id))) {
      const existing = await Chat.findById(chat._id).populate('participants', PARTICIPANT_FIELDS);
      return res.json({ message: 'You are already a member', chat: existing, alreadyMember: true });
    }
    if (chat.participants.length >= MAX_GROUP_MEMBERS) {
      return res.status(403).json({
        message: `This group is full (maximum ${MAX_GROUP_MEMBERS} members).`,
        code: 'GROUP_FULL',
      });
    }

    // Groups that require approval do not let the invite link join directly.
    if (groupSystem.settingsOf(chat).requireApproval) {
      const pending = await addJoinRequest(chat, req.user._id);
      if (!pending.created) {
        return res.status(200).json({
          message: 'Your request to join is waiting for an admin to approve it.',
          pending: true,
          alreadyRequested: true,
        });
      }
      return res.status(202).json({
        message: 'Join request sent. An admin will approve or decline it.',
        pending: true,
      });
    }

    chat.participants.push(req.user._id);
    await chat.save();

    const joiner = await User.findById(req.user._id).select('displayName');
    await groupSystem.postSystemMessage(chat, `${joiner?.displayName || 'A member'} joined via the invite link`);

    realtime.joinUsersToChat(chat._id, [String(req.user._id)]);
    const populated = await groupSystem.broadcastChatUpdate(chat._id);
    groupSystem.broadcastMemberList(chat._id);

    return res.json({ message: 'Joined the group', chat: populated, alreadyMember: false });
  } catch (error) {
    console.error('Join via invite error:', error);
    return res.status(500).json({ message: 'Could not join the group' });
  }
};

/* ------------------------------------------------------- join requests */

/** Store a pending request (idempotent) and notify the group's admins live. */
async function addJoinRequest(chat, userId) {
  const existing = (chat.joinRequests || []).find((request) => String(request.user) === String(userId));
  if (existing) return { created: false };
  chat.joinRequests.push({ user: userId, requestedAt: new Date() });
  await chat.save();
  const requester = await User.findById(userId).select('displayName avatarUrl');
  realtime.emitToChat(chat._id, 'group:join-request', {
    chatId: String(chat._id),
    user: requester ? { id: String(requester._id), displayName: requester.displayName, avatarUrl: requester.avatarUrl } : null,
    requestedAt: new Date().toISOString(),
  });
  return { created: true };
}

// @desc    Ask to join a group (used by the invite page for approval groups)
// @route   POST /api/chats/:id/join-request
// @access  Private
const requestToJoin = async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.id);
    if (!chat || chat.type !== 'group') return res.status(404).json({ message: 'Group not found' });
    if (chat.participants.some((participant) => String(participant) === String(req.user._id))) {
      return res.status(400).json({ message: 'You are already a member.', code: 'ALREADY_MEMBER' });
    }
    if (chat.participants.length >= MAX_GROUP_MEMBERS) {
      return res.status(403).json({ message: 'This group is full.', code: 'GROUP_FULL' });
    }
    if (!groupSystem.settingsOf(chat).requireApproval) {
      // No approval needed: join directly (same as the invite link).
      chat.participants.push(req.user._id);
      await chat.save();
      const joiner = await User.findById(req.user._id).select('displayName');
      await groupSystem.postSystemMessage(chat, `${joiner?.displayName || 'A member'} joined the group`);
      realtime.joinUsersToChat(chat._id, [String(req.user._id)]);
      const populated = await groupSystem.broadcastChatUpdate(chat._id);
      groupSystem.broadcastMemberList(chat._id);
      return res.json({ message: 'Joined the group', chat: populated, joined: true });
    }
    const pending = await addJoinRequest(chat, req.user._id);
    return res
      .status(pending.created ? 202 : 200)
      .json({ message: 'Join request sent. An admin will approve or decline it.', pending: true, alreadyRequested: !pending.created });
  } catch (error) {
    console.error('Join request error:', error);
    return res.status(500).json({ message: 'Could not send the join request' });
  }
};

// @desc    List pending join requests (admins only)
// @route   GET /api/chats/:id/join-requests
// @access  Private (group admin)
const getJoinRequests = async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.id).populate('joinRequests.user', PARTICIPANT_FIELDS);
    if (!chat || chat.type !== 'group') return res.status(404).json({ message: 'Group not found' });
    if (!groupSystem.isAdmin(chat, req.user._id)) {
      return res.status(403).json({ message: 'Only group admins can see join requests.', code: 'GROUP_ADMIN_ONLY' });
    }
    return res.json({
      requests: (chat.joinRequests || []).map((request) => ({
        user: request.user,
        requestedAt: request.requestedAt,
        note: request.note || '',
      })),
    });
  } catch (error) {
    console.error('Get join requests error:', error);
    return res.status(500).json({ message: 'Could not load join requests' });
  }
};

// @desc    Approve or decline a pending join request
// @route   POST /api/chats/:id/join-requests/:userId/approve | /reject
// @access  Private (group admin)
const respondJoinRequest = async (req, res) => {
  try {
    const { id, userId } = req.params;
    const approve = req.path.endsWith('/approve');
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid group or user ID' });
    }
    const chat = await Chat.findById(id);
    if (!chat || chat.type !== 'group') return res.status(404).json({ message: 'Group not found' });
    if (!groupSystem.isAdmin(chat, req.user._id)) {
      return res.status(403).json({ message: 'Only group admins can respond to join requests.', code: 'GROUP_ADMIN_ONLY' });
    }
    const pending = (chat.joinRequests || []).some((request) => String(request.user) === userId);
    if (!pending) return res.status(404).json({ message: 'That join request no longer exists.' });

    chat.joinRequests = chat.joinRequests.filter((request) => String(request.user) !== userId);
    if (!approve) {
      await chat.save();
      return res.json({ message: 'Join request declined.', approved: false });
    }

    if (chat.participants.length >= MAX_GROUP_MEMBERS) {
      return res.status(403).json({ message: 'This group is full.', code: 'GROUP_FULL' });
    }
    chat.participants.push(userId);
    await chat.save();
    const joiner = await User.findById(userId).select('displayName');
    await groupSystem.postSystemMessage(chat, `${joiner?.displayName || 'A new member'} was approved to join the group`);
    realtime.joinUsersToChat(chat._id, [userId]);
    await groupSystem.broadcastChatUpdate(chat._id);
    groupSystem.broadcastMemberList(chat._id);
    return res.json({ message: 'Join request approved.', approved: true });
  } catch (error) {
    console.error('Respond join request error:', error);
    return res.status(500).json({ message: 'Could not respond to the join request' });
  }
};

/* ------------------------------------------------------------- pinned + media */

// @desc    Pin a message in a group
// @route   POST /api/chats/:id/pin
// @access  Private (member)
const pinMessage = async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.id);
    if (!chat) return res.status(404).json({ message: 'Chat not found' });
    if (chat.type !== 'group') return res.status(400).json({ message: 'Only groups can pin messages' });
    if (!chat.participants.some((p) => String(p) === String(req.user._id))) {
      return res.status(403).json({ message: 'You are not a member of this group' });
    }
    const { messageId } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ message: 'Invalid message ID' });
    }
    const message = await Message.findOne({ _id: messageId, chatId: chat._id, isDeleted: { $ne: true } });
    if (!message) return res.status(404).json({ message: 'Message not found in this group' });

    chat.pinnedMessageId = message._id;
    await chat.save();
    await groupSystem.broadcastChatUpdate(chat._id);
    return res.json({ chatId: String(chat._id), pinnedMessageId: String(message._id), message });
  } catch (error) {
    console.error('Pin message error:', error);
    return res.status(500).json({ message: 'Could not pin the message' });
  }
};

// @desc    Unpin the group's pinned message
// @route   DELETE /api/chats/:id/pin
// @access  Private (member)
const unpinMessage = async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.id);
    if (!chat) return res.status(404).json({ message: 'Chat not found' });
    if (!chat.participants.some((p) => String(p) === String(req.user._id))) {
      return res.status(403).json({ message: 'You are not a member of this group' });
    }
    chat.pinnedMessageId = null;
    await chat.save();
    await groupSystem.broadcastChatUpdate(chat._id);
    return res.json({ chatId: String(chat._id), pinnedMessageId: null });
  } catch (error) {
    console.error('Unpin message error:', error);
    return res.status(500).json({ message: 'Could not unpin the message' });
  }
};

// @desc    Shared media / files / links in this chat
// @route   GET /api/chats/:id/media
// @access  Private (member)
const getChatMedia = async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.id).select('participants type');
    if (!chat) return res.status(404).json({ message: 'Chat not found' });
    if (!chat.participants.some((p) => String(p) === String(req.user._id))) {
      return res.status(403).json({ message: 'You are not a member of this chat' });
    }

    const media = await Message.find({
      chatId: chat._id,
      isDeleted: { $ne: true },
      mediaUrl: { $ne: null },
      type: { $in: ['image', 'video', 'audio', 'file'] },
    })
      .sort({ sentAt: -1 })
      .limit(100)
      .select('_id type mediaUrl content sentAt senderId')
      .populate('senderId', '_id displayName')
      .lean();

    const linkRows = await Message.find({
      chatId: chat._id,
      isDeleted: { $ne: true },
      type: 'text',
      content: { $regex: 'https?://' },
    })
      .sort({ sentAt: -1 })
      .limit(100)
      .select('_id content sentAt senderId')
      .lean();

    const links = linkRows
      .flatMap((row) => {
        const urls = String(row.content || '').match(/https?:\/\/[^\s<>"']+/gi) || [];
        return urls.map((url) => ({
          messageId: String(row._id),
          url,
          at: row.sentAt,
        }));
      })
      .slice(0, 60);

    return res.json({
      chatId: String(chat._id),
      media: media.map((row) => ({
        messageId: String(row._id),
        type: row.type,
        url: row.mediaUrl,
        name: row.content || '',
        at: row.sentAt,
        sender: row.senderId ? { id: String(row.senderId._id), displayName: row.senderId.displayName } : null,
      })),
      links,
    });
  } catch (error) {
    console.error('Get chat media error:', error);
    return res.status(500).json({ message: 'Could not load shared media' });
  }
};

/* ------------------------------------------------------------- group photo */

// @desc    Upload/replace the group photo
// @route   POST /api/chats/:id/avatar
// @access  Private (per group settings: anyone or admins)
const updateGroupAvatar = async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.id);
    if (!chat) return res.status(404).json({ message: 'Chat not found' });
    if (chat.type !== 'group') return res.status(400).json({ message: 'Only groups have a photo' });
    if (!groupSystem.canEditInfo(chat, req.user._id)) {
      return res.status(403).json({
        message: 'Only group admins can change the group photo.',
        code: 'GROUP_EDIT_FORBIDDEN',
      });
    }
    if (!req.file) return res.status(400).json({ message: 'No image uploaded' });
    if (!String(req.file.mimetype || '').startsWith('image/')) {
      return res.status(415).json({ message: 'Choose an image file (jpg, png, webp or gif).' });
    }

    const stored = await storage.persistUpload(req, 'groups');
    chat.groupAvatar = stored.url;
    await chat.save();

    const me = await User.findById(req.user._id).select('displayName');
    await groupSystem.postSystemMessage(chat, `${me?.displayName || 'A member'} changed the group photo`);
    const populated = await groupSystem.broadcastChatUpdate(chat._id);
    groupSystem.broadcastMemberList(chat._id);

    return res.json({ message: 'Group photo updated', url: stored.url, chat: populated });
  } catch (error) {
    console.error('Update group avatar error:', error);
    return res.status(500).json({ message: 'Server error updating the group photo' });
  }
};

module.exports = {
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
  requestToJoin,
  getJoinRequests,
  respondJoinRequest,
  pinMessage,
  unpinMessage,
  getChatMedia,
  MAX_GROUP_MEMBERS,
};
