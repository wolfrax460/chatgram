// Shared Socket.IO registry.
//
// Controllers (REST paths) need to broadcast real-time events and to put
// sockets into chat rooms. This module owns that wiring so `server.js` stays
// readable and controllers don't need to be passed `io` around.
//
// PRESENCE MODEL
// A user is online if and only if this registry holds at least one live socket
// for them. The database `isOnline` flag is a hint for tooling only — it is
// never used to answer "is this user online?", because a crash or restart used
// to leave it stuck at true forever. Every socket also carries a heartbeat
// timestamp; the server sweeps and drops sockets that stop pinging, so a
// half-open connection (dead phone, killed tab, dropped Wi-Fi) cannot keep a
// user "online" indefinitely.
let ioRef = null;

/** userId -> Set<socketId>. A user may be connected from several devices/tabs. */
const userSockets = new Map();
/** socketId -> { userId, lastPing, lastDbSeen } */
const socketMeta = new Map();

/** A socket is stale after this long without a client heartbeat. */
function staleAfterMs() {
  return Number(process.env.PRESENCE_STALE_MS || 60_000);
}

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
  const id = String(userId);
  if (!userSockets.has(id)) userSockets.set(id, new Set());
  userSockets.get(id).add(socketId);
  socketMeta.set(socketId, { userId: id, lastPing: Date.now(), lastDbSeen: 0 });
}

function untrackSocket(userId, socketId) {
  const id = String(userId);
  socketMeta.delete(socketId);
  const set = userSockets.get(id);
  if (!set) return false;
  set.delete(socketId);
  if (set.size === 0) {
    userSockets.delete(id);
    return true; // last connection gone -> truly offline
  }
  return false;
}

function isUserOnline(userId) {
  return userSockets.has(String(userId));
}

/** Record a heartbeat from a socket. */
function touchSocket(socketId) {
  const meta = socketMeta.get(socketId);
  if (!meta) return null;
  meta.lastPing = Date.now();
  return meta;
}

/**
 * True when the socket has not sent a heartbeat recently. The DB update that
 * follows a heartbeat is throttled separately, so this never writes.
 */
function shouldPersistSeen(socketId, everyMs = 60_000) {
  const meta = socketMeta.get(socketId);
  if (!meta) return false;
  if (Date.now() - meta.lastDbSeen < everyMs) return false;
  meta.lastDbSeen = Date.now();
  return true;
}

/** Socket ids whose last heartbeat is older than the stale window. */
function staleSocketIds(now = Date.now(), limit = staleAfterMs()) {
  const stale = [];
  for (const [socketId, meta] of socketMeta) {
    if (now - meta.lastPing > limit) stale.push({ socketId, userId: meta.userId });
  }
  return stale;
}

function socketCount() {
  return socketMeta.size;
}

function onlineCount() {
  return userSockets.size;
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
  touchSocket,
  shouldPersistSeen,
  staleSocketIds,
  staleAfterMs,
  socketCount,
  onlineCount,
  isUserOnline,
  joinUsersToChat,
  emitToUser,
  emitToChat,
  onlineUserIds,
};
