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
const mongoose = require('mongoose');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const realtime = require('../utils/realtime');
const callRegistry = require('../utils/callRegistry');
const { blockedBetween } = require('../utils/blocks');
const groupSystem = require('../utils/groupSystem');

const JWT_SECRET = () => process.env.JWT_SECRET || 'your-secret-key';

async function resolveUserFromToken(token) {
  if (!token) return null;
  const decoded = jwt.verify(token, JWT_SECRET());
  const user = await User.findById(decoded.userId);
  if (!user) return null;
  // Session generation: a password change / reset / "log out other devices"
  // invalidates older tokens, including sockets opened with them.
  if ((Number(decoded.tv) || 0) !== (Number(user.tokenVersion) || 0)) return null;
  return user;
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
  // Presence sweeper: drop sockets whose heartbeat expired. Disconnecting the
  // socket runs the normal disconnect handler, which updates lastSeen and
  // broadcasts presence:offline when it was the user's last connection.
  const presenceSweepMs = Number(process.env.PRESENCE_SWEEP_MS || 15_000);
  const presenceSweeper = setInterval(() => {
    for (const { socketId, userId } of realtime.staleSocketIds()) {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) {
        realtime.untrackSocket(userId, socketId);
        continue;
      }
      console.warn(`Presence: dropping stale socket ${socketId} (user ${userId})`);
      socket.disconnect(true);
    }
  }, presenceSweepMs);
  if (typeof presenceSweeper.unref === 'function') presenceSweeper.unref();
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

    // Presence heartbeat. The client pings every ~25 s; a socket that stops
    // pinging is swept below. This keeps a half-open connection (killed tab,
    // sleeping phone, dropped Wi-Fi) from holding a user "online" forever.
    socket.on('presence:ping', () => {
      if (!socket.userId) return;
      realtime.touchSocket(socket.id);
      if (realtime.shouldPersistSeen(socket.id)) {
        User.findByIdAndUpdate(socket.userId, { lastSeen: new Date() }).catch(() => {});
      }
      socket.emit('presence:pong', { at: Date.now() });
    });
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

        // Blocking applies to the socket path too, not just REST.
        if (chat.type === 'direct') {
          const other = chat.participants.find((p) => String(p) !== socket.userId);
          if (other && (await blockedBetween(socket.userId, other))) {
            socket.emit('message:error', {
              message: 'You cannot message this person.',
              clientId,
              code: 'BLOCKED',
            });
            return;
          }
        }

        if (type === 'text' && (!content || String(content).trim() === '')) {
          socket.emit('message:error', { message: 'Text message must have content', clientId });
          return;
        }

        // Group setting: "only admins can send messages".
        if (!groupSystem.canSendMessages(chat, socket.userId)) {
          socket.emit('message:error', {
            message: 'Only group admins can send messages in this group.',
            clientId,
            code: 'GROUP_SEND_FORBIDDEN',
          });
          return;
        }

        const mentioned =
          chat.type === 'group' && type === 'text'
            ? await groupSystem.mentionedUserIds(content, chat.participants, socket.userId)
            : [];

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

        // Guarantee the sender's own devices are in the room even if the chat
        // was created after they connected.
        realtime.joinUsersToChat(chatId, chat.participants.map((p) => p.toString()));

        const payload = { ...populated.toObject(), clientId: clientId || null };
        // Mirror a Support-account reply onto its ticket (additive, non-fatal).
      require('../support/supportAgentReply')
        .answerSupportChat(payload, io)
        .catch(() => {});

      // 9e (e): no support reply within 60 s -> an admin Inbox record.
      const watchdog = require('../support/supportWatchdog');
      watchdog
        .isSupportThreadMessage(chat, payload)
        .then((isSupportThread) => {
          if (isSupportThread) watchdog.watchSupportMessage(chat, payload);
        })
        .catch(() => {});

      require('../support/replyHook')
        .propagateSupportReply(payload, io)
        .catch(() => {});

      io.to(realtime.roomForChat(chatId)).emit('message:new', payload);

      // @mention notifications for group members.
      if (mentioned.length > 0) {
        try {
          groupSystem.emitMentions(payload, chat, mentioned);
        } catch (mentionError) {
          console.warn('Mention notification failed:', mentionError.message);
        }
      }

      // Group "@Chatgram AI" mentions: off by default, rate limited, silent on error.
      require('../ai/groupMentions')
        .maybeAnswer({ chat, message: payload, io })
        .catch(() => {});
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

    // ---------------------------------------------------------------- calls
    //
    // Multi-party WebRTC calls (voice and video, up to 20 people). The server
    // never touches media: it validates that a socket belongs to the chat and
    // the call, keeps the participant list in utils/callRegistry, and routes
    // SDP/ICE between the peers of that call only.
    const MAX_CALL_PARTICIPANTS = callRegistry.MAX_PARTICIPANTS;

    async function chatForCaller(chatId) {
      if (!socket.userId) return null;
      if (!mongoose.Types.ObjectId.isValid(String(chatId))) return null;
      return Chat.findOne({ _id: chatId, participants: socket.userId });
    }

    async function callerIdentity() {
      const me = await User.findById(socket.userId).select('displayName avatarUrl');
      return {
        id: socket.userId,
        displayName: me?.displayName || 'Chatgram user',
        avatarUrl: me?.avatarUrl || null,
      };
    }

    function callPeers(callId, exceptUserId) {
      return callRegistry
        .participants(callId)
        .map((p) => p.id)
        .filter((id) => id !== String(exceptUserId));
    }

    function relayCallEvent(event, data) {
      const call = callRegistry.get(data.callId);
      if (!call || !socket.userId) {
        socket.emit('call:error', { message: 'This call has ended.', code: 'CALL_GONE' });
        return;
      }
      if (!callRegistry.isParticipant(call.callId, socket.userId)) {
        socket.emit('call:error', { message: 'You are not in this call.', code: 'CALL_FORBIDDEN' });
        return;
      }
      const to = String(data.toUserId || '');
      // Only route to someone who is actually in the same call.
      if (!to || !callRegistry.isParticipant(call.callId, to) || to === String(socket.userId)) return;
      realtime.emitToUser(to, event, { ...data, callId: call.callId, from: { id: String(socket.userId) } });
    }

    socket.on('call:start', async (data = {}) => {
      try {
        if (!socket.userId) {
          return socket.emit('call:error', { message: 'Sign in to make calls.', code: 'CALL_UNAUTHENTICATED' });
        }
        const chat = await chatForCaller(data.chatId);
        if (!chat) {
          return socket.emit('call:error', { message: 'You cannot call this chat.', code: 'CALL_FORBIDDEN' });
        }

        const me = await callerIdentity();
        const others = chat.participants.map(String).filter((id) => id !== String(socket.userId));
        if (others.length === 0) {
          return socket.emit('call:error', { message: 'There is nobody else in this chat.', code: 'CALL_EMPTY' });
        }
        if (chat.type === 'direct' && (await blockedBetween(socket.userId, others[0]))) {
          return socket.emit('call:error', { message: 'You cannot call this person.', code: 'CALL_FORBIDDEN' });
        }

        const isGroup = chat.type === 'group';
        const title = isGroup ? chat.groupName || 'Group call' : me.displayName;
        const created = callRegistry.create({
          callId: data.callId,
          chatId: chat._id,
          video: data.video === true,
          isGroup,
          title,
          initiator: me,
          invitees: others,
        });
        if (!created.ok) {
          return socket.emit('call:error', { message: created.error, code: created.code });
        }

        // Ring everyone who is online, capped at the participant limit.
        const ringable = others
          .filter((id) => realtime.isUserOnline(id))
          .slice(0, MAX_CALL_PARTICIPANTS - 1);

        if (ringable.length === 0) {
          callRegistry.destroy(created.call.callId);
          return socket.emit('call:unavailable', {
            chatId: String(chat._id),
            callId: created.call.callId,
            isGroup,
          });
        }

        for (const userId of ringable) {
          realtime.emitToUser(userId, 'call:incoming', {
            callId: created.call.callId,
            chatId: String(chat._id),
            video: created.call.video,
            isGroup,
            title,
            participantCount: ringable.length + 1,
            from: me,
          });
        }

        socket.emit('call:ringing', {
          callId: created.call.callId,
          chatId: String(chat._id),
          video: created.call.video,
          isGroup,
          title,
          participants: callRegistry.participants(created.call.callId),
          ringCount: ringable.length,
        });
      } catch (error) {
        console.error('Call start error:', error.message);
        socket.emit('call:error', { message: 'Could not start the call.' });
      }
    });

    socket.on('call:accept', async (data = {}) => {
      try {
        if (!socket.userId) return;
        const call = callRegistry.get(data.callId);
        if (!call) {
          return socket.emit('call:ended', { callId: data.callId, reason: 'missed' });
        }
        const me = await callerIdentity();
        const joined = callRegistry.join(call.callId, me);
        if (!joined.ok) {
          return socket.emit('call:error', { message: joined.error, code: joined.code });
        }

        socket.emit('call:joined', {
          callId: call.callId,
          chatId: call.chatId,
          video: call.video,
          isGroup: call.isGroup,
          title: call.title,
          participants: joined.existing,
        });

        for (const peerId of joined.existing.map((p) => p.id)) {
          realtime.emitToUser(peerId, 'call:participant-joined', {
            callId: call.callId,
            participant: me,
          });
        }
      } catch (error) {
        console.error('Call accept error:', error.message);
      }
    });

    socket.on('call:decline', (data = {}) => {
      try {
        const call = callRegistry.get(data.callId);
        if (!call || !socket.userId) return;
        // Tell whoever rang (the initiator) so their UI shows "declined".
        const initiator = call.initiatorId;
        if (initiator && initiator !== String(socket.userId)) {
          realtime.emitToUser(initiator, 'call:participant-declined', {
            callId: call.callId,
            userId: String(socket.userId),
            isGroup: call.isGroup,
          });
        }
        // A declined 1:1 call is over. Without this the caller stays "busy"
        // and cannot place another call until they hang up manually.
        if (!call.isGroup && call.participants.size <= 1) {
          callRegistry.destroy(call.callId);
          if (initiator) {
            realtime.emitToUser(initiator, 'call:ended', { callId: call.callId, reason: 'declined' });
          }
        }
      } catch (error) {
        console.error('Call decline error:', error.message);
      }
    });

    socket.on('call:offer', (data = {}) => {
      try {
        relayCallEvent('call:offer', data);
      } catch (error) {
        console.error('Call offer error:', error.message);
      }
    });

    socket.on('call:answer', (data = {}) => {
      try {
        relayCallEvent('call:answer', data);
      } catch (error) {
        console.error('Call answer error:', error.message);
      }
    });

    socket.on('call:ice', (data = {}) => {
      try {
        relayCallEvent('call:ice', data);
      } catch (error) {
        console.error('Call ICE error:', error.message);
      }
    });

    socket.on('call:end', (data = {}) => {
      try {
        const call = callRegistry.get(data.callId);
        if (!call || !socket.userId) return;
        if (!callRegistry.isParticipant(call.callId, socket.userId)) return;

        const peers = callPeers(call.callId, socket.userId);
        const reason = data.reason || 'hangup';
        callRegistry.leave(call.callId, socket.userId);

        for (const peerId of peers) {
          realtime.emitToUser(peerId, 'call:participant-left', {
            callId: call.callId,
            userId: String(socket.userId),
            reason,
          });
        }
      } catch (error) {
        console.error('Call end error:', error.message);
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

      // Leaving the last device drops them out of any call they were in, so the
      // remaining participants see the tile disappear immediately.
      try {
        for (const { call } of callRegistry.removeUserFromAll(socket.userId)) {
          if (!call) continue;
          for (const peerId of call.participants.keys()) {
            realtime.emitToUser(peerId, 'call:participant-left', {
              callId: call.callId,
              userId: String(socket.userId),
              reason: 'disconnected',
            });
          }
        }
      } catch (error) {
        console.error('Call cleanup on disconnect failed:', error.message);
      }

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
