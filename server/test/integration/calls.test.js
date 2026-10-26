/**
 * WebRTC call-room signalling integration test (group + 1:1, voice + video).
 *
 *   cd server && node test/integration/calls.test.js
 *
 * Drives the real socket server with dummy SDP/ICE strings — no media is
 * negotiated. Verifies the participant lifecycle, per-peer routing, group call
 * rooms, late joiners, ring-all, the honest 6-video / 12-total caps, add
 * participant, join authorisation (member / blocked), screen-share and
 * camera-off signals, the persisted call card, per-user call outcomes
 * (declined / missed / busy / failed / cancelled / completed) and the live room
 * state API.
 *
 * Env: BASE_URL / E2E_API_URL -> the API under test (staging: http://127.0.0.1:5003).
 */
const mongoose = require('mongoose');
const { io } = require('socket.io-client');

const BASE = process.env.E2E_API_URL || process.env.BASE_URL || 'http://127.0.0.1:5000';
const run = Date.now().toString(36);
let passed = 0;
const failures = [];
const sockets = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

function waitFor(socket, event, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const handler = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, timeoutMs);
    socket.once(event, handler);
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
    sockets.push(socket);
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

async function createGroup(token, name, participantIds) {
  const res = await api('POST', '/api/chats', {
    token,
    body: { type: 'group', groupName: name, participantIds },
  });
  return res.body?._id;
}

async function createDirect(token, participantId) {
  const res = await api('POST', '/api/chats', {
    token,
    body: { type: 'direct', participantId },
  });
  return res.body?._id;
}

async function history(token) {
  const res = await api('GET', '/api/calls?limit=60', { token });
  return res.body?.calls || [];
}

function historyRow(calls, callId) {
  return calls.find((row) => row.callId === callId) || null;
}

async function messages(token, chatId) {
  const res = await api('GET', `/api/messages?chatId=${chatId}&limit=100`, { token });
  return res.body?.messages || [];
}

async function cardFor(token, chatId, callId) {
  const list = await messages(token, chatId);
  return list.find((message) => message.type === 'call' && message.call?.callId === callId) || null;
}

async function callState(token, chatId) {
  const res = await api('GET', `/api/calls/state?chatId=${chatId}`, { token });
  return { status: res.status, call: res.body?.call ?? null };
}

/** Join a room from a socket, returning the call:joined payload or the error. */
async function joinRoom(socket, payload, timeoutMs = 6000) {
  const joined = waitFor(socket, 'call:joined', timeoutMs);
  const errored = waitFor(socket, 'call:error', timeoutMs);
  socket.emit('call:join', payload);
  const result = await Promise.race([
    joined.then((value) => (value ? { joined: value } : null)),
    errored.then((value) => (value ? { error: value } : null)),
  ]);
  return result;
}

async function acceptRoom(socket, payload, timeoutMs = 6000) {
  const joined = waitFor(socket, 'call:joined', timeoutMs);
  const errored = waitFor(socket, 'call:error', timeoutMs);
  socket.emit('call:accept', payload);
  return Promise.race([
    joined.then((value) => (value ? { joined: value } : null)),
    errored.then((value) => (value ? { error: value } : null)),
  ]);
}

async function leaveRoom(socketList, callId) {
  for (const socket of socketList) socket.emit('call:end', { callId, reason: 'hangup' });
  await pause(400);
}

async function main() {
  console.log(`\ncall-room integration test against ${BASE}\n`);

  // ---------------------------------------------------------------- setup
  const unauth = await api('GET', '/api/calls/ice');
  check('ICE config requires auth -> 401', unauth.status === 401, `${unauth.status}`);

  const a = await register('alice');
  const b = await register('bob');
  const c = await register('carol');
  const d = await register('dave');
  const stranger = await register('stranger');
  const extras = [];
  for (let i = 1; i <= 9; i += 1) extras.push(await register(`extra${i}`));

  const ice = await api('GET', '/api/calls/ice', { token: a.token });
  check('ICE config loads', ice.status === 200, `${ice.status}`);
  check(
    'ICE config has STUN servers',
    Array.isArray(ice.body?.iceServers) && ice.body.iceServers.length >= 1,
  );

  const groupName = `Call group ${run}`;
  const smallGroupId = await createGroup(a.token, groupName, [b.id, c.id]);
  check('setup: group chat with 3 members', Boolean(smallGroupId), String(smallGroupId));

  // Ring-all + caps group: 13 members (> the 6 video slots, = audio cap + 1).
  const capGroupId = await createGroup(a.token, `Cap group ${run}`, [
    b.id,
    c.id,
    d.id,
    ...extras.map((user) => user.id),
  ]);
  check('setup: 13-member group for ring-all and caps', Boolean(capGroupId), String(capGroupId));

  const directAD = await createDirect(a.token, d.id);
  const directBD = await createDirect(b.token, d.id);
  check('setup: direct chats', Boolean(directAD) && Boolean(directBD));

  const sa = await connect(a.token);
  const sb = await connect(b.token);
  const sc = await connect(c.token);
  const sd = await connect(d.token);
  const sStranger = await connect(stranger.token);
  const sExtras = [];
  for (const extra of extras) sExtras.push(await connect(extra.token));
  await pause(500);

  const byId = new Map([
    [a.id, sa],
    [b.id, sb],
    [c.id, sc],
    [d.id, sd],
    ...extras.map((extra, index) => [extra.id, sExtras[index]]),
  ]);

  // ---------------------------------------- 1. group room lifecycle + card
  const callId = `call-${run}-group`;
  const incomingB = waitFor(sb, 'call:incoming');
  const incomingC = waitFor(sc, 'call:incoming');
  const ringingA = waitFor(sa, 'call:ringing');
  const roomAtStart = waitFor(sc, 'call:room');
  const cardMessage = waitFor(sc, 'message:new');
  sa.emit('call:start', { callId, chatId: smallGroupId, video: true });

  const [ring, inB, inC, roomStart, cardMsg] = await Promise.all([
    ringingA,
    incomingB,
    incomingC,
    roomAtStart,
    cardMessage,
  ]);
  check('caller gets call:ringing', Boolean(ring), JSON.stringify(ring)?.slice(0, 160));
  check('ringing marks a group call', ring?.isGroup === true);
  check('ringing carries the video flag', ring?.video === true);
  check('ringing reports how many were rung', ring?.ringCount === 2, String(ring?.ringCount));
  check('ringing carries startedAt', Boolean(ring?.startedAt));
  check('ringing carries the call card id', Boolean(ring?.cardMessageId));
  check('ringing lists the room participants', ring?.participants?.length === 1);
  check('all online group members are rung', Boolean(inB) && Boolean(inC));
  check('incoming is marked as a group call', inB?.isGroup === true);
  check('incoming carries the group title', String(inB?.title).includes('Call group'), inB?.title);
  check('incoming carries the caller', String(inB?.from?.id) === String(a.id));
  check('incoming carries the same card id as the caller', inB?.cardMessageId === ring?.cardMessageId);
  check('incoming reports this call type capacity', inB?.capacity === 12 && inB?.videoCapacity === 6, `${inB?.capacity}/${inB?.videoCapacity}`);
  check('incoming does not pre-create an SDP', inB?.sdp === undefined);

  check('a call card message is created in the chat', cardMsg?.type === 'call', cardMsg?.type);
  check('the card belongs to this call', cardMsg?.call?.callId === callId);
  check(
    'the card says who started the call and offers Join / Decline',
    String(cardMsg?.content).includes('started by') && String(cardMsg?.content).includes('Join / Decline'),
    cardMsg?.content,
  );
  check('the card is already visible to every group member', cardMsg?.deliveredTo?.length === 3 && cardMsg?.readBy?.length === 3, `${cardMsg?.deliveredTo?.length}/${cardMsg?.readBy?.length}`);
  check('call:room reaches the chat at start', roomStart?.callId === callId && roomStart?.state === 'ringing');
  check('call:room is joinable at start', roomStart?.joinable === true);

  // b accepts -> gets the people already in the call, then offers to them
  const joinedB = waitFor(sb, 'call:joined');
  const participantJoinedA = waitFor(sa, 'call:participant-joined');
  const cardUpdate = waitFor(sa, 'call:card-updated');
  sb.emit('call:accept', { callId });
  const [joinB, pJoinedA, ongoingCard] = await Promise.all([joinedB, participantJoinedA, cardUpdate]);
  check('accepting yields call:joined', Boolean(joinB));
  check('joined lists the people already in the call', joinB?.participants?.length === 1);
  check('existing participant is the caller', String(joinB?.participants?.[0]?.id) === String(a.id));
  check('joined carries startedAt for the real duration', Boolean(joinB?.startedAt));
  check('the caller is told someone joined', String(pJoinedA?.participant?.id) === String(b.id));
  check('the card updates to Ongoing when someone joins', ongoingCard?.call?.state === 'active', JSON.stringify(ongoingCard?.call)?.slice(0, 120));

  const offerA = waitFor(sa, 'call:offer');
  sb.emit('call:offer', { callId, toUserId: a.id, sdp: { type: 'offer', sdp: 'v=0-b-to-a' } });
  const offerPayload = await offerA;
  check('group offer reaches the other participant', offerPayload?.sdp?.sdp === 'v=0-b-to-a');
  check('group offer identifies the sender', String(offerPayload?.from?.id) === String(b.id));

  const answerB = waitFor(sb, 'call:answer');
  sa.emit('call:answer', { callId, toUserId: b.id, sdp: { type: 'answer', sdp: 'v=0-a-to-b' } });
  check('group answer is routed back to the offerer', (await answerB)?.sdp?.sdp === 'v=0-a-to-b');

  const iceB = waitFor(sb, 'call:ice');
  sa.emit('call:ice', {
    callId,
    toUserId: b.id,
    candidate: { candidate: 'candidate:1 1 udp 1 127.0.0.1 5000 typ host' },
  });
  check('ICE candidate is relayed within the call', Boolean((await iceB)?.candidate?.candidate));

  // c joins LATE via a chatId (the path that did not exist before chunk 2:
  // c never has to keep the one-shot ring payload to be able to join).
  const joinedC = waitFor(sc, 'call:joined');
  const cJoinNotices = [
    waitFor(sa, 'call:participant-joined'),
    waitFor(sb, 'call:participant-joined'),
  ];
  sc.emit('call:join', { chatId: smallGroupId });
  const [joinC, noticeA, noticeB] = await Promise.all([joinedC, ...cJoinNotices]);
  check('a late joiner gets every existing participant', joinC?.participants?.length === 2, String(joinC?.participants?.length));
  check(
    'everyone is told about the late joiner',
    String(noticeA?.participant?.id) === String(c.id) && String(noticeB?.participant?.id) === String(c.id),
  );

  const stateForC = await callState(c.token, smallGroupId);
  check('the live room state API answers for a member', stateForC.status === 200, String(stateForC.status));
  check('the live room shows all participants', stateForC.call?.participants?.length === 3, String(stateForC.call?.participants?.length));
  check('the live room is joinable while under the cap', stateForC.call?.joinable === true);
  check('the live room exposes its card id', stateForC.call?.cardMessageId === ring?.cardMessageId);
  const statesForA = await api('GET', '/api/calls/state', { token: a.token });
  check(
    'the state API lists live rooms for the signed-in user',
    Array.isArray(statesForA.body?.calls) && statesForA.body.calls.some((room) => room.callId === callId),
  );
  const stateForStranger = await api('GET', `/api/calls/state?chatId=${smallGroupId}`, { token: stranger.token });
  check('a non-member cannot read the room state', stateForStranger.status === 403, String(stateForStranger.status));

  // c leaves; the call survives
  const leftC = waitFor(sa, 'call:participant-left');
  sc.emit('call:end', { callId, reason: 'hangup' });
  check('leaving a group call notifies the others', String((await leftC)?.userId) === String(c.id));
  const stateAfterC = await callState(a.token, smallGroupId);
  check('leaving does not end a multi-party room', stateAfterC.call?.state === 'active' && stateAfterC.call?.participants?.length === 2, JSON.stringify(stateAfterC.call)?.slice(0, 120));

  // a leaves; the room is still alive for b
  const leftA = waitFor(sb, 'call:participant-left');
  sa.emit('call:end', { callId, reason: 'hangup' });
  check('the second leave is announced too', String((await leftA)?.userId) === String(a.id));
  const stateAfterA = await callState(b.token, smallGroupId);
  check('the room lives while one participant remains', stateAfterA.call?.state === 'active' && stateAfterA.call?.participants?.length === 1);

  // last person leaves -> ended with duration
  const endedForB = waitFor(sb, 'call:ended');
  const finalRoom = waitFor(sb, 'call:room');
  sb.emit('call:end', { callId, reason: 'hangup' });
  const [endedB, finalRoomB] = await Promise.all([endedForB, finalRoom]);
  check('the last leave ends the room', endedB?.status === 'completed' && endedB?.reason === 'ended', `${endedB?.status}/${endedB?.reason}`);
  check('the ended event carries the duration', typeof endedB?.durationSeconds === 'number');
  check('the final room snapshot is ended', finalRoomB?.state === 'ended' && finalRoomB?.status === 'completed');
  check('the final room snapshot still counts everyone who joined', finalRoomB?.participantCount === 3, String(finalRoomB?.participantCount));
  check('the final room snapshot points at the card', Boolean(finalRoomB?.cardMessageId));
  const stateAfterEnd = await callState(b.token, smallGroupId);
  check('the state API clears after the room ends', stateAfterEnd.call === null);

  const historyA = await history(a.token);
  const rowA = historyRow(historyA, callId);
  check('history records the ended group call', Boolean(rowA), JSON.stringify(historyA.map((row) => row.callId)));
  check('history status is completed with a duration', rowA?.status === 'completed' && typeof rowA?.durationSeconds === 'number', `${rowA?.status}/${rowA?.durationSeconds}`);
  check('history marks the call as a group call', rowA?.isGroup === true);
  const finalCard = await cardFor(b.token, smallGroupId, callId);
  check('the call card is persisted in the chat', Boolean(finalCard));
  check('the persisted card is Ended', finalCard?.call?.state === 'ended' && finalCard?.call?.status === 'completed', JSON.stringify(finalCard?.call)?.slice(0, 120));
  check('the persisted card content says ended', String(finalCard?.content).toLowerCase().includes('ended'), finalCard?.content);
  check('the persisted card counts the people who joined', finalCard?.call?.participantCount === 3, String(finalCard?.call?.participantCount));

  // ------------------------ 2. ring reaches ALL online members past the cap
  const capCallId = `call-${run}-cap`;
  const capIncoming = [];
  for (const extra of extras) capIncoming.push(waitFor(byId.get(extra.id), 'call:incoming'));
  capIncoming.push(waitFor(sb, 'call:incoming'), waitFor(sc, 'call:incoming'), waitFor(sd, 'call:incoming'));
  const capRinging = waitFor(sa, 'call:ringing');
  sa.emit('call:start', { callId: capCallId, chatId: capGroupId, video: true });
  const capRing = await capRinging;
  const capIncomingPayloads = await Promise.all(capIncoming);
  check('a video room rings every online member, not capacity - 1', capRing?.ringCount === 12, String(capRing?.ringCount));
  check(
    'all 12 online members receive the incoming call',
    capIncomingPayloads.every((payload) => Boolean(payload)),
    capIncomingPayloads.map((payload) => Boolean(payload)).join(','),
  );

  // 6 camera slots: the caller + 5 joiners with video.
  const videoJoiners = [b, c, d, extras[0], extras[1]];
  for (const user of videoJoiners) {
    const result = await acceptRoom(byId.get(user.id), { callId: capCallId });
    check(`video participant ${user.id.slice(-4)} joins`, Boolean(result?.joined));
  }
  // The 7th camera participant is refused but may walk in audio-only.
  const seventhCamera = await joinRoom(byId.get(extras[2].id), { callId: capCallId });
  check('camera slots stop at 6', seventhCamera?.error?.code === 'CALL_FULL', JSON.stringify(seventhCamera?.error));
  check('the caller is told audio-only is still possible', seventhCamera?.error?.audioOnlyAvailable === true, JSON.stringify(seventhCamera?.error));
  const seventhAudio = await joinRoom(byId.get(extras[2].id), { callId: capCallId, audioOnly: true });
  check('a video call can be joined audio-only past 6', Boolean(seventhAudio?.joined), JSON.stringify(seventhAudio?.error));
  check('the audio-only join is marked audio-only', seventhAudio?.joined?.participants?.length === 6, String(seventhAudio?.joined?.participants?.length));

  const audioJoiners = [extras[3], extras[4], extras[5], extras[6], extras[7]];
  for (const user of audioJoiners) {
    const result = await joinRoom(byId.get(user.id), { callId: capCallId, audioOnly: true });
    check(`audio-only participant ${user.id.slice(-4)} joins`, Boolean(result?.joined), JSON.stringify(result?.error));
  }
  const stateFull = await callState(a.token, capGroupId);
  check('the room is at the 12-person audio cap', stateFull.call?.participantCount === 12, String(stateFull.call?.participantCount));
  check('the room reports 6 camera participants', stateFull.call?.cameraCount === 6, String(stateFull.call?.cameraCount));
  check('a full room is not joinable', stateFull.call?.joinable === false);

  // The 13th person is refused (12 total is the honest mesh cap).
  const thirteenth = await joinRoom(byId.get(extras[8].id), { callId: capCallId, audioOnly: true });
  check('the audio cap of 12 is enforced', thirteenth?.error?.code === 'CALL_FULL', JSON.stringify(thirteenth?.error));
  check('a full audio room does not offer audio-only', thirteenth?.error?.audioOnlyAvailable === false, JSON.stringify(thirteenth?.error));

  // Authorisation: non-members and blocked users cannot join.
  const strangerJoin = await joinRoom(sStranger, { callId: capCallId });
  check('a non-member cannot join a group call', strangerJoin?.error?.code === 'CALL_FORBIDDEN', JSON.stringify(strangerJoin?.error));
  await api('POST', `/api/users/${extras[8].id}/block`, { token: a.token });
  const blockedJoin = await joinRoom(byId.get(extras[8].id), { callId: capCallId, audioOnly: true });
  check('a blocked user cannot join the call', blockedJoin?.error?.code === 'CALL_BLOCKED', JSON.stringify(blockedJoin?.error));
  await api('DELETE', `/api/users/${extras[8].id}/block`, { token: a.token });

  // Empty the room again (last leave ends it) so later sections have free users.
  const capJoined = [a, ...videoJoiners, extras[2], ...audioJoiners];
  for (const user of capJoined) {
    const socket = byId.get(user.id);
    if (socket) socket.emit('call:end', { callId: capCallId, reason: 'hangup' });
  }
  await pause(600);
  const capStateAfter = await callState(a.token, capGroupId);
  check('the capped room ends when everyone leaves', capStateAfter.call === null);

  // ---------------------------------- 3. missed for an invitee who never joined
  const missedGroupCall = `call-${run}-missedgroup`;
  const groupIncomingB = waitFor(sb, 'call:incoming');
  sa.emit('call:start', { callId: missedGroupCall, chatId: smallGroupId, video: false });
  await groupIncomingB;
  const bJoinedMissed = waitFor(sb, 'call:joined');
  sb.emit('call:accept', { callId: missedGroupCall });
  await bJoinedMissed;
  sb.emit('call:end', { callId: missedGroupCall, reason: 'hangup' });
  await pause(250);
  const endedGroup = waitFor(sa, 'call:ended');
  sa.emit('call:end', { callId: missedGroupCall, reason: 'hangup' });
  await endedGroup;
  const historyForC = await history(c.token);
  const missedRowC = historyRow(historyForC, missedGroupCall);
  check('a group member who never joined sees Missed', missedRowC?.status === 'missed', `${missedRowC?.status}`);
  check('the missed row says it was a group call', missedRowC?.isGroup === true);

  // ------------------------------------------ 4. 1:1 call outcomes (2C)
  // Declined
  const declinedCallId = `call-${run}-declined`;
  const declinedIncoming = waitFor(sd, 'call:incoming');
  const declinedCardUpdate = waitFor(sa, 'call:card-updated');
  sa.emit('call:start', { callId: declinedCallId, chatId: directAD, video: false });
  check('a direct call rings the other person', Boolean(await declinedIncoming));
  const declinedNotice = waitFor(sa, 'call:participant-declined');
  const declinedEnded = waitFor(sa, 'call:ended');
  sd.emit('call:decline', { callId: declinedCallId });
  const [declineNotice, declineEnd, declineCard] = await Promise.all([
    declinedNotice,
    declinedEnded,
    declinedCardUpdate,
  ]);
  check('declining is reported to the caller', String(declineNotice?.userId) === String(d.id));
  check('a declined 1:1 call ends as Declined', declineEnd?.status === 'declined' && declineEnd?.reason === 'declined', `${declineEnd?.status}/${declineEnd?.reason}`);
  check('the card updates to Declined', declineCard?.call?.status === 'declined', JSON.stringify(declineCard?.call)?.slice(0, 100));
  const declinedRow = historyRow(await history(a.token), declinedCallId);
  check('the declined call is stored in history', declinedRow?.status === 'declined', `${declinedRow?.status}`);
  const declinedCardMessage = await cardFor(a.token, directAD, declinedCallId);
  check('the declined card is persisted', String(declinedCardMessage?.content).toLowerCase().includes('declined'), declinedCardMessage?.content);

  // Cancelled (caller hangs up before anyone answers)
  const cancelledCallId = `call-${run}-cancelled`;
  const cancelledIncoming = waitFor(sd, 'call:incoming');
  sa.emit('call:start', { callId: cancelledCallId, chatId: directAD, video: false });
  await cancelledIncoming;
  const cancelledEnded = waitFor(sa, 'call:ended');
  sa.emit('call:end', { callId: cancelledCallId, reason: 'hangup' });
  const cancelledEnd = await cancelledEnded;
  check('a call cancelled before answer is Cancelled', cancelledEnd?.status === 'cancelled', `${cancelledEnd?.status}`);
  const cancelledRow = historyRow(await history(a.token), cancelledCallId);
  check('the cancelled call is stored as cancelled for the caller', cancelledRow?.status === 'cancelled', `${cancelledRow?.status}`);
  const cancelledIncomingRow = historyRow(await history(d.token), cancelledCallId);
  check('the callee sees the cancelled attempt as missed', cancelledIncomingRow?.status === 'missed', `${cancelledIncomingRow?.status}`);
  const cancelledCard = await cardFor(a.token, directAD, cancelledCallId);
  check('the cancelled card is persisted', String(cancelledCard?.content).toLowerCase().includes('cancelled'), cancelledCard?.content);

  // Failed to connect (ICE/media failure is never shown as "Call ended")
  const failedCallId = `call-${run}-failed`;
  const failedIncoming = waitFor(sd, 'call:incoming');
  sa.emit('call:start', { callId: failedCallId, chatId: directAD, video: false });
  await failedIncoming;
  const failedJoined = waitFor(sd, 'call:joined');
  sd.emit('call:accept', { callId: failedCallId });
  await failedJoined;
  const failedEnded = waitFor(sd, 'call:ended');
  sa.emit('call:failed', { callId: failedCallId, reason: 'ice' });
  const failedEnd = await failedEnded;
  check('an ICE failure ends as Failed to connect', failedEnd?.status === 'failed' && failedEnd?.reason === 'failed', `${failedEnd?.status}/${failedEnd?.reason}`);
  const failedRow = historyRow(await history(a.token), failedCallId);
  check('the failed call is stored as failed', failedRow?.status === 'failed', `${failedRow?.status}`);
  const failedCard = await cardFor(a.token, directAD, failedCallId);
  check('the failed card says Failed to connect, never Call ended', String(failedCard?.content).includes('Failed to connect') && !String(failedCard?.content).includes('Ended'), failedCard?.content);

  // Ended with duration
  const endedCallId = `call-${run}-ended`;
  const endedIncoming = waitFor(sd, 'call:incoming');
  sa.emit('call:start', { callId: endedCallId, chatId: directAD, video: false });
  await endedIncoming;
  const endedJoined = waitFor(sd, 'call:joined');
  sd.emit('call:accept', { callId: endedCallId });
  await endedJoined;
  await pause(700);
  const endedPayload = waitFor(sa, 'call:ended');
  sd.emit('call:end', { callId: endedCallId, reason: 'hangup' });
  const endedCall = await endedPayload;
  check('an answered call ends as completed', endedCall?.status === 'completed', `${endedCall?.status}`);
  check('the ended call has a real duration', (endedCall?.durationSeconds ?? 0) >= 1, String(endedCall?.durationSeconds));
  const endedRow = historyRow(await history(a.token), endedCallId);
  check('the completed call is stored with its duration', endedRow?.status === 'completed' && (endedRow?.durationSeconds ?? 0) >= 1, `${endedRow?.status}/${endedRow?.durationSeconds}`);
  const endedCard = await cardFor(a.token, directAD, endedCallId);
  check('the ended card shows Ended and the duration', String(endedCard?.content).includes('Ended'), endedCard?.content);

  // Busy: call a contact who is already in another call.
  const busyHoldingCall = `call-${run}-busyhold`;
  const busyHoldingIncoming = waitFor(sa, 'call:incoming');
  sd.emit('call:start', { callId: busyHoldingCall, chatId: directAD, video: false });
  await busyHoldingIncoming;
  const holdingJoined = waitFor(sd, 'call:joined');
  sa.emit('call:accept', { callId: busyHoldingCall });
  await holdingJoined;
  const busyEvent = waitFor(sb, 'call:busy');
  sb.emit('call:start', { callId: `call-${run}-busy`, chatId: directBD, video: false });
  check('calling someone already on a call reports Busy', Boolean(await busyEvent));
  const busyRow = historyRow(await history(b.token), `call-${run}-busy`);
  check('the busy attempt is stored for the caller', busyRow?.status === 'busy', `${busyRow?.status}`);
  const busyCard = await cardFor(b.token, directBD, `call-${run}-busy`);
  check('the busy card is persisted', String(busyCard?.content).toLowerCase().includes('busy'), busyCard?.content);
  const busyHoldingEnd = waitFor(sd, 'call:ended');
  sa.emit('call:end', { callId: busyHoldingCall, reason: 'hangup' });
  await busyHoldingEnd;

  // --------------------------------- 5. "Add participant" converts a 1:1 room
  const convertCallId = `call-${run}-convert`;
  const convertIncoming = waitFor(sd, 'call:incoming');
  sa.emit('call:start', { callId: convertCallId, chatId: directAD, video: true });
  await convertIncoming;
  const convertJoined = waitFor(sd, 'call:joined');
  sd.emit('call:accept', { callId: convertCallId });
  await convertJoined;
  const invitedNotice = waitFor(sd, 'call:participant-invited');
  const addedContactRung = waitFor(sb, 'call:incoming');
  sa.emit('call:add-participant', { callId: convertCallId, userId: b.id });
  const [bRungInConverted, invited] = await Promise.all([addedContactRung, invitedNotice]);
  check('the existing peer is told someone was invited', String(invited?.participant?.id) === String(b.id));
  check('the added contact is rung', Boolean(bRungInConverted));
  check('the added contact sees a group call', bRungInConverted?.isGroup === true);
  await pause(150);
  const convertedCard = await cardFor(a.token, directAD, convertCallId);
  check('the card shows the room is now a group call', convertedCard?.call?.isGroup === true, JSON.stringify(convertedCard?.call)?.slice(0, 120));
  const bJoinsConverted = await joinRoom(sb, { callId: convertCallId });
  check('the added contact can join the converted room', Boolean(bJoinsConverted?.joined), JSON.stringify(bJoinsConverted?.error));
  check('the added contact gets every existing peer', bJoinsConverted?.joined?.participants?.length === 2, String(bJoinsConverted?.joined?.participants?.length));
  const convertedState = await callState(a.token, directAD);
  check('the converted room is a live group room', convertedState.call?.isGroup === true && convertedState.call?.participantCount === 3, JSON.stringify(convertedState.call)?.slice(0, 120));
  // leaving does not end the converted room, and only the added member leaves
  sb.emit('call:end', { callId: convertCallId, reason: 'hangup' });
  await pause(300);
  const convertedStillLive = await callState(a.token, directAD);
  check('leaving a converted room does not end it', convertedStillLive.call?.state === 'active' && convertedStillLive.call?.participantCount === 2, JSON.stringify(convertedStillLive.call)?.slice(0, 120));
  const convertedEnd = waitFor(sd, 'call:ended');
  sa.emit('call:end', { callId: convertCallId, reason: 'hangup' });
  await pause(250);
  sd.emit('call:end', { callId: convertCallId, reason: 'hangup' });
  check('the converted call ends as completed', (await convertedEnd)?.status === 'completed');

  // Adding someone with no shared chat is refused.
  const strangerConvertCall = `call-${run}-stranger-add`;
  const strangerAddIncoming = waitFor(sd, 'call:incoming');
  sa.emit('call:start', { callId: strangerConvertCall, chatId: directAD, video: false });
  await strangerAddIncoming;
  const strangerAddJoined = waitFor(sd, 'call:joined');
  sd.emit('call:accept', { callId: strangerConvertCall });
  await strangerAddJoined;
  const strangerAddError = waitFor(sa, 'call:error');
  sa.emit('call:add-participant', { callId: strangerConvertCall, userId: stranger.id });
  check('adding a stranger is refused', (await strangerAddError)?.code === 'CALL_FORBIDDEN');
  const strangerConvertEnd = waitFor(sd, 'call:ended');
  sa.emit('call:end', { callId: strangerConvertCall, reason: 'hangup' });
  await strangerConvertEnd;

  // ----------------------- 6. screen share + camera-off + incoming-video-off
  const signalCallId = `call-${run}-signal`;
  const signalIncoming = waitFor(sb, 'call:incoming');
  sa.emit('call:start', { callId: signalCallId, chatId: smallGroupId, video: true });
  await signalIncoming;
  const signalJoined = waitFor(sb, 'call:joined');
  sb.emit('call:accept', { callId: signalCallId });
  await signalJoined;

  const screenSignal = waitFor(sb, 'call:signal');
  const screenState = waitFor(sb, 'call:participant-state');
  sa.emit('call:signal', {
    callId: signalCallId,
    toUserId: b.id,
    signal: { kind: 'screen', screenSharing: true, sharingKind: 'window', hasSystemAudio: true },
  });
  const [screenPayload, screenParticipant] = await Promise.all([screenSignal, screenState]);
  check('a "sharing their screen" signal is relayed', screenPayload?.signal?.screenSharing === true);
  check('the screen share says which kind of source is shared', screenPayload?.signal?.sharingKind === 'window');
  check('optional system audio is relayed', screenPayload?.signal?.hasSystemAudio === true);
  check('the peer state includes the screen share', screenParticipant?.participant?.screenSharing === true);
  check('the peer state says which track is shared', screenParticipant?.participant?.trackKind === 'video', JSON.stringify(screenParticipant?.participant));

  const cameraOffSignal = waitFor(sb, 'call:signal');
  sa.emit('call:signal', {
    callId: signalCallId,
    toUserId: b.id,
    signal: { kind: 'camera', cameraOn: false },
  });
  check('a camera-off signal is relayed', (await cameraOffSignal)?.signal?.cameraOn === false);

  const incomingVideoOff = waitFor(sb, 'call:signal');
  sa.emit('call:signal', {
    callId: signalCallId,
    toUserId: b.id,
    signal: { kind: 'incoming-video-off', off: true },
  });
  check('incoming-video-off is relayed', (await incomingVideoOff)?.signal?.off === true);

  // A late joiner must already see the camera-off + screen-share state.
  const lateJoiner = await joinRoom(sc, { chatId: smallGroupId });
  check('a late joiner receives the peer list with media state', Boolean(lateJoiner?.joined), JSON.stringify(lateJoiner?.error));
  const lateJoinedParticipants = lateJoiner?.joined?.participants || [];
  const callerEntry = lateJoinedParticipants.find((participant) => participant.id === a.id);
  check('the late joiner sees the camera-off state', callerEntry?.cameraOn === false, JSON.stringify(callerEntry));
  check('the late joiner sees the screen-share state', callerEntry?.screenSharing === true, JSON.stringify(callerEntry));
  check('the late joiner sees who shares and with system audio', callerEntry?.sharingKind === 'window' && callerEntry?.hasSystemAudio === true);

  // Screen share stop is relayed too.
  const screenStop = waitFor(sb, 'call:signal');
  sa.emit('call:signal', {
    callId: signalCallId,
    signal: { kind: 'screen', screenSharing: false },
  });
  check('stopping the screen share is relayed', (await screenStop)?.signal?.screenSharing === false);

  await leaveRoom([sa, sb, sc], signalCallId);
  const signalStateAfter = await callState(a.token, smallGroupId);
  check('the signal test room ended cleanly', signalStateAfter.call === null);

  // -------------------------------- 7. authorisation and legacy checks
  const outsiderStart = waitFor(sStranger, 'call:error');
  sStranger.emit('call:start', { callId: `call-${run}-x`, chatId: smallGroupId, video: false });
  check('a non-member cannot start a call in the chat', (await outsiderStart)?.code === 'CALL_FORBIDDEN');

  // Start a small room so an outsider can try to inject signalling.
  const authCallId = `call-${run}-auth`;
  const authIncoming = waitFor(sb, 'call:incoming');
  sa.emit('call:start', { callId: authCallId, chatId: smallGroupId, video: false });
  await authIncoming;
  const authJoined = waitFor(sb, 'call:joined');
  sb.emit('call:accept', { callId: authCallId });
  await authJoined;
  const outsiderOffer = waitFor(sStranger, 'call:error');
  sStranger.emit('call:offer', { callId: authCallId, toUserId: a.id, sdp: { type: 'offer', sdp: 'x' } });
  check('an outsider cannot inject signalling into a live call', (await outsiderOffer)?.code === 'CALL_FORBIDDEN');
  const busySelf = waitFor(sb, 'call:error');
  sb.emit('call:start', { callId: `call-${run}-busy-self`, chatId: smallGroupId, video: false });
  check('starting a second call while in one is refused', (await busySelf)?.code === 'CALL_BUSY');
  const authEnd = waitFor(sb, 'call:ended');
  sa.emit('call:end', { callId: authCallId, reason: 'hangup' });
  await pause(250);
  sb.emit('call:end', { callId: authCallId, reason: 'hangup' });
  check('the authorisation room ended', (await authEnd)?.status === 'completed');

  // Offline callee: the caller sees unavailable and the attempt is stored as missed.
  sd.disconnect();
  await pause(500);
  const unavailable = waitFor(sa, 'call:unavailable');
  const offlineCallId = `call-${run}-offline`;
  sa.emit('call:start', { callId: offlineCallId, chatId: directAD, video: false });
  check('calling an offline person reports unavailable', Boolean(await unavailable));
  const offlineRow = historyRow(await history(a.token), offlineCallId);
  check('an unanswered offline call is stored as missed', offlineRow?.status === 'missed', `${offlineRow?.status}`);
  const offlineCard = await cardFor(a.token, directAD, offlineCallId);
  check('the offline attempt has a Missed card', String(offlineCard?.content).toLowerCase().includes('missed'), offlineCard?.content);

  // ------------------------------- 8. teardown local test accounts/data
  for (const socket of sockets) {
    try {
      socket.disconnect();
    } catch {
      /* already gone */
    }
  }

  try {
    await mongoose.connect(
      process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging',
      { serverSelectionTimeoutMS: 4000 },
    );
    const User = require('../../src/models/User');
    const Chat = require('../../src/models/Chat');
    const Message = require('../../src/models/Message');
    const CallLog = require('../../src/models/CallLog');
    const ids = [a, b, c, d, stranger, ...extras].map(
      (user) => new mongoose.Types.ObjectId(user.id),
    );
    const chats = await Chat.find({ participants: { $in: ids } }).select('_id');
    const chatIds = chats.map((chat) => chat._id);
    await Message.deleteMany({ chatId: { $in: chatIds } });
    await CallLog.deleteMany({ participants: { $in: ids } });
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
