// Shared Socket.IO registry.
//
// Controllers (REST paths) need to broadcast real-time events and to put
// sockets into chat rooms. This module owns that wiring so `server.js` stays
// readable and controllers don't need to be passed `io` around.
let ioRef = null;

// userId -> Set<socketId>. A user may be connected from several devices/tabs.
const userSockets = new Map();

function setIo(io) {
  ioRef = io;
}

function getIo() {
  return ioRef;
}

function roomForChat(chatId) {
  return `room:chat-${chatId}`;
}

function roomForUser(userId) {
  return `user:${userId}`;
}

function trackSocket(userId, socketId) {
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(socketId);
}

function untrackSocket(userId, socketId) {
  const set = userSockets.get(userId);
  if (!set) return false;
  set.delete(socketId);
  if (set.size === 0) {
    userSockets.delete(userId);
    return true; // last connection gone -> truly offline
  }
  return false;
}

function isUserOnline(userId) {
  return userSockets.has(String(userId));
}

/** Put every live socket of the given users into a chat room. */
function joinUsersToChat(chatId, userIds) {
  const io = getIo();
  if (!io) return;
  for (const userId of userIds) {
    const set = userSockets.get(String(userId));
    if (!set) continue;
    for (const socketId of set) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) socket.join(roomForChat(chatId));
    }
  }
}

/** Emit to every device of a single user. */
function emitToUser(userId, event, payload) {
  const io = getIo();
  if (!io) return;
  io.to(roomForUser(userId)).emit(event, payload);
}

/** Emit to everyone in a chat room (including the sender's own devices). */
function emitToChat(chatId, event, payload) {
  const io = getIo();
  if (!io) return;
  io.to(roomForChat(chatId)).emit(event, payload);
}

function onlineUserIds() {
  return [...userSockets.keys()];
}

module.exports = {
  setIo,
  getIo,
  roomForChat,
  roomForUser,
  trackSocket,
  untrackSocket,
  isUserOnline,
  joinUsersToChat,
  emitToUser,
  emitToChat,
  onlineUserIds,
};
