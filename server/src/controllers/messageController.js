// Message controller
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const User = require('../models/User');
const mongoose = require('mongoose');
const realtime = require('../utils/realtime');
const { blockedBetween } = require('../utils/blocks');
const groupSystem = require('../utils/groupSystem');

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

    // Blocking: if either side blocked the other, a direct message is refused.
    if (chat.type === 'direct') {
      const other = chat.participants.find((id) => String(id) !== String(req.user._id));
      if (other && (await blockedBetween(req.user._id, other))) {
        return res.status(403).json({
          message: 'You cannot message this person.',
          code: 'BLOCKED',
        });
      }
    }

    // A frozen group is read-only for everyone until an admin unfreezes it.
    if (chat.type === 'group' && chat.groupFrozen) {
      return res.status(403).json({
        message: 'This group is read-only while an administrator reviews it.',
        code: 'GROUP_FROZEN',
      });
    }

    // Group setting: "only admins can send messages".
    if (!groupSystem.canSendMessages(chat, req.user._id)) {
      return res.status(403).json({
        message: 'Only group admins can send messages in this group.',
        code: 'GROUP_SEND_FORBIDDEN',
      });
    }

    // @mentions (groups only): find who was mentioned so they can be notified.
    const mentioned =
      chat.type === 'group' && type === 'text'
        ? await groupSystem.mentionedUserIds(content, chat.participants, req.user._id)
        : [];

    const message = await Message.create({
      chatId,
      senderId: req.user._id,
      type,
      content: type === 'text' ? String(content).trim() : content || null,
      mediaUrl: type === 'text' ? null : mediaUrl,
      sentAt: new Date(),
      deliveredTo: [req.user._id],
      readBy: [req.user._id],
      mentionUserIds: mentioned,
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
    // If this is the Support account replying on a ticket, mirror it to the
    // guest's ticket room (additive; failures are swallowed).
    // If this is a user writing to the Chatgram Support account, let the
    // assistant answer (or escalate to the owner).
    require('../support/supportAgentReply')
      .answerSupportChat(message, realtime.getIo())
      .catch(() => {});

    // 9e (e): no support reply within 60 s -> an admin Inbox record.
    const watchdog = require('../support/supportWatchdog');
    watchdog
      .isSupportThreadMessage(chat, populated)
      .then((isSupportThread) => {
        if (isSupportThread) watchdog.watchSupportMessage(chat, populated);
      })
      .catch(() => {});

    require('../support/replyHook')
      .propagateSupportReply(message, realtime.getIo())
      .catch(() => {});

    realtime.emitToChat(chatId, 'message:new', {
      ...populated.toObject(),
      clientId: clientId || null,
    });

    // @mention notifications (group only, best effort).
    if (mentioned.length > 0) {
      try {
        groupSystem.emitMentions(populated, chat, mentioned);
      } catch (mentionError) {
        console.warn('Mention notification failed:', mentionError.message);
      }
    }

    // Group "@Chatgram AI" mentions: off by default, rate limited, silent on error.
    require('../ai/groupMentions')
      .maybeAnswer({ chat, message: populated, io: realtime.getIo() })
      .catch(() => {});

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

    // Hide messages deleted for everyone, and those this user deleted for
    // themselves. Additive fields: older documents have no such values.
    const query = { chatId, isDeleted: { $ne: true }, deletedFor: { $ne: req.user._id } };
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

    // Convenience flag for the client: has the signed-in user starred it?
    const me = String(req.user._id);
    const shaped = messages.map((message) => {
      const json = message.toObject();
      json.starred = (message.starredBy || []).some((id) => String(id) === me);
      return json;
    });

    res.json({
      messages: shaped,
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

    // Read-receipt privacy: with receipts off, delivery is still recorded but no
    // `message:read` is published, so the sender never sees the blue ticks.
    const reader = await User.findById(req.user._id).select('readReceipts');
    const publishReceipts = reader?.readReceipts !== false;

    await Message.updateMany(
      { _id: id, readBy: { $ne: req.user._id } },
      publishReceipts
        ? { $addToSet: { readBy: req.user._id, deliveredTo: req.user._id } }
        : { $addToSet: { deliveredTo: req.user._id } }
    );

    if (publishReceipts) {
      const payload = { messageId: message._id, chatId: message.chatId, userId: req.user._id };
      realtime.emitToUser(message.senderId, 'message:read', payload);
      realtime.emitToChat(message.chatId, 'message:read', payload);
    }

    res.json({ message: 'Marked as read', readReceipts: publishReceipts });
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

    const reader = await User.findById(req.user._id).select('readReceipts');
    const publishReceipts = reader?.readReceipts !== false;

    const result = await Message.updateMany(
      { chatId, senderId: { $ne: req.user._id }, readBy: { $ne: req.user._id } },
      publishReceipts
        ? { $addToSet: { readBy: req.user._id, deliveredTo: req.user._id } }
        : { $addToSet: { deliveredTo: req.user._id } }
    );

    if (publishReceipts) {
      realtime.emitToChat(chatId, 'message:read', {
        chatId,
        userId: req.user._id,
        all: true,
      });
    }

    res.json({ message: 'Chat marked as read', modified: result.modifiedCount, readReceipts: publishReceipts });
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
    // Derive the storage subfolder from the file itself. (This previously
    // called require('../utils/upload').resolveSubdir, which does not exist,
    // so every upload threw and surfaced as "Server error uploading file".)
    const mimetype = String(req.file.mimetype || '');
    const subdir = mimetype.startsWith('image/')
      ? 'images'
      : mimetype.startsWith('video/')
        ? 'videos'
        : mimetype.startsWith('audio/')
          ? 'audio'
          : 'files';
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

// @desc    Delete a message for me, or for everyone if I am the sender
// @route   DELETE /api/messages/:id?scope=me|everyone
// @access  Private
const deleteMessage = async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ message: 'Message not found' });

    const { chat, error } = await assertParticipant(message.chatId, req.user._id);
    if (error) return res.status(error.status).json({ message: error.message });
    if (!chat) return res.status(404).json({ message: 'Chat not found' });

    const scope = req.query.scope === 'everyone' ? 'everyone' : 'me';

    if (scope === 'everyone') {
      if (message.senderId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Only the sender can delete for everyone' });
      }
      message.isDeleted = true;
      message.content = '';
      message.mediaUrl = null;
      await message.save();

      require('../utils/realtime')
        .getIo()
        ?.to(require('../utils/realtime').roomForChat(chat._id))
        .emit('message:deleted', { messageId: message._id.toString(), chatId: chat._id.toString(), scope });
    } else {
      if (!message.deletedFor.some((id) => id.toString() === req.user._id.toString())) {
        message.deletedFor.push(req.user._id);
        await message.save();
      }
    }

    return res.json({ message: 'Deleted', messageId: message._id, scope });
  } catch (error) {
    console.error('Delete message error:', error);
    return res.status(500).json({ message: 'Server error deleting message' });
  }
};

// @desc    Toggle an emoji reaction
// @route   POST /api/messages/:id/reactions
// @access  Private
const reactToMessage = async (req, res) => {
  try {
    const emoji = String(req.body.emoji || '').trim();
    if (!emoji || emoji.length > 8) {
      return res.status(400).json({ message: 'A single emoji is required' });
    }

    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ message: 'Message not found' });

    const { chat, error } = await assertParticipant(message.chatId, req.user._id);
    if (error) return res.status(error.status).json({ message: error.message });
    if (!chat) return res.status(404).json({ message: 'Chat not found' });

    const mine = message.reactions.find((r) => r.userId.toString() === req.user._id.toString());
    if (mine && mine.emoji === emoji) {
      // Same emoji again toggles it off.
      message.reactions = message.reactions.filter(
        (r) => r.userId.toString() !== req.user._id.toString()
      );
    } else if (mine) {
      mine.emoji = emoji; // one reaction per user
    } else {
      message.reactions.push({ userId: req.user._id, emoji });
    }

    await message.save();

    const payload = {
      messageId: message._id.toString(),
      chatId: chat._id.toString(),
      reactions: message.reactions.map((r) => ({
        userId: r.userId.toString(),
        emoji: r.emoji,
      })),
    };

    require('../utils/realtime')
      .getIo()
      ?.to(require('../utils/realtime').roomForChat(chat._id))
      .emit('message:reaction', payload);

    return res.json(payload);
  } catch (error) {
    console.error('React to message error:', error);
    return res.status(500).json({ message: 'Server error reacting to message' });
  }
};

// @desc    Clear every message in a chat (for me)
// @route   DELETE /api/chats/:id/messages
// @access  Private
const clearChatMessages = async (req, res) => {
  try {
    const { chat, error } = await assertParticipant(req.params.id, req.user._id);
    if (error) return res.status(error.status).json({ message: error.message });
    if (!chat) return res.status(404).json({ message: 'Chat not found' });

    // Per-user clear: hide everything that exists right now for this user only,
    // so the other participant keeps their history.
    const result = await Message.updateMany(
      { chatId: chat._id, deletedFor: { $ne: req.user._id } },
      { $push: { deletedFor: req.user._id } }
    );

    return res.json({ message: 'Chat cleared', cleared: result.modifiedCount || 0 });
  } catch (error) {
    console.error('Clear chat error:', error);
    return res.status(500).json({ message: 'Server error clearing chat' });
  }
};

/* ----------------------------------------------------- seen-by (readers) */

// @desc    Who has seen a message (only the sender may ask)
// @route   GET /api/messages/:id/readers
// @access  Private (message sender)
const getMessageReaders = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid message ID' });
    }
    const message = await Message.findById(id).populate(
      'readBy',
      '_id displayName avatarUrl readReceipts',
    );
    if (!message) return res.status(404).json({ message: 'Message not found' });

    const { error } = await assertParticipant(message.chatId, req.user._id);
    if (error) return res.status(error.status).json({ message: error.message });
    if (String(message.senderId) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only the sender can see who read a message' });
    }

    const readers = (message.readBy || [])
      .filter((user) => user && user.readReceipts !== false)
      .filter((user) => String(user._id) !== String(req.user._id))
      .map((user) => ({
        id: String(user._id),
        displayName: user.displayName,
        avatarUrl: user.avatarUrl || '',
      }));

    return res.json({ messageId: String(message._id), readers, count: readers.length });
  } catch (error) {
    console.error('Get message readers error:', error);
    return res.status(500).json({ message: 'Could not load the reader list' });
  }
};

/* ------------------------------------------------- edit / star / forward / report */

// @desc    Edit the text of your own message
// @route   PATCH /api/messages/:id
// @access  Private (sender only)
const editMessage = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid message ID' });
    const content = String(req.body?.content ?? '').trim();
    if (!content) return res.status(400).json({ message: 'The message cannot be empty.' });
    if (content.length > 4000) return res.status(400).json({ message: 'That message is too long (max 4000 characters).' });

    const message = await Message.findById(id);
    if (!message) return res.status(404).json({ message: 'Message not found' });
    const { error } = await assertParticipant(message.chatId, req.user._id);
    if (error) return res.status(error.status).json({ message: error.message });
    if (String(message.senderId) !== String(req.user._id)) {
      return res.status(403).json({ message: 'You can only edit your own messages.', code: 'NOT_SENDER' });
    }
    if (message.isDeleted) return res.status(400).json({ message: 'That message was deleted.' });
    if (message.type !== 'text') {
      return res.status(400).json({ message: 'Only text messages can be edited.' });
    }

    message.content = content;
    message.editedAt = new Date();
    await message.save();

    const payload = {
      messageId: String(message._id),
      chatId: String(message.chatId),
      content,
      editedAt: message.editedAt,
    };
    realtime.emitToChat(message.chatId, 'message:edited', payload);
    return res.json({ message: 'Message updated', ...payload });
  } catch (error) {
    console.error('Edit message error:', error);
    return res.status(500).json({ message: 'Could not edit the message' });
  }
};

// @desc    Star / unstar a message for me
// @route   POST/DELETE /api/messages/:id/star
// @access  Private (participant)
const starMessage = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid message ID' });
    const message = await Message.findById(id);
    if (!message) return res.status(404).json({ message: 'Message not found' });
    const { error } = await assertParticipant(message.chatId, req.user._id);
    if (error) return res.status(error.status).json({ message: error.message });

    const starred = req.method === 'DELETE' ? false : true;
    if (starred) message.starredBy.addToSet(req.user._id);
    else message.starredBy.pull(req.user._id);
    await message.save();

    return res.json({ messageId: String(message._id), starred });
  } catch (error) {
    console.error('Star message error:', error);
    return res.status(500).json({ message: 'Could not update the star' });
  }
};

// @desc    Forward a message to another chat I belong to
// @route   POST /api/messages/:id/forward
// @access  Private (participant of both chats)
const forwardMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const targetChatId = req.body?.chatId;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(targetChatId)) {
      return res.status(400).json({ message: 'Invalid message or chat ID' });
    }
    const source = await Message.findById(id);
    if (!source || source.isDeleted) return res.status(404).json({ message: 'Message not found' });
    const sourceAccess = await assertParticipant(source.chatId, req.user._id);
    if (sourceAccess.error) return res.status(sourceAccess.error.status).json({ message: sourceAccess.error.message });

    const targetAccess = await assertParticipant(targetChatId, req.user._id);
    if (targetAccess.error) return res.status(targetAccess.error.status).json({ message: targetAccess.error.message });
    const targetChat = targetAccess.chat;

    if (!groupSystem.canSendMessages(targetChat, req.user._id)) {
      return res.status(403).json({ message: 'Only group admins can send messages in that group.', code: 'GROUP_SEND_FORBIDDEN' });
    }
    if (targetChat.type === 'direct') {
      const other = targetChat.participants.find((participantId) => String(participantId) !== String(req.user._id));
      if (other && (await blockedBetween(req.user._id, other))) {
        return res.status(403).json({ message: 'You cannot message this person.', code: 'BLOCKED' });
      }
    }

    const forwarded = await Message.create({
      chatId: targetChatId,
      senderId: req.user._id,
      type: source.type === 'system' ? 'text' : source.type,
      content: source.content || '',
      mediaUrl: source.mediaUrl || null,
      sentAt: new Date(),
      deliveredTo: [req.user._id],
      readBy: [req.user._id],
    });
    await Chat.findByIdAndUpdate(targetChatId, { lastMessage: forwarded._id, updatedAt: new Date() });
    const populated = await Message.findById(forwarded._id).populate('senderId', '_id displayName avatarUrl phone');
    realtime.joinUsersToChat(targetChatId, targetChat.participants.map((participantId) => String(participantId)));
    realtime.emitToChat(targetChatId, 'message:new', populated.toObject());
    return res.status(201).json(populated);
  } catch (error) {
    console.error('Forward message error:', error);
    return res.status(500).json({ message: 'Could not forward the message' });
  }
};

// @desc    Report a message to the moderation team
// @route   POST /api/messages/:id/report
// @access  Private (participant)
const reportMessage = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid message ID' });
    const message = await Message.findById(id).populate('senderId', '_id displayName');
    if (!message) return res.status(404).json({ message: 'Message not found' });
    const { error } = await assertParticipant(message.chatId, req.user._id);
    if (error) return res.status(error.status).json({ message: error.message });
    if (String(message.senderId?._id || message.senderId) === String(req.user._id)) {
      return res.status(400).json({ message: 'You cannot report your own message.' });
    }

    const Report = require('../models/Report');
    const allowed = ['spam', 'abuse', 'harassment', 'impersonation', 'scam', 'other'];
    const body = req.body || {};
    const reason = allowed.includes(body.reason) ? body.reason : 'other';
    const report = await Report.create({
      reporterId: req.user._id,
      targetUserId: message.senderId?._id || message.senderId,
      targetMessageId: message._id,
      chatId: message.chatId,
      reason,
      details: String(body.details || '').slice(0, 2000),
      messageSnapshot: String(message.content || '').slice(0, 4000),
    });
    try {
      require('../support/notifier')
        .notifyAlert?.(`🚩 Message report\n\nReporter: ${req.user.displayName} (${req.user._id})\nReason: ${reason}\nMessage: ${String(message.content || '').slice(0, 300)}`)
        .catch(() => {});
    } catch {
      /* best effort */
    }
    return res.status(201).json({ message: 'Report received. Thank you — our team will review it.', reportId: String(report._id), reason });
  } catch (error) {
    console.error('Report message error:', error);
    return res.status(500).json({ message: 'Could not send the report' });
  }
};

module.exports = {
  sendMessage,
  getMessages,
  markAsDelivered,
  markAsRead,
  markChatAsRead,
  uploadMedia,
  deleteMessage,
  reactToMessage,
  clearChatMessages,
  getMessageReaders,
  editMessage,
  starMessage,
  forwardMessage,
  reportMessage,
};
