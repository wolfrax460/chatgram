// Socket.IO event handling.
//
// Rewritten from the original inline handler in server.js. Key fixes:
//  * sockets join a personal `user:<id>` room, so delivered/read receipts
//    actually reach the sender (the old code emitted to a room nobody joined)
//  * chat rooms are (re)joined on connect and whenever a new chat is created
//  * presence tracks every socket of a user, and disconnect now emits
//    `presence:offline` and persists it (previously users stayed "online" forever)
//  * `message:send` echoes a client-generated `clientId` so the Flutter client
//    can replace its optimistic bubble instead of showing a duplicate
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const realtime = require('../utils/realtime');

const JWT_SECRET = () => process.env.JWT_SECRET || 'your-secret-key';

async function resolveUserFromToken(token) {
  if (!token) return null;
  const decoded = jwt.verify(token, JWT_SECRET());
  const user = await User.findById(decoded.userId);
  return user || null;
}

function publicUser(user) {
  return {
    _id: user._id,
    id: user._id,
    phone: user.phone,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    about: user.about,
    isOnline: true,
  };
}

async function attachUser(socket, user) {
  socket.userId = user._id.toString();
  socket.user = user;

  socket.join(realtime.roomForUser(socket.userId));
  realtime.trackSocket(socket.userId, socket.id);

  const userChats = await Chat.find({ participants: user._id }).select('_id');
  for (const chat of userChats) {
    socket.join(realtime.roomForChat(chat._id));
  }

  await User.findByIdAndUpdate(user._id, { isOnline: true, lastSeen: new Date() });

  socket.emit('authenticated', { success: true, user: publicUser(user) });
  socket.broadcast.emit('presence:online', { userId: socket.userId });
}

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('Socket connected:', socket.id);
    }

    // Preferred path: token supplied in the Socket.IO handshake (`auth.token`),
    // so the connection is authorised before any event is handled.
    const handshakeToken =
      socket.handshake?.auth?.token || socket.handshake?.query?.token;
    if (handshakeToken) {
      resolveUserFromToken(handshakeToken)
        .then((user) => {
          if (user) return attachUser(socket, user);
          socket.emit('auth_error', { message: 'Invalid token' });
          return null;
        })
        .catch(() => socket.emit('auth_error', { message: 'Invalid token' }));
    }

    // Backwards-compatible explicit authenticate event.
    socket.on('authenticate', async (token) => {
      try {
        const user = await resolveUserFromToken(token);
        if (!user) {
          socket.emit('auth_error', { message: 'Invalid token' });
          return;
        }
        await attachUser(socket, user);
      } catch (error) {
        console.error('Socket auth error:', error.message);
        socket.emit('auth_error', { message: 'Invalid token' });
      }
    });

    socket.on('chat:join', (data = {}) => {
      const { chatId } = data;
      if (chatId && socket.userId) socket.join(realtime.roomForChat(chatId));
    });

    socket.on('chat:leave', (data = {}) => {
      const { chatId } = data;
      if (chatId && socket.userId) socket.leave(realtime.roomForChat(chatId));
    });

    // ------------------------------------------------------------- messages
    socket.on('message:send', async (data = {}) => {
      try {
        if (!socket.userId) {
          socket.emit('message:error', { message: 'Not authenticated' });
          return;
        }

        const { chatId, type = 'text', content, mediaUrl, clientId } = data;

        if (!chatId) {
          socket.emit('message:error', { message: 'Invalid message data', clientId });
          return;
        }

        const allowedTypes = ['text', 'image', 'video', 'audio', 'file'];
        if (!allowedTypes.includes(type)) {
          socket.emit('message:error', { message: 'Invalid message type', clientId });
          return;
        }

        const chat = await Chat.findById(chatId);
        if (!chat) {
          socket.emit('message:error', { message: 'Chat not found', clientId });
          return;
        }

        const isParticipant = chat.participants.some((p) => p.equals(socket.userId));
        if (!isParticipant) {
          socket.emit('message:error', {
            message: 'Not authorized to send message in this chat',
            clientId,
          });
          return;
        }

        if (type === 'text' && (!content || String(content).trim() === '')) {
          socket.emit('message:error', { message: 'Text message must have content', clientId });
          return;
        }

        const message = await Message.create({
          chatId,
          senderId: socket.userId,
          type,
          content: type === 'text' ? String(content).trim() : content || null,
          mediaUrl: type === 'text' ? null : mediaUrl || null,
          sentAt: new Date(),
          // The sender implicitly has the message.
          deliveredTo: [socket.userId],
          readBy: [socket.userId],
        });

        await Chat.findByIdAndUpdate(chatId, {
          lastMessage: message._id,
          updatedAt: new Date(),
        });

        const populated = await Message.findById(message._id).populate(
          'senderId',
          '_id displayName avatarUrl phone'
        );

        // Guarantee the sender's own devices are in the room even if the chat
        // was created after they connected.
        realtime.joinUsersToChat(chatId, chat.participants.map((p) => p.toString()));

        const payload = { ...populated.toObject(), clientId: clientId || null };
        io.to(realtime.roomForChat(chatId)).emit('message:new', payload);
      } catch (error) {
        console.error('Message send error:', error);
        socket.emit('message:error', {
          message: 'Server error sending message',
          clientId: data && data.clientId,
        });
      }
    });

    /** Mark one message (messageId) or a whole chat (chatId) as delivered. */
    socket.on('message:delivered', async (data = {}) => {
      try {
        if (!socket.userId) return;
        await applyReceipt(socket, data, 'deliveredTo', 'message:delivered');
      } catch (error) {
        console.error('Mark as delivered error:', error);
        socket.emit('message:error', { message: 'Server error marking message as delivered' });
      }
    });

    /** Mark one message (messageId) or a whole chat (chatId) as read. */
    socket.on('message:read', async (data = {}) => {
      try {
        if (!socket.userId) return;
        await applyReceipt(socket, data, 'readBy', 'message:read');
      } catch (error) {
        console.error('Mark as read error:', error);
        socket.emit('message:error', { message: 'Server error marking message as read' });
      }
    });

    // --------------------------------------------------------------- typing
    socket.on('typing:start', (data = {}) => {
      const { chatId } = data;
      if (chatId && socket.userId) {
        socket.to(realtime.roomForChat(chatId)).emit('typing:start', {
          chatId,
          userId: socket.userId,
        });
      }
    });

    socket.on('typing:stop', (data = {}) => {
      const { chatId } = data;
      if (chatId && socket.userId) {
        socket.to(realtime.roomForChat(chatId)).emit('typing:stop', {
          chatId,
          userId: socket.userId,
        });
      }
    });

    // ------------------------------------------------------------ disconnect
    socket.on('disconnect', async () => {
      if (process.env.NODE_ENV !== 'production') {
        console.log('Socket disconnected:', socket.id);
      }
      if (!socket.userId) return;

      const wentOffline = realtime.untrackSocket(socket.userId, socket.id);
      if (!wentOffline) return; // user still has another device connected

      const lastSeen = new Date();
      try {
        await User.findByIdAndUpdate(socket.userId, { isOnline: false, lastSeen });
      } catch (error) {
        console.error('Failed to persist offline state:', error.message);
      }
      io.emit('presence:offline', { userId: socket.userId, lastSeen });
    });
  });
}

/**
 * Shared implementation for delivered/read receipts.
 * Accepts { messageId } for a single message or { chatId } to advance every
 * message in that chat that the user did not send.
 */
async function applyReceipt(socket, data, field, event) {
  const { messageId, chatId } = data;

  if (!messageId && !chatId) {
    socket.emit('message:error', { message: 'messageId or chatId is required' });
    return;
  }

  const query = messageId
    ? { _id: messageId }
    : { chatId, senderId: { $ne: socket.userId } };

  const messages = await Message.find(query).select('_id chatId senderId ' + field);
  if (!messages.length) return;

  // Authorise: the user must belong to every chat involved.
  const chatIds = [...new Set(messages.map((m) => m.chatId.toString()))];
  const chats = await Chat.find({ _id: { $in: chatIds } });
  const allowed = new Set(
    chats
      .filter((c) => c.participants.some((p) => p.equals(socket.userId)))
      .map((c) => c._id.toString())
  );

  const affected = messages.filter(
    (m) => allowed.has(m.chatId.toString()) && !m[field].some((u) => u.equals(socket.userId))
  );
  if (!affected.length) {
    if (messageId) socket.emit(event, { messageId, chatId: data.chatId || null });
    return;
  }

  await Message.updateMany(
    { _id: { $in: affected.map((m) => m._id) } },
    { $addToSet: { [field]: socket.userId } }
  );

  for (const message of affected) {
    const payload = {
      messageId: message._id,
      chatId: message.chatId,
      userId: socket.userId,
    };
    realtime.emitToUser(message.senderId, event, payload);
    realtime.emitToChat(message.chatId, event, payload);
  }
}

module.exports = { registerSocketHandlers, publicUser };
