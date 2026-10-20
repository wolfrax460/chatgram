// Message controller
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const mongoose = require('mongoose');
const realtime = require('../utils/realtime');

const MESSAGE_TYPES = ['text', 'image', 'video', 'audio', 'file'];

async function assertParticipant(chatId, userId) {
  const chat = await Chat.findById(chatId);
  if (!chat) return { error: { status: 404, message: 'Chat not found' } };
  const isParticipant = chat.participants.some((p) => p.equals(userId));
  if (!isParticipant) {
    return { error: { status: 403, message: 'Not authorized to access this chat' } };
  }
  return { chat };
}

// @desc    Send a message over REST (mirrors the socket `message:send` path
//          and also broadcasts in real time, which the old version did not).
// @route   POST /api/messages
// @access  Private
const sendMessage = async (req, res) => {
  try {
    const { chatId, type = 'text', content, mediaUrl, clientId } = req.body;

    if (!chatId) {
      return res.status(400).json({ message: 'Chat ID is required' });
    }
    if (!MESSAGE_TYPES.includes(type)) {
      return res.status(400).json({ message: 'Invalid message type' });
    }

    const { chat, error } = await assertParticipant(chatId, req.user._id);
    if (error) return res.status(error.status).json({ message: error.message });

    if (type === 'text' && (!content || String(content).trim() === '')) {
      return res.status(400).json({ message: 'Text message must have content' });
    }
    if (type !== 'text' && !mediaUrl) {
      return res.status(400).json({ message: `${type} message must have a mediaUrl` });
    }

    const message = await Message.create({
      chatId,
      senderId: req.user._id,
      type,
      content: type === 'text' ? String(content).trim() : content || null,
      mediaUrl: type === 'text' ? null : mediaUrl,
      sentAt: new Date(),
      deliveredTo: [req.user._id],
      readBy: [req.user._id],
    });

    await Chat.findByIdAndUpdate(chatId, {
      lastMessage: message._id,
      updatedAt: new Date(),
    });

    const populated = await Message.findById(message._id).populate(
      'senderId',
      '_id displayName avatarUrl phone'
    );

    realtime.joinUsersToChat(chatId, chat.participants.map((p) => p.toString()));
    realtime.emitToChat(chatId, 'message:new', {
      ...populated.toObject(),
      clientId: clientId || null,
    });

    res.status(201).json(populated);
  } catch (error) {
    console.error('Send message error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Invalid input data' });
    }
    res.status(500).json({ message: 'Server error sending message' });
  }
};

// @desc    Get messages for a chat
// @route   GET /api/messages?chatId=&limit=&before=
// @access  Private
//
// Returns the NEWEST `limit` messages, ordered oldest-first so the UI can
// render top-to-bottom. The previous implementation chained `.sort()` twice,
// so the second `.sort({ _id: 1 })` replaced the first and pagination handed
// back the OLDEST messages in the chat.
const getMessages = async (req, res) => {
  try {
    const { chatId, before } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

    if (!chatId) {
      return res.status(400).json({ message: 'Chat ID is required' });
    }
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({ message: 'Invalid chat ID' });
    }

    const { error } = await assertParticipant(chatId, req.user._id);
    if (error) return res.status(error.status).json({ message: error.message });

    const query = { chatId };
    if (before) {
      if (!mongoose.Types.ObjectId.isValid(before)) {
        return res.status(400).json({ message: 'Invalid `before` cursor' });
      }
      query._id = { $lt: before };
    }

    // Fetch the newest page first...
    const messages = await Message.find(query)
      .sort({ _id: -1 })
      .limit(limit)
      .populate('senderId', '_id displayName avatarUrl phone');

    // ...then flip it so the response is chronological.
    messages.reverse();

    res.json({
      messages,
      hasMore: messages.length === limit,
      // Cursor for "load older messages".
      nextCursor: messages.length ? messages[0]._id : null,
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ message: 'Server error fetching messages' });
  }
};

// @desc    Mark a message (or a whole chat) as delivered
// @route   POST /api/messages/:id/delivered
// @access  Private
const markAsDelivered = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid message ID' });
    }

    const message = await Message.findById(id);
    if (!message) return res.status(404).json({ message: 'Message not found' });

    const { error } = await assertParticipant(message.chatId, req.user._id);
    if (error) return res.status(error.status).json({ message: error.message });

    await Message.updateMany(
      { _id: id, deliveredTo: { $ne: req.user._id } },
      { $addToSet: { deliveredTo: req.user._id } }
    );

    const payload = { messageId: message._id, chatId: message.chatId, userId: req.user._id };
    realtime.emitToUser(message.senderId, 'message:delivered', payload);
    realtime.emitToChat(message.chatId, 'message:delivered', payload);

    res.json({ message: 'Marked as delivered' });
  } catch (error) {
    console.error('Mark as delivered error:', error);
    res.status(500).json({ message: 'Server error marking message as delivered' });
  }
};

// @desc    Mark a message (or a whole chat) as read
// @route   POST /api/messages/:id/read
// @access  Private
const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid message ID' });
    }

    const message = await Message.findById(id);
    if (!message) return res.status(404).json({ message: 'Message not found' });

    const { error } = await assertParticipant(message.chatId, req.user._id);
    if (error) return res.status(error.status).json({ message: error.message });

    await Message.updateMany(
      { _id: id, readBy: { $ne: req.user._id } },
      { $addToSet: { readBy: req.user._id } }
    );

    const payload = { messageId: message._id, chatId: message.chatId, userId: req.user._id };
    realtime.emitToUser(message.senderId, 'message:read', payload);
    realtime.emitToChat(message.chatId, 'message:read', payload);

    res.json({ message: 'Marked as read' });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ message: 'Server error marking message as read' });
  }
};

// @desc    Mark every unread message in a chat as read
// @route   POST /api/messages/chat/:chatId/read
// @access  Private
const markChatAsRead = async (req, res) => {
  try {
    const { chatId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({ message: 'Invalid chat ID' });
    }

    const { error } = await assertParticipant(chatId, req.user._id);
    if (error) return res.status(error.status).json({ message: error.message });

    const result = await Message.updateMany(
      { chatId, senderId: { $ne: req.user._id }, readBy: { $ne: req.user._id } },
      { $addToSet: { readBy: req.user._id, deliveredTo: req.user._id } }
    );

    realtime.emitToChat(chatId, 'message:read', {
      chatId,
      userId: req.user._id,
      all: true,
    });

    res.json({ message: 'Chat marked as read', modified: result.modifiedCount });
  } catch (error) {
    console.error('Mark chat as read error:', error);
    res.status(500).json({ message: 'Server error marking chat as read' });
  }
};

// @desc    Upload media file
// @route   POST /api/messages/media
// @access  Private
const uploadMedia = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Cloudinary when configured, local disk otherwise. The returned URL is
    // absolute for Cloudinary and a server-relative /uploads/… path for disk,
    // and the Flutter client already handles both.
    const subdir = require('../utils/upload').resolveSubdir(req);
    const stored = await require('../utils/storage').persistUpload(req, subdir);

    res.status(201).json({
      message: 'File uploaded successfully',
      file: {
        filename: req.file.filename || stored.publicId || req.file.originalname,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: stored.bytes != null ? stored.bytes : req.file.size,
        url: stored.url,
        provider: stored.provider,
      },
    });
  } catch (error) {
    console.error('Upload media error:', error);
    res.status(500).json({ message: 'Server error uploading file' });
  }
};

module.exports = {
  sendMessage,
  getMessages,
  markAsDelivered,
  markAsRead,
  markChatAsRead,
  uploadMedia,
};
