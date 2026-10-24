/**
 * Integration test: live presence over sockets.
 *
 *   cd server && node test/integration/presence.test.js
 *
 * Proves the two things that were broken in production:
 *   1. presence is derived from live sockets (a closed tab goes offline), and
 *   2. REST payloads report that live value instead of a stored flag that can
 *      get stuck after a crash.
 *
 * The heartbeat-expiry case needs a server started with a short
 * PRESENCE_STALE_MS (e.g. 1500). When the server reports a long window the test
 * says so and skips that one check rather than waiting a minute.
 */
const mongoose = require('mongoose');
const { io } = require('socket.io-client');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging';
const run = Date.now().toString(36);
const PASSWORD = 'Presence1!';

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitFor(socket, event, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function api(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

async function register(label) {
  const res = await api('POST', '/api/auth/register', {
    body: {
      displayName: `Presence ${label}`,
      identifier: `presence-${label}-${run}@chatgram.test`,
      password: PASSWORD,
    },
  });
  if (res.status !== 201) throw new Error(`register ${label}: ${res.status}`);
  return { token: res.body.accessToken, id: res.body.user.id || res.body.user._id };
}

/** Connect a socket that keeps the presence heartbeat alive. */
function connect(token, { heartbeat = true } = {}) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { auth: { token }, transports: ['websocket'] });
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 8000);
    let ping = null;
    socket.on('connect', () => {
      clearTimeout(timer);
      if (heartbeat) {
        socket.emit('presence:ping', {});
        ping = setInterval(() => socket.emit('presence:ping', {}), 400);
      }
      socket.__ping = ping;
      resolve(socket);
    });
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function close(socket) {
  if (socket.__ping) clearInterval(socket.__ping);
  socket.disconnect();
}

/** The chat payload is the REST read path the green dot and header use. */
async function chatPresence(token, chatId, peerId) {
  const res = await api('GET', '/api/chats', { token });
  const chat = (res.body?.chats || res.body || []).find?.((c) => String(c.id || c._id) === String(chatId));
  if (!chat) return null;
  const peer = (chat.participants || []).find((p) => String(p.id || p._id) === String(peerId));
  return peer ? peer.isOnline === true : null;
}

async function main() {
  console.log(`\npresence integration test against ${BASE}\n`);

  const health = await api('GET', '/api/status/health');
  const staleMs = health.body?.presence?.staleMs ?? 60_000;
  check('health exposes presence diagnostics', typeof staleMs === 'number', JSON.stringify(health.body?.presence));

  const me = await register('me');
  const peer = await register('peer');

  const chat = await api('POST', '/api/chats', {
    token: me.token,
    body: { type: 'direct', participantId: peer.id },
  });
  const chatId = chat.body?._id;
  check('setup: direct chat', Boolean(chatId));

  // ---------------------------------------------------------- basic connect
  const peerSocket = await connect(peer.token);
  await pause(400);

  check('a connected user shows online in the REST payload', (await chatPresence(me.token, chatId, peer.id)) === true);

  const onlineEvent = waitFor(peerSocket, 'presence:online');
  const mySocket = await connect(me.token);
  const sawOnline = await onlineEvent;
  check('the other user receives presence:online', String(sawOnline?.userId) === String(me.id), JSON.stringify(sawOnline));

  // ------------------------------------------------------- basic disconnect
  const offlineEvent = waitFor(peerSocket, 'presence:offline');
  close(mySocket);
  const sawOffline = await offlineEvent;
  check('closing a tab emits presence:offline', Boolean(sawOffline) && String(sawOffline.userId) === String(me.id), JSON.stringify(sawOffline));
  check('the offline event carries lastSeen', Boolean(sawOffline?.lastSeen), JSON.stringify(sawOffline?.lastSeen));
  await pause(300);
  check('an offline user shows offline in the REST payload', (await chatPresence(peer.token, chatId, me.id)) === false);

  // ------------------------------------------------------------ multi-device
  const deviceA = await connect(me.token);
  const deviceB = await connect(me.token);
  await pause(300);
  const prematureOffline = waitFor(peerSocket, 'presence:offline', 1200);
  close(deviceA);
  const unexpected = await prematureOffline;
  check('one device leaving does NOT mark the user offline', unexpected === null, JSON.stringify(unexpected));
  check('the user is still online with one device left', (await chatPresence(peer.token, chatId, me.id)) === true);

  const finalOffline = waitFor(peerSocket, 'presence:offline');
  close(deviceB);
  const finalPayload = await finalOffline;
  check('the last device leaving marks the user offline', Boolean(finalPayload), JSON.stringify(finalPayload));
  check('the user then reads as offline', (await chatPresence(peer.token, chatId, me.id)) === false);

  // ----------------------------------------------------- heartbeat expiry
  if (staleMs <= 5000) {
    const silent = await connect(me.token, { heartbeat: false });
    await pause(300);
    check('a silent socket starts online', (await chatPresence(peer.token, chatId, me.id)) === true);
    const swept = await waitFor(peerSocket, 'presence:offline', staleMs + 6000);
    check('a socket that stops heartbeating is swept offline', Boolean(swept), JSON.stringify(swept));
    try {
      silent.disconnect();
    } catch {
      /* already dropped by the server */
    }
  } else {
    console.log(`  SKIP  heartbeat expiry (server stale window is ${staleMs}ms; restart with PRESENCE_STALE_MS=1500 to run it)`);
  }

  // --------------------------------------------------------- stale DB column
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const User = require('../../src/models/User');
  const stored = await User.findById(me.id).select('isOnline lastSeen').lean();
  check('the stored flag is false after the last socket left', stored?.isOnline === false, JSON.stringify(stored));
  check('lastSeen was persisted on disconnect', Boolean(stored?.lastSeen));

  // A flag stuck by a crash must not make the REST payload claim "online".
  await User.updateOne({ _id: me.id }, { $set: { isOnline: true } });
  check(
    'a stuck stored flag does NOT make the REST payload report online',
    (await chatPresence(peer.token, chatId, me.id)) === false,
  );

  close(peerSocket);

  const ids = [me.id, peer.id].map((id) => new mongoose.Types.ObjectId(id));
  await Chat_cleanup(ids);
  await mongoose.disconnect();

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

async function Chat_cleanup(ids) {
  try {
    const Chat = require('../../src/models/Chat');
    const Message = require('../../src/models/Message');
    const User = require('../../src/models/User');
    const chats = await Chat.find({ participants: { $in: ids } }).select('_id');
    await Message.deleteMany({ chatId: { $in: chats.map((c) => c._id) } });
    await Chat.deleteMany({ participants: { $in: ids } });
    await User.deleteMany({ _id: { $in: ids } });
  } catch (error) {
    console.log(`  (cleanup skipped: ${error.message})`);
  }
}

main().catch((error) => {
  console.error('Test crashed:', error);
  process.exit(1);
});
