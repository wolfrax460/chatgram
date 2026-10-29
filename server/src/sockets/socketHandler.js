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
const callRooms = require('../utils/callRooms');
const { blockedBetween } = require('../utils/blocks');
const groupSystem = require('../utils/groupSystem');
const platformSettings = require('../utils/platformSettings');

const JWT_SECRET = () => process.env.JWT_SECRET || 'your-secret-key';

/**
 * Rejection used by both socket maintenance gates. Socket.IO forwards
 * `error.data` to the client, which sees it on `connect_error` — so a shell can
 * branch on `err.data.code === 'MAINTENANCE'` and show the maintenance screen
 * instead of a generic "connection failed".
 */
function maintenanceError(settings) {
  const message = (settings && settings.maintenanceMessage) || platformSettings.DEFAULTS.maintenanceMessage;
  const error = new Error(message);
  error.data = { code: 'MAINTENANCE', message };
  return error;
}

/**
 * Events allowed while maintenance is on. Only the ones needed to keep an
 * already-connected socket alive and identified: the presence heartbeat (the
 * sweeper disconnects silent sockets) and the auth handshake. Everything else
 * (messages, calls, typing, receipts) is refused, mirroring the REST 503.
 */
const MAINTENANCE_SAFE_EVENTS = new Set(['presence:ping', 'authenticate']);

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
  // Chunk 2: a member who opens the app (or reconnects) while a group call is
  // live gets the room snapshot immediately, so the banner and Join button are
  // there even though the one-shot ring happened before they were connected.
  const userChatIds = new Set(userChats.map((chat) => String(chat._id)));
  const meId = String(user._id);
  for (const call of callRegistry.activeCalls()) {
    if (
      userChatIds.has(String(call.chatId)) ||
      call.participants.has(meId) ||
      (call.invitees && call.invitees.has(meId))
    ) {
      socket.emit('call:room', callRooms.roomSnapshot(call));
    }
  }

  await User.findByIdAndUpdate(user._id, { isOnline: true, lastSeen: new Date() });

  socket.emit('authenticated', { success: true, user: publicUser(user) });
  socket.broadcast.emit('presence:online', { userId: socket.userId });
}

function registerSocketHandlers(io) {
  // Presence sweeper: drop sockets whose heartbeat expired. Disconnecting the
  // socket runs the normal disconnect handler, which updates lastSeen and
  // broadcasts presence:offline when it was the user's last connection.
  // Ring timeout: a call nobody answers is reported as missed after 45s, logged,
  // its card frozen to "Missed" and the room torn down so it can never ring
  // forever or hold the caller as "busy". A room someone already joined is not
  // affected (a group call keeps going until the last participant leaves).
  const ringSweepMs = Number(process.env.CALL_RING_SWEEP_MS || 2_000);
  const ringSweeper = setInterval(() => {
    for (const call of callRegistry.expiredRings()) {
      void callRooms.endCallRoom(call, { status: 'missed', reason: 'missed' });
    }
  }, ringSweepMs);
  if (typeof ringSweeper.unref === 'function') ringSweeper.unref();
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

  // Maintenance gate for realtime. New connections are refused with a
  // machine-readable MAINTENANCE code. Deliberately NOT a disconnect of live
  // sockets: a server-initiated disconnect is not auto-reconnected by the
  // Socket.IO client, which would leave the app dead after maintenance ends.
  io.use(async (socket, next) => {
    try {
      const settings = await platformSettings.get();
      if (!platformSettings.isMaintenanceActive(settings)) return next();
      return next(maintenanceError(settings));
    } catch (error) {
      // Same fail-open rule as the REST gate: settings problems must not break
      // messaging for everyone.
      console.warn('Socket maintenance gate error:', error.message);
      return next();
    }
  });

  io.on('connection', (socket) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('Socket connected:', socket.id);
    }

    // A socket opened before maintenance was switched on must not keep working
    // as a side door around the REST 503: drop every app event while it is on.
    // The socket itself stays connected, so it resumes on its own when the
    // admin turns maintenance off. We emit `maintenance` (rather than failing
    // the middleware with an Error) so the client is told why, and the event is
    // simply not forwarded.
    socket.use((packet, next) => {
      const event = Array.isArray(packet) ? packet[0] : packet;
      if (MAINTENANCE_SAFE_EVENTS.has(event)) return next();
      platformSettings
        .get()
        .then((settings) => {
          if (!platformSettings.isMaintenanceActive(settings)) return next();
          socket.emit('maintenance', {
            code: 'MAINTENANCE',
            message: (settings && settings.maintenanceMessage) || platformSettings.DEFAULTS.maintenanceMessage,
          });
          return undefined;
        })
        .catch(() => next());
    });

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

        // Frozen groups are read-only for everyone (9b moderation).
        if (chat.type === 'group' && chat.groupFrozen) {
          socket.emit('message:error', {
            message: 'This group is read-only while an administrator reviews it.',
            clientId,
            code: 'GROUP_FROZEN',
          });
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

        // Chunk 1C: in a group whose AI answers are "only the person who asked",
        // an @Chatgram AI mention is private from the moment it is stored, and
        // the question never reaches the group room.
        const groupMentions = require('../ai/groupMentions');
        const visibleTo =
          chat.type === 'group' && type === 'text'
            ? groupMentions.privateMentionVisibleTo(chat, content, socket.userId)
            : [];
        const isPrivate = visibleTo.length > 0;

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
          visibleTo,
          // Per-chat disappearing messages: readers hide it after this time.
          expiresAt: require('../utils/disappearing').expiresAtFor(chat),
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

        const payload = { ...populated.toObject(), clientId: clientId || null, private: isPrivate };
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

      if (isPrivate) {
        // Only the asker's own devices may receive a private AI question live.
        for (const userId of visibleTo) realtime.emitToUser(userId, 'message:new', payload);
      } else {
        io.to(realtime.roomForChat(chatId)).emit('message:new', payload);
      }

      // Push to offline/background devices (fire-and-forget: a push failure must
      // never block or fail the socket send). Private AI questions are never
      // pushed, or another member would receive their text.
      if (!isPrivate) {
        void require('../services/pushSender')
          .pushChatMessage({ chat, sender: payload.senderId || { _id: socket.userId }, message: payload })
          .catch((pushError) => console.warn('Message push skipped:', String(pushError?.message || pushError).slice(0, 160)));
      }

      // @mention notifications for group members (never for a private AI
      // question: that would leak its text to a mentioned member).
      if (!isPrivate && mentioned.length > 0) {
        try {
          groupSystem.emitMentions(payload, chat, mentioned);
        } catch (mentionError) {
          console.warn('Mention notification failed:', mentionError.message);
        }
      }

      // Group "@Chatgram AI" mentions: off by default, rate limited, silent on error.
      groupMentions
        .maybeAnswer({ chat, message: payload, io })
        .catch(() => {});

      // Away / auto-reply: direct chats only, opt-in, never loops and never
      // fails the original socket send.
      await require('../utils/autoReply')
        .maybeSendAutoReply({ chat, message: payload, io })
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
    // Multi-party WebRTC call rooms (voice + video). The server never touches
    // media: it validates that a socket belongs to the chat and the room, keeps
    // membership + in-call media state in utils/callRegistry, persists ONE
    // live-updating call-card Message per room (utils/callRooms) and routes
    // SDP/ICE between the peers of that room only.
    //
    // Chunk 2 fixed "a third member cannot join" by making a room discoverable
    // and joinable: call:start rings ALL online members, the persisted card and
    // the call:room snapshot reach the whole chat (and every member on
    // authenticate), call:join lets a late or declined member walk in, and
    // "add participant" converts a 1:1 room into a group room.
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

    // Abuse guard: a user may start a limited number of calls per minute.
    // 20/min still stops a call-spam loop while leaving room for redial after
    // declines / missed calls (and for the integration test's call sequences).
    const ATTEMPTS_PER_MINUTE = Number(process.env.CALL_ATTEMPTS_PER_MINUTE || 20);
    const attemptWindow = new Map(); // userId -> number[]
    function allowCallAttempt(userId) {
      const nowMs = Date.now();
      const recent = (attemptWindow.get(userId) || []).filter((t) => nowMs - t < 60_000);
      if (recent.length >= ATTEMPTS_PER_MINUTE) {
        attemptWindow.set(userId, recent);
        return false;
      }
      recent.push(nowMs);
      attemptWindow.set(userId, recent);
      return true;
    }

    function emitCallError(message, code, extra = {}) {
      socket.emit('call:error', { message, code, ...extra });
    }

    /** Resolve the live room named by { callId } or { chatId }. */
    function resolveCall(data = {}) {
      if (data.callId) return callRegistry.get(data.callId);
      if (data.chatId) return callRegistry.findCallForChat(data.chatId);
      return null;
    }

    /** Refuse to join when I am blocked with the starter or anyone already in. */
    async function blockedWithRoom(userId, call) {
      if (
        String(call.initiatorId) !== String(userId) &&
        (await blockedBetween(userId, call.initiatorId))
      ) {
        return true;
      }
      for (const participantId of call.participants.keys()) {
        if (String(participantId) === String(userId)) continue;
        if (String(participantId) === String(call.initiatorId)) continue;
        if (await blockedBetween(userId, participantId)) return true;
      }
      return false;
    }

    /** Validate a join/accept against the authenticated user + the chat. */
    async function joinContext(data = {}) {
      if (!socket.userId) {
        return { error: { message: 'Sign in to join calls.', code: 'CALL_UNAUTHENTICATED' } };
      }
      const call = resolveCall(data);
      if (!call) return { error: { message: 'This call has ended.', code: 'CALL_GONE' } };
      const chat = await Chat.findById(call.chatId).select('_id type participants groupName').lean();
      if (!chat) return { error: { message: 'This call has ended.', code: 'CALL_GONE' } };
      if (chat.type === 'group') {
        const member = (chat.participants || []).some(
          (id) => String(id) === String(socket.userId),
        );
        // Only group members may join a group room, even if they were not
        // online when the call started.
        if (!member) {
          return { error: { message: 'Only group members can join this call.', code: 'CALL_FORBIDDEN' } };
        }
      } else if (!call.invitees.has(String(socket.userId))) {
        return { error: { message: 'You were not invited to this call.', code: 'CALL_FORBIDDEN' } };
      }
      const other = callRegistry.findCallForUser(socket.userId);
      if (other && other.callId !== call.callId) {
        return { error: { message: 'You are already in a call.', code: 'CALL_BUSY' } };
      }
      if (await blockedWithRoom(socket.userId, call)) {
        return { error: { message: 'You cannot join this call.', code: 'CALL_BLOCKED' } };
      }
      return { call, chat, me: await callerIdentity() };
    }

    /** Join the room and announce it to everyone already inside (mesh join). */
    async function completeJoin(call, me, options = {}) {
      const joined = callRegistry.join(call.callId, me, {
        audioOnly: options.audioOnly === true,
      });
      if (!joined.ok) {
        emitCallError(joined.error, joined.code, {
          capacity: joined.capacity,
          videoCapacity: joined.videoCapacity,
          audioOnlyAvailable: joined.audioOnlyAvailable === true,
        });
        return null;
      }
      // The late joiner receives EVERY existing peer, so it can open one
      // perfect-negotiation connection per peer (the missing half of the old
      // "third member cannot join" path).
      socket.emit('call:joined', {
        callId: call.callId,
        chatId: String(call.chatId),
        video: call.video,
        isGroup: call.isGroup,
        title: call.title,
        participants: joined.existing,
        startedAt: new Date(call.createdAt).toISOString(),
        capacity: call.capacity,
        videoCapacity: call.videoCapacity,
        cardMessageId: call.cardMessageId || null,
      });
      // Other tabs/devices of the same user must stop ringing.
      realtime
        .getIo()
        ?.to(realtime.roomForUser(socket.userId))
        .except(socket.id)
        .emit('call:answered-elsewhere', { callId: call.callId });
      if (!joined.rejoin) {
        for (const peer of joined.existing) {
          realtime.emitToUser(peer.id, 'call:participant-joined', {
            callId: call.callId,
            participant: joined.participant,
            participants: callRegistry.participants(call.callId),
          });
        }
      }
      // Ringing is over: the card becomes "Ongoing · N people · Join" and the
      // whole chat gets a fresh snapshot (banner + any other member can join).
      await callRooms.updateCallCard(call);
      callRooms.broadcastRoom(call);
      return joined;
    }

    /** Media-state patch derived from an in-call signal (screen share / camera). */
    function mediaPatchForSignal(signal = {}) {
      if (signal.kind === 'muted') return { muted: signal.muted === true };
      if (signal.kind === 'camera') return { cameraOn: signal.cameraOn === true };
      if (signal.kind === 'screen') {
        return signal.screenSharing === true
          ? {
              screenSharing: true,
              sharingKind: signal.sharingKind || 'screen',
              // A screen share always rides the video track; the receiving side
              // renders it large instead of the camera tile.
              trackKind: 'video',
              hasSystemAudio: signal.hasSystemAudio === true,
            }
          : {
              screenSharing: false,
              sharingKind: null,
              trackKind: null,
              hasSystemAudio: false,
            };
      }
      return null;
    }

    function relayCallEvent(event, data) {
      const call = resolveCall(data);
      if (!call || !socket.userId) {
        emitCallError('This call has ended.', 'CALL_GONE');
        return;
      }
      if (!callRegistry.isParticipant(call.callId, socket.userId)) {
        emitCallError('You are not in this call.', 'CALL_FORBIDDEN');
        return;
      }
      // The previous client rides in-call state on call:ice as `signal`; keep
      // that working and remember the state for late joiners either way.
      if (data.signal) {
        const patch = mediaPatchForSignal(data.signal);
        const participant = patch
          ? callRegistry.setMediaState(call.callId, socket.userId, patch)
          : null;
        if (participant) {
          for (const peerId of call.participants.keys()) {
            if (String(peerId) !== String(socket.userId)) {
              realtime.emitToUser(peerId, 'call:participant-state', {
                callId: call.callId,
                participant,
              });
            }
          }
        }
      }
      const to = String(data.toUserId || '');
      // Only route to someone who is actually in the same call.
      if (!to || !callRegistry.isParticipant(call.callId, to) || to === String(socket.userId)) {
        return;
      }
      realtime.emitToUser(to, event, {
        ...data,
        callId: call.callId,
        from: { id: String(socket.userId) },
      });
    }

    socket.on('call:start', async (data = {}) => {
      try {
        if (!socket.userId) {
          return emitCallError('Sign in to make calls.', 'CALL_UNAUTHENTICATED');
        }
        if (!allowCallAttempt(socket.userId)) {
          return emitCallError(
            'Too many call attempts. Wait a minute and try again.',
            'CALL_RATE_LIMITED',
          );
        }
        const chat = await chatForCaller(data.chatId);
        if (!chat) return emitCallError('You cannot call this chat.', 'CALL_FORBIDDEN');

        const video = data.video === true;
        const me = await callerIdentity();
        const others = chat.participants.map(String).filter((id) => id !== String(socket.userId));
        if (others.length === 0) {
          return emitCallError('There is nobody else in this chat.', 'CALL_EMPTY');
        }
        const isGroup = chat.type === 'group';
        const title = isGroup ? chat.groupName || 'Group call' : me.displayName;

        // 1:1: a blocked contact or a person already on a call is never rung.
        if (!isGroup) {
          const other = others[0];
          if (await blockedBetween(socket.userId, other)) {
            return emitCallError('You cannot call this person.', 'CALL_FORBIDDEN');
          }
          if (callRegistry.findCallForUser(other)) {
            // Honest outcome: the caller sees Busy and the card says Busy.
            await callRooms.persistFinishedCall({
              initiator: me,
              chat,
              callId: data.callId,
              video,
              isGroup: false,
              title,
              status: 'busy',
              invitees: [other],
              busyBy: [other],
            });
            socket.emit('call:busy', {
              callId: data.callId || null,
              chatId: String(chat._id),
              message: 'They are on another call.',
            });
            return;
          }
        }

        // Everyone already in another call is not rung; EVERY other online
        // member is (no "capacity - 1" slicing: the room rings all members and
        // the caps are enforced when someone actually joins).
        const busy = others.filter((id) => callRegistry.findCallForUser(id));
        const ringable = others.filter(
          (id) => !busy.includes(id) && realtime.isUserOnline(id),
        );
        if (ringable.length === 0) {
          // Nobody reachable: still record the real outcome + card (offline
          // members later see "Missed") instead of silently dropping the call.
          const status = busy.length > 0 ? 'busy' : 'missed';
          await callRooms.persistFinishedCall({
            initiator: me,
            chat,
            callId: data.callId,
            video,
            isGroup,
            title,
            status,
            invitees: others,
            busyBy: busy,
          });
          if (busy.length > 0) {
            socket.emit('call:busy', {
              callId: data.callId || null,
              chatId: String(chat._id),
              message: isGroup
                ? 'Everyone is on another call right now.'
                : 'They are on another call.',
            });
          } else {
            socket.emit('call:unavailable', {
              chatId: String(chat._id),
              callId: data.callId || null,
              isGroup,
              video,
            });
          }
          return;
        }

        const created = callRegistry.create({
          callId: data.callId,
          chatId: chat._id,
          video,
          isGroup,
          title,
          initiator: me,
          invitees: others,
        });
        if (!created.ok) return emitCallError(created.error, created.code);
        const call = created.call;
        for (const busyId of busy) callRegistry.markBusy(call.callId, busyId);

        // The persisted, live-updating call card in the chat. It is the piece
        // that lets anyone join later (and it is what the chat shows now).
        const card = await callRooms.createCallCard(call, chat);
        call.cardMessageId = card ? String(card._id) : null;
        const snapshot = callRooms.roomSnapshot(call);

        for (const userId of ringable) {
          realtime.emitToUser(userId, 'call:incoming', {
            callId: call.callId,
            chatId: String(call.chatId),
            video: call.video,
            isGroup,
            title,
            participantCount: snapshot.participantCount,
            capacity: call.capacity,
            videoCapacity: call.videoCapacity,
            from: me,
            participants: snapshot.participants,
            startedAt: snapshot.startedAt,
            state: 'ringing',
            cardMessageId: call.cardMessageId,
          });
        }

        socket.emit('call:ringing', {
          callId: call.callId,
          chatId: String(call.chatId),
          video: call.video,
          isGroup,
          title,
          participants: snapshot.participants,
          ringCount: ringable.length,
          capacity: call.capacity,
          videoCapacity: call.videoCapacity,
          busyCount: busy.length,
          startedAt: snapshot.startedAt,
          state: 'ringing',
          cardMessageId: call.cardMessageId,
        });
        // Tell the whole chat a call is in progress (banner + live card).
        callRooms.broadcastRoom(call);

        // FCM data-only wake-up for the phones the socket cannot ring (and, with
        // force, as a wake-up even when presence still says online). This is
        // fire-and-forget: a push problem never fails the call itself.
        const pushTargets = others.filter((id) => !busy.includes(id));
        if (pushTargets.length > 0) {
          void require('../services/pushSender')
            .pushCall({
              callId: call.callId,
              chatId: String(call.chatId),
              callerName: me.displayName,
              kind: video ? 'video' : 'audio',
              groupName: isGroup ? (chat.groupName || 'Group call') : undefined,
              recipientIds: pushTargets,
              force: true,
            })
            .catch((pushError) => console.warn('Call push skipped:', String(pushError?.message || pushError).slice(0, 160)));
        }
      } catch (error) {
        console.error('Call start error:', error.message);
        emitCallError('Could not start the call.', 'CALL_START_FAILED');
      }
    });

    async function handleCallJoin(data = {}) {
      try {
        const context = await joinContext(data);
        if (context.error) return socket.emit('call:error', context.error);
        await completeJoin(context.call, context.me, { audioOnly: data.audioOnly === true });
      } catch (error) {
        console.error('Call join error:', error.message);
        emitCallError('Could not join the call.', 'CALL_JOIN_FAILED');
      }
    }

    socket.on('call:accept', (data = {}) => {
      // Legacy shape: a callee answering a call:incoming. If the room is gone
      // and no chatId was supplied, answer "missed" (never a silent no-op).
      if (!socket.userId) return;
      const call = resolveCall(data);
      if (!call && !data.chatId) {
        return socket.emit('call:ended', {
          callId: data.callId,
          reason: 'missed',
          status: 'missed',
        });
      }
      void handleCallJoin(data);
    });

    // Late join / re-join from the call card or the "Call in progress · Join"
    // banner. Accepts { callId } or { chatId } so a member who never saw the
    // one-shot ring can still walk into the room.
    socket.on('call:join', (data = {}) => void handleCallJoin(data));

    // Ask for the live room of a chat (used on opening a chat, after a screen
    // wake, or when the socket reconnects).
    socket.on('call:state:get', async (data = {}) => {
      try {
        if (!socket.userId || !data.chatId) return;
        const chat = await Chat.findOne({ _id: data.chatId, participants: socket.userId })
          .select('_id')
          .lean();
        if (!chat) {
          socket.emit('call:room', callRooms.emptyRoom(data.chatId));
          return;
        }
        const call = callRegistry.findCallForChat(data.chatId);
        socket.emit(
          'call:room',
          call ? callRooms.roomSnapshot(call) : callRooms.emptyRoom(data.chatId),
        );
      } catch (error) {
        console.error('Call state error:', error.message);
      }
    });

    socket.on('call:decline', async (data = {}) => {
      try {
        const call = resolveCall(data);
        if (!call || !socket.userId) return;
        const me = String(socket.userId);
        // Declining is for someone who was rung and never joined; a participant
        // leaving goes through call:end.
        if (!call.invitees.has(me) || call.participants.has(me)) return;
        callRegistry.markDeclined(call.callId, me);

        const initiator = String(call.initiatorId);
        if (initiator !== me) {
          realtime.emitToUser(initiator, 'call:participant-declined', {
            callId: call.callId,
            chatId: String(call.chatId),
            userId: me,
            isGroup: call.isGroup,
            participants: callRegistry.participants(call.callId),
          });
        }

        if (!call.isGroup) {
          // A declined 1:1 call is over: persist "Declined", freeze the card and
          // make sure the caller is never left "busy" until they hang up.
          await callRooms.endCallRoom(call, { status: 'declined', reason: 'declined' });
          return;
        }
        // Group: the room keeps going; the decline is informational only.
        callRooms.broadcastRoom(call);
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

    // In-call state relay (chunk 2): screen sharing, camera off privacy,
    // mute state, incoming-video-off. The server validates membership, stores
    // the state on the room (so late joiners see it) and relays it to the target
    // peer, or to every other participant when toUserId is omitted.
    socket.on('call:signal', (data = {}) => {
      try {
        const call = resolveCall(data);
        if (!call || !socket.userId) return;
        const me = String(socket.userId);
        if (!call.participants.has(me)) {
          return emitCallError('You are not in this call.', 'CALL_FORBIDDEN');
        }
        const signal = data.signal || {};
        const patch = mediaPatchForSignal(signal);
        const participant = patch ? callRegistry.setMediaState(call.callId, me, patch) : null;
        const payload = {
          callId: call.callId,
          from: participant,
          participant,
          signal,
        };
        if (data.toUserId) {
          if (call.participants.has(String(data.toUserId))) {
            realtime.emitToUser(String(data.toUserId), 'call:signal', payload);
          }
        } else {
          for (const peerId of call.participants.keys()) {
            if (String(peerId) !== me) realtime.emitToUser(String(peerId), 'call:signal', payload);
          }
        }
        if (participant) {
          for (const peerId of call.participants.keys()) {
            if (String(peerId) !== me) {
              realtime.emitToUser(String(peerId), 'call:participant-state', {
                callId: call.callId,
                participant,
              });
            }
          }
        }
      } catch (error) {
        console.error('Call signal error:', error.message);
      }
    });

    // "Add participant" in a 1:1 call: the same room becomes a group room (it is
    // never interrupted), the added contact is rung and gets Join/Decline.
    socket.on('call:add-participant', async (data = {}) => {
      try {
        if (!socket.userId) return;
        const call = resolveCall(data);
        if (!call) return emitCallError('This call has ended.', 'CALL_GONE');
        const me = String(socket.userId);
        if (!call.participants.has(me)) {
          return emitCallError('You are not in this call.', 'CALL_FORBIDDEN');
        }
        const targetId = String(data.userId || '');
        if (!mongoose.Types.ObjectId.isValid(targetId) || targetId === me) {
          return emitCallError('That person was not found.', 'CALL_INVALID');
        }
        if (call.invitees.has(targetId)) {
          const participant = callRegistry.publicParticipant(
            call.participants.get(targetId) || {
              id: targetId,
              displayName: '',
              avatarUrl: null,
              media: {},
            },
          );
          socket.emit('call:participant-invited', {
            callId: call.callId,
            participant,
            participants: callRegistry.participants(call.callId),
            alreadyInvited: true,
          });
          return;
        }
        const target = await User.findById(targetId).select('_id displayName avatarUrl').lean();
        if (!target) return emitCallError('That person was not found.', 'CALL_FORBIDDEN');
        if (await blockedBetween(me, targetId)) {
          return emitCallError('You cannot add this person.', 'CALL_FORBIDDEN');
        }
        // You may add a contact or somebody you already share a chat with.
        const meDoc = await User.findById(me).select('contacts').lean();
        const isContact = (meDoc?.contacts || []).some(
          (id) => String(id) === targetId,
        );
        const sharesChat = isContact
          ? true
          : Boolean(
              await Chat.exists({
                participants: { $all: [socket.userId, targetId] },
              }),
            );
        if (!sharesChat) {
          return emitCallError(
            'You can only add a contact or someone you already chat with.',
            'CALL_FORBIDDEN',
          );
        }
        if (callRegistry.findCallForUser(targetId)) {
          return emitCallError('That person is on another call.', 'CALL_PARTY_BUSY');
        }
        if (!realtime.isUserOnline(targetId)) {
          return emitCallError('That person is offline right now.', 'CALL_PARTY_OFFLINE');
        }

        callRegistry.addInvitee(call.callId, target);
        callRegistry.convertToGroup(call.callId, { title: 'Group call' });
        const targetPublic = {
          id: targetId,
          displayName: target.displayName || '',
          avatarUrl: target.avatarUrl || null,
        };
        const snapshot = callRooms.roomSnapshot(call);
        realtime.emitToUser(targetId, 'call:incoming', {
          callId: call.callId,
          chatId: String(call.chatId),
          video: call.video,
          isGroup: true,
          title: call.title,
          participantCount: snapshot.participantCount,
          capacity: call.capacity,
          videoCapacity: call.videoCapacity,
          from: await callerIdentity(),
          participants: snapshot.participants,
          startedAt: snapshot.startedAt,
          state: 'ringing',
          cardMessageId: call.cardMessageId,
        });
        for (const participantId of call.participants.keys()) {
          realtime.emitToUser(String(participantId), 'call:participant-invited', {
            callId: call.callId,
            participant: targetPublic,
            participants: callRegistry.participants(call.callId),
          });
        }
        await callRooms.updateCallCard(call);
        callRooms.broadcastRoom(call);
      } catch (error) {
        console.error('Call add participant error:', error.message);
        emitCallError('Could not add that person to the call.', 'CALL_ADD_FAILED');
      }
    });

    socket.on('call:end', async (data = {}) => {
      try {
        const call = resolveCall(data);
        if (!call || !socket.userId) return;
        const me = String(socket.userId);
        if (!call.participants.has(me)) return;

        const peers = [...call.participants.keys()]
          .map(String)
          .filter((id) => id !== me);
        const reason = data.reason || 'hangup';
        const wasDirect = call.isGroup !== true;
        const { destroyed } = callRegistry.leave(call.callId, me);

        for (const peerId of peers) {
          realtime.emitToUser(peerId, 'call:participant-left', {
            callId: call.callId,
            userId: me,
            reason,
            participants: callRegistry.participants(call.callId),
          });
        }

        // Leaving never ends a multi-party room: it only ends when the last
        // participant leaves (or a 1:1 call, where either side leaving is over).
        if (destroyed || wasDirect) {
          const status =
            reason === 'failed'
              ? 'failed'
              : reason === 'missed'
                ? 'missed'
                : reason === 'declined'
                  ? 'declined'
                  : call.answeredAt
                    ? 'completed'
                    : 'cancelled';
          await callRooms.endCallRoom(call, {
            status,
            reason: status === 'completed' ? 'ended' : status,
          });
          return;
        }
        await callRooms.updateCallCard(call);
        callRooms.broadcastRoom(call);
      } catch (error) {
        console.error('Call end error:', error.message);
      }
    });

    // ICE / media failure is NOT "Call ended": it is recorded as failed so the
    // caller and the chat card can offer a Retry.
    socket.on('call:failed', async (data = {}) => {
      try {
        const call = resolveCall(data);
        if (!call || !socket.userId) return;
        const me = String(socket.userId);
        if (!call.participants.has(me)) return;
        callRegistry.markFailed(call.callId, me);

        if (call.isGroup !== true || call.participants.size <= 1) {
          await callRooms.endCallRoom(call, { status: 'failed', reason: 'failed' });
          return;
        }
        // Group room: this person's media failed; everyone else keeps talking.
        const peers = [...call.participants.keys()].map(String).filter((id) => id !== me);
        callRegistry.leave(call.callId, me);
        for (const peerId of peers) {
          realtime.emitToUser(peerId, 'call:participant-left', {
            callId: call.callId,
            userId: me,
            reason: 'failed',
            participants: callRegistry.participants(call.callId),
          });
        }
        await callRooms.updateCallCard(call);
        callRooms.broadcastRoom(call);
      } catch (error) {
        console.error('Call failed handler error:', error.message);
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

      // Leaving the last device drops them out of any room they were in, so the
      // remaining participants see the tile disappear immediately. A multi-party
      // room survives; a 1:1 room ends. Either way the outcome is persisted.
      try {
        for (const { call, destroyed } of callRegistry.removeUserFromAll(socket.userId)) {
          if (!call) continue;
          const peers = [...call.participants.keys()].map(String);
          for (const peerId of peers) {
            realtime.emitToUser(peerId, 'call:participant-left', {
              callId: call.callId,
              userId: String(socket.userId),
              reason: 'disconnected',
              participants: callRegistry.participants(call.callId),
            });
          }
          const wasDirect = call.isGroup !== true;
          if (destroyed || wasDirect) {
            const status = call.answeredAt ? 'completed' : 'cancelled';
            void callRooms.endCallRoom(call, {
              status,
              reason: status === 'completed' ? 'ended' : 'cancelled',
            });
          } else {
            void callRooms.updateCallCard(call);
            callRooms.broadcastRoom(call);
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

  const messages = await Message.find(query).select('_id chatId senderId visibleTo ' + field);
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
    (m) =>
      allowed.has(m.chatId.toString()) &&
      // Private AI messages are only marked read/delivered by their allow-list.
      Message.isVisibleTo(m, socket.userId) &&
      !m[field].some((u) => u.equals(socket.userId))
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
