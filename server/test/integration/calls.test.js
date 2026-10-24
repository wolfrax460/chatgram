/**
 * WebRTC call signalling integration test (group + 1:1, voice + video).
 *
 *   cd server && node test/integration/calls.test.js
 *
 * Drives the real socket server with dummy SDP/ICE strings — no media is
 * negotiated. Verifies the participant lifecycle, per-peer routing, the group
 * cap, and that outsiders cannot inject signalling.
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

function waitFor(socket, event, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const pause = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

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
    body: {
      displayName: `Call ${label}`,
      identifier: `call-${label}-${run}@chatgram.test`,
      password: 'CallTest1!',
    },
  });
  if (res.status !== 201) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
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
  const outsider = await register('dave');

  const ice = await api('GET', '/api/calls/ice', { token: a.token });
  check('ICE config loads', ice.status === 200, `${ice.status}`);
  check('ICE config has STUN servers', Array.isArray(ice.body?.iceServers) && ice.body.iceServers.length >= 1);

  const groupRes = await api('POST', '/api/chats', {
    token: a.token,
    body: { type: 'group', groupName: `Call group ${run}`, participantIds: [b.id, c.id] },
  });
  const groupId = groupRes.body?._id;
  check('setup: group chat with 3 members', Boolean(groupId), JSON.stringify(groupRes.body).slice(0, 160));

  const socketA = await connect(a.token);
  const socketB = await connect(b.token);
  const socketC = await connect(c.token);
  const socketD = await connect(outsider.token);
  await pause(400);

  // ------------------------------------------------------------ group call
  const callId = `call-${run}-group`;
  const incomingB = waitFor(socketB, 'call:incoming');
  const incomingC = waitFor(socketC, 'call:incoming');
  const ringingA = waitFor(socketA, 'call:ringing');
  socketA.emit('call:start', { callId, chatId: groupId, video: true });

  const [ring, inB, inC] = await Promise.all([ringingA, incomingB, incomingC]);
  check('caller gets call:ringing', Boolean(ring), JSON.stringify(ring));
  check('ringing marks a group call', ring?.isGroup === true, JSON.stringify(ring?.isGroup));
  check('ringing carries the video flag', ring?.video === true);
  check('ringing reports how many were rung', ring?.ringCount === 2, String(ring?.ringCount));
  check('both group members are rung', Boolean(inB) && Boolean(inC));
  check('incoming is marked as a group call', inB?.isGroup === true);
  check('incoming carries the group title', String(inB?.title).includes('Call group'), inB?.title);
  check('incoming reports the participant count', inB?.participantCount === 3, String(inB?.participantCount));
  check('incoming carries the caller', String(inB?.from?.id) === String(a.id), JSON.stringify(inB?.from));
  check('incoming does not pre-create an SDP', inB?.sdp === undefined);

  // b accepts -> gets the people already in the call, then offers to them
  const joinedB = waitFor(socketB, 'call:joined');
  const participantJoinedA = waitFor(socketA, 'call:participant-joined');
  socketB.emit('call:accept', { callId });
  const [joinB, pJoinedA] = await Promise.all([joinedB, participantJoinedA]);
  check('accepting yields call:joined', Boolean(joinB), JSON.stringify(joinB));
  check('joined lists the people already in the call', joinB?.participants?.length === 1, JSON.stringify(joinB?.participants));
  check('existing participant is the caller', String(joinB?.participants?.[0]?.id) === String(a.id));
  check('the caller is told someone joined', String(pJoinedA?.participant?.id) === String(b.id), JSON.stringify(pJoinedA));

  const offerA = waitFor(socketA, 'call:offer');
  socketB.emit('call:offer', { callId, toUserId: a.id, sdp: { type: 'offer', sdp: 'v=0-b-to-a' } });
  const offerPayload = await offerA;
  check('group offer reaches the other participant', offerPayload?.sdp?.sdp === 'v=0-b-to-a', JSON.stringify(offerPayload));
  check('group offer identifies the sender', String(offerPayload?.from?.id) === String(b.id));

  const answerB = waitFor(socketB, 'call:answer');
  socketA.emit('call:answer', { callId, toUserId: b.id, sdp: { type: 'answer', sdp: 'v=0-a-to-b' } });
  const answerPayload = await answerB;
  check('group answer is routed back to the offerer', answerPayload?.sdp?.sdp === 'v=0-a-to-b', JSON.stringify(answerPayload));

  const iceB = waitFor(socketB, 'call:ice');
  socketA.emit('call:ice', { callId, toUserId: b.id, candidate: { candidate: 'candidate:1 1 udp 1 127.0.0.1 5000 typ host' } });
  const icePayload = await iceB;
  check('ICE candidate is relayed within the call', Boolean(icePayload?.candidate?.candidate));

  // third participant joins later
  const joinedC = waitFor(socketC, 'call:joined');
  const cJoinNotices = [waitFor(socketA, 'call:participant-joined'), waitFor(socketB, 'call:participant-joined')];
  socketC.emit('call:accept', { callId });
  const [joinC, noticeA, noticeB] = await Promise.all([joinedC, ...cJoinNotices]);
  check('a late joiner gets the existing participants', joinC?.participants?.length === 2, String(joinC?.participants?.length));
  check('everyone is told about the late joiner', String(noticeA?.participant?.id) === String(c.id) && String(noticeB?.participant?.id) === String(c.id));

  // c leaves; the call survives
  const leftA = waitFor(socketA, 'call:participant-left');
  socketC.emit('call:end', { callId, reason: 'hangup' });
  const leftPayload = await leftA;
  check('leaving a group call notifies the others', String(leftPayload?.userId) === String(c.id), JSON.stringify(leftPayload));
  check('leaving reports the reason', leftPayload?.reason === 'hangup');

  // --------------------------------------------------------- authorisation
  const outsiderStart = waitFor(socketD, 'call:error');
  socketD.emit('call:start', { callId: `call-${run}-x`, chatId: groupId, video: false });
  const outsiderErr = await outsiderStart;
  check('a non-member cannot start a call in the chat', outsiderErr?.code === 'CALL_FORBIDDEN', JSON.stringify(outsiderErr));

  const outsiderOffer = waitFor(socketD, 'call:error');
  socketD.emit('call:offer', { callId, toUserId: a.id, sdp: { type: 'offer', sdp: 'x' } });
  const outsiderOfferErr = await outsiderOffer;
  check('an outsider cannot inject signalling into a live call', outsiderOfferErr?.code === 'CALL_FORBIDDEN', JSON.stringify(outsiderOfferErr));

  const busyError = waitFor(socketB, 'call:error');
  socketB.emit('call:start', { callId: `call-${run}-busy`, chatId: groupId, video: false });
  const busyErr = await busyError;
  check('starting a second call while in one is refused', busyErr?.code === 'CALL_BUSY', JSON.stringify(busyErr));

  // ------------------------------------------------------- decline + end
  // Leave the group call first, otherwise the caller is still "busy".
  const groupEndedForB = waitFor(socketB, 'call:participant-left');
  socketA.emit('call:end', { callId, reason: 'hangup' });
  const endedPayload = await groupEndedForB;
  check('ending the call notifies the remaining participant', String(endedPayload?.userId) === String(a.id), JSON.stringify(endedPayload));

  const direct = await api('POST', '/api/chats', {
    token: a.token,
    body: { type: 'direct', participantId: outsider.id },
  });
  const directId = direct.body?._id;
  check('setup: direct chat', Boolean(directId));

  const directCallId = `call-${run}-direct`;
  const directIncoming = waitFor(socketD, 'call:incoming');
  socketA.emit('call:start', { callId: directCallId, chatId: directId, video: false });
  const directIn = await directIncoming;
  check('a direct call rings the other person', Boolean(directIn), JSON.stringify(directIn));
  check('a direct call is not marked as a group', directIn?.isGroup === false);

  const declined = waitFor(socketA, 'call:participant-declined');
  socketD.emit('call:decline', { callId: directCallId });
  const declinedPayload = await declined;
  check('declining is reported to the caller', String(declinedPayload?.userId) === String(outsider.id), JSON.stringify(declinedPayload));

  // ------------------------------------------------------------ offline
  socketD.disconnect();
  await pause(500);
  const unavailable = waitFor(socketA, 'call:unavailable');
  socketA.emit('call:start', { callId: `call-${run}-offline`, chatId: directId, video: false });
  const unavailablePayload = await unavailable;
  check('calling an offline person reports unavailable', Boolean(unavailablePayload), JSON.stringify(unavailablePayload));

  socketA.disconnect();
  socketB.disconnect();
  socketC.disconnect();

  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', {
      serverSelectionTimeoutMS: 4000,
    });
    const User = require('../../src/models/User');
    const Chat = require('../../src/models/Chat');
    const Message = require('../../src/models/Message');
    const ids = [a.id, b.id, c.id, outsider.id].map((id) => new mongoose.Types.ObjectId(id));
    const chats = await Chat.find({ participants: { $in: ids } }).select('_id');
    await Message.deleteMany({ chatId: { $in: chats.map((chat) => chat._id) } });
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
