/**
 * WebRTC call signalling over sockets (no media: SDP/ICE are dummy strings).
 *
 *   cd server && node test/integration/calls.test.js
 */
const mongoose = require('mongoose');
const { io } = require('socket.io-client');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';
const run = Date.now().toString(36);
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

function waitFor(socket, event, timeoutMs = 4000) {
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
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, body: json };
}

async function register(label) {
  const res = await api('POST', '/api/auth/register', {
    body: { displayName: `Call ${label}`, identifier: `call-${label}-${run}@chatgram.test`, password: 'CallTest1!' },
  });
  if (res.status !== 201) throw new Error(`register ${label}: ${res.status}`);
  return { token: res.body.accessToken, id: res.body.user.id };
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { auth: { token }, transports: ['websocket'] });
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 8000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function main() {
  console.log(`\ncall signalling integration test against ${BASE}\n`);

  const unauth = await api('GET', '/api/calls/ice');
  check('ICE config requires auth -> 401', unauth.status === 401, `${unauth.status}`);

  const a = await register('alice');
  const b = await register('bob');
  const c = await register('carol');

  const ice = await api('GET', '/api/calls/ice', { token: a.token });
  check('ICE config loads', ice.status === 200, `${ice.status}`);
  check('ICE config has STUN servers', Array.isArray(ice.body?.iceServers) && ice.body.iceServers.length >= 1, JSON.stringify(ice.body));
  check('ICE config reports whether TURN is configured', typeof ice.body?.hasTurn === 'boolean', JSON.stringify(ice.body?.hasTurn));

  const direct = await api('POST', '/api/chats', { token: a.token, body: { type: 'direct', participantId: b.id } });
  const chatId = direct.body?._id;
  check('setup: direct chat', Boolean(chatId), JSON.stringify(direct.body).slice(0, 160));

  const socketA = await connect(a.token);
  const socketB = await connect(b.token);
  const socketC = await connect(c.token);
  await new Promise((resolve) => setTimeout(resolve, 400));

  const callId = `call-${run}-1`;

  // ---- offer -> incoming, ringing
  const incomingPromise = waitFor(socketB, 'call:incoming');
  const ringingPromise = waitFor(socketA, 'call:ringing');
  socketA.emit('call:offer', { toUserId: b.id, chatId, callId, video: false, sdp: { type: 'offer', sdp: 'v=0-offer' } });
  const incoming = await incomingPromise;
  check('callee receives call:incoming', Boolean(incoming), JSON.stringify(incoming));
  check('incoming carries the caller identity', String(incoming?.from?.id) === String(a.id), JSON.stringify(incoming?.from));
  check('incoming carries the SDP', incoming?.sdp?.sdp === 'v=0-offer', JSON.stringify(incoming?.sdp));
  check('caller receives call:ringing', Boolean(await ringingPromise));

  // ---- answer
  const answerPromise = waitFor(socketA, 'call:answer');
  socketB.emit('call:answer', { toUserId: a.id, chatId, callId, sdp: { type: 'answer', sdp: 'v=0-answer' } });
  const answer = await answerPromise;
  check('caller receives call:answer', answer?.sdp?.sdp === 'v=0-answer', JSON.stringify(answer));
  check('answer carries the call id', answer?.callId === callId, JSON.stringify(answer?.callId));

  // ---- ICE
  const icePromise = waitFor(socketB, 'call:ice');
  socketA.emit('call:ice', { toUserId: b.id, chatId, callId, candidate: { candidate: 'candidate:1 1 udp 1 127.0.0.1 5000 typ host' } });
  const icePayload = await icePromise;
  check('ICE candidate is forwarded', Boolean(icePayload?.candidate?.candidate), JSON.stringify(icePayload));

  // ---- end
  const endPromise = waitFor(socketB, 'call:end');
  socketA.emit('call:end', { toUserId: b.id, chatId, callId, reason: 'hangup' });
  const ended = await endPromise;
  check('hangup reaches the other side with its reason', ended?.reason === 'hangup', JSON.stringify(ended));

  // ---- decline
  const callId2 = `call-${run}-2`;
  const incoming2 = waitFor(socketB, 'call:incoming');
  socketA.emit('call:offer', { toUserId: b.id, chatId, callId: callId2, video: false, sdp: { type: 'offer', sdp: 'v=0' } });
  await incoming2;
  const declined = waitFor(socketA, 'call:end');
  socketB.emit('call:reject', { toUserId: a.id, chatId, callId: callId2 });
  const declinePayload = await declined;
  check('declining reports reason=declined to the caller', declinePayload?.reason === 'declined', JSON.stringify(declinePayload));

  // ---- outsider cannot inject signalling into a chat they are not part of
  const outsiderError = waitFor(socketC, 'call:error');
  socketC.emit('call:offer', { toUserId: b.id, chatId, callId: 'forged', video: false, sdp: { type: 'offer', sdp: 'x' } });
  const forbidden = await outsiderError;
  check('a non-participant cannot signal into the chat -> call:error', forbidden?.code === 'CALL_FORBIDDEN', JSON.stringify(forbidden));

  // ---- offline callee -> call:unavailable
  socketB.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const unavailable = waitFor(socketA, 'call:unavailable');
  socketA.emit('call:offer', { toUserId: b.id, chatId, callId: 'offline', video: false, sdp: { type: 'offer', sdp: 'x' } });
  const unavailablePayload = await unavailable;
  check('calling an offline user reports unavailable', Boolean(unavailablePayload), JSON.stringify(unavailablePayload));

  socketA.disconnect();
  socketC.disconnect();

  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 4000 });
    const User = require('../../src/models/User');
    const Chat = require('../../src/models/Chat');
    const ids = [a.id, b.id, c.id].map((id) => new mongoose.Types.ObjectId(id));
    await Chat.deleteMany({ participants: { $in: ids } });
    await User.deleteMany({ _id: { $in: ids } });
    await mongoose.disconnect();
  } catch (error) {
    console.log(`  (cleanup skipped: ${error.message})`);
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', error);
  process.exit(1);
});
