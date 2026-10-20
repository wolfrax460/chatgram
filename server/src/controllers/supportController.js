// Help & feedback routing.
//
// Every signed-in user can open a direct conversation with the built-in support
// account without adding it as a contact first. The chat is created on first
// use and then reused, so the whole history stays in one thread.
const Chat = require('../models/Chat');
const User = require('../models/User');
const mongoose = require('mongoose');
const support = require('../utils/supportAccount');

const PARTICIPANT_FIELDS = '_id displayName avatarUrl about isOnline lastSeen phone email';

// @desc    Open (or create) my conversation with Chatgram Support
// @route   POST /api/support/chat
// @access  Private
const openSupportChat = async (req, res) => {
  try {
    const supportId = support.supportUserId() || (await support.ensureSupportUser());

    if (!supportId) {
      return res.status(503).json({
        message: 'The support account has not been set up on this server yet.',
        code: 'SUPPORT_NOT_CONFIGURED',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(supportId)) {
      return res.status(500).json({ message: 'Support account id is invalid' });
    }

    if (supportId === req.user._id.toString()) {
      return res
        .status(400)
        .json({ message: 'This is the support account — open any other conversation.' });
    }

    // Reuse the existing thread if there is one.
    const existing = await Chat.findOne({
      type: 'direct',
      participants: { $all: [req.user._id, supportId], $size: 2 },
    }).populate('participants', PARTICIPANT_FIELDS);

    if (existing) {
      return res.json(existing);
    }

    const chat = await Chat.create({
      type: 'direct',
      participants: [req.user._id, supportId],
    });

    const populated = await Chat.findById(chat._id).populate(
      'participants',
      PARTICIPANT_FIELDS
    );

    // Let realtime rooms know about the new conversation.
    const realtime = require('../utils/realtime');
    realtime.joinUsersToChat(
      chat._id,
      populated.participants.map((p) => p._id.toString())
    );
    for (const participant of populated.participants) {
      realtime.emitToUser(participant._id, 'chat:new', populated);
    }

    return res.status(201).json(populated);
  } catch (error) {
    console.error('Open support chat error:', error);
    return res.status(500).json({ message: 'Server error opening the support conversation' });
  }
};

// @desc    Is a support account configured, and what is it called?
// @route   GET /api/support
// @access  Private
const supportInfo = async (req, res) => {
  try {
    await support.ensureSupportUser();
    res.json(support.supportProfile());
  } catch (error) {
    console.error('Support info error:', error);
    res.status(500).json({ message: 'Server error reading support configuration' });
  }
};

module.exports = { openSupportChat, supportInfo };
