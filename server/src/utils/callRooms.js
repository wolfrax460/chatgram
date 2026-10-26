/**
 * Call rooms: the bridge between the in-memory call registry, the persisted
 * call-card message and the realtime room state.
 *
 * Chunk 2 (server side) responsibilities:
 *  * one persisted Message (type 'call') per call with a live `call` metadata
 *    object — the group call card ("Group voice call started by X · Join /
 *    Decline" -> "Ongoing, N people, Join" -> "Ended · duration / Missed");
 *  * a `call:room` snapshot broadcast to the chat room (and to every participant
 *    and invitee) on start / join / leave / decline / end, plus on socket
 *    authenticate, so a member can always discover and join a live room —
 *    this is the piece that was missing when a third group member could not
 *    join;
 *  * `call:card-updated` for live card updates;
 *  * `call:ended` with a real outcome (completed / missed / declined / busy /
 *    failed / cancelled) once per room;
 *  * the single CallLog row per room (no media, SDP or ICE is ever written).
 */
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const realtime = require('./realtime');
const callRegistry = require('./callRegistry');
const { recordCall } = require('./callLog');

const PARTICIPANT_POPULATE = '_id displayName avatarUrl';

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

function modeOf(call) {
  return call.video ? 'video' : 'voice';
}

/** Copy of the room participants with their in-call media state. */
function participantsPublic(call) {
  // Ended cards show everyone who was ever in the room, not the (now empty)
  // live participant map, so "· 3 people · 5:32" survives the last leave.
  if (call.endedAt && call.everParticipants) {
    return [...call.everParticipants.values()].map((participant) => ({ ...participant }));
  }
  const list = [];
  for (const participant of call.participants.values()) {
    const media = participant.media || {};
    list.push({
      id: String(participant.id),
      displayName: participant.displayName || '',
      avatarUrl: participant.avatarUrl || null,
      audioOnly: media.audioOnly === true,
      muted: media.muted === true,
      cameraOn: media.cameraOn === true,
      screenSharing: media.screenSharing === true,
      ...(media.sharingKind ? { sharingKind: media.sharingKind } : {}),
      ...(media.trackKind ? { trackKind: media.trackKind } : {}),
      ...(media.hasSystemAudio ? { hasSystemAudio: true } : {}),
    });
  }
  return list;
}

function participantCountOf(call) {
  if (call.endedAt && call.everParticipants) return call.everParticipants.size;
  return call.participants.size;
}

function cameraCountOf(call) {
  let count = 0;
  for (const participant of participantsPublic(call)) {
    if (participant.audioOnly !== true) count += 1;
  }
  return count;
}

function durationOf(call) {
  if (!call.answeredAt || !call.endedAt) return 0;
  return Math.max(0, Math.round((call.endedAt - call.answeredAt) / 1000));
}

/** "5:32" under an hour, "1:02:03" above. */
function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const two = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(secs)}` : `${minutes}:${two(secs)}`;
}

function stateOf(call) {
  if (call.endedAt) return 'ended';
  return call.answeredAt ? 'active' : 'ringing';
}

function peopleLabel(count) {
  return `${count} ${count === 1 ? 'person' : 'people'}`;
}

/**
 * Human-readable card text. The web localises from the structured `call`
 * object; this text is the fallback (and what older clients show as a normal
 * bubble), so it always states the real outcome.
 */
function contentFor(call) {
  const kind = call.video ? 'video' : 'voice';
  const capKind = call.video ? 'Video' : 'Voice';
  const starter = call.initiatorPublic?.displayName || 'Someone';
  const count = participantCountOf(call);
  const group = call.isGroup === true;

  if (!call.endedAt) {
    if (group) {
      if (!call.answeredAt) return `Group ${kind} call started by ${starter} · Join / Decline`;
      return `Group ${kind} call · Ongoing · ${peopleLabel(count)} · Join`;
    }
    return call.answeredAt ? `${capKind} call · Ongoing` : `${capKind} call started`;
  }

  const duration = formatDuration(durationOf(call));
  if (call.status === 'completed') {
    return group
      ? `Group ${kind} call ended · ${peopleLabel(count)} · ${duration}`
      : `${capKind} call · Ended · ${duration}`;
  }
  const label = {
    missed: 'Missed',
    declined: 'Declined',
    busy: 'Busy',
    failed: 'Failed to connect',
    cancelled: 'Cancelled',
  }[call.status] || 'Ended';
  if (call.status === 'missed' && !group) return `Missed ${kind} call`;
  return group ? `Group ${kind} call · ${label}` : `${capKind} call · ${label}`;
}

/** The structured `message.call` object (persisted and sent as call:card-updated). */
function cardCall(call) {
  return {
    callId: call.callId,
    chatId: String(call.chatId),
    video: call.video === true,
    mode: modeOf(call),
    isGroup: call.isGroup === true,
    title: call.title || '',
    state: stateOf(call),
    status: call.status || 'ringing',
    startedBy: call.initiatorPublic
      ? {
          id: String(call.initiatorPublic.id),
          displayName: call.initiatorPublic.displayName || '',
          avatarUrl: call.initiatorPublic.avatarUrl || null,
        }
      : null,
    startedAt: iso(call.createdAt),
    answeredAt: iso(call.answeredAt),
    endedAt: iso(call.endedAt),
    durationSeconds: durationOf(call),
    participantCount: participantCountOf(call),
    participants: participantsPublic(call),
    capacity: call.capacity,
    videoCapacity: call.videoCapacity,
    cameraCount: cameraCountOf(call),
    endReason: call.endReason || null,
  };
}

/** The `call:room` snapshot (banner + live state; also served by GET /api/calls/state). */
function roomSnapshot(call) {
  const card = cardCall(call);
  return {
    ...card,
    // The persisted card message id (the card itself does not need to reference
    // its own id, so it only lives on the room snapshot).
    cardMessageId: call.cardMessageId ? String(call.cardMessageId) : null,
    inviteeCount: call.invitees ? call.invitees.size : card.participantCount,
    joinable: !call.endedAt && call.participants.size < call.capacity,
  };
}

/** Snapshot for a chat with no live room, so clients can clear their banner. */
function emptyRoom(chatId) {
  return {
    chatId: String(chatId),
    callId: null,
    state: 'ended',
    status: null,
    video: false,
    mode: 'voice',
    isGroup: false,
    title: '',
    startedBy: null,
    startedAt: null,
    answeredAt: null,
    endedAt: null,
    durationSeconds: 0,
    participants: [],
    participantCount: 0,
    inviteeCount: 0,
    capacity: callRegistry.CAPS.audio,
    videoCapacity: 0,
    cameraCount: 0,
    cardMessageId: null,
    endReason: null,
    joinable: false,
  };
}

/** Everyone who must hear about this room: people in it and people rung/added. */
function audienceIds(call) {
  const ids = new Set([...call.participants.keys()]);
  for (const id of call.invitees || []) ids.add(String(id));
  return [...ids];
}

/** Broadcast a fresh room snapshot (chat room + each participant/invitee). */
function broadcastRoom(call) {
  const io = realtime.getIo();
  if (!io || !call) return null;
  const snapshot = roomSnapshot(call);
  let emitter = io.to(realtime.roomForChat(call.chatId));
  for (const userId of audienceIds(call)) emitter = emitter.to(realtime.roomForUser(userId));
  emitter.emit('call:room', snapshot);
  return snapshot;
}

function broadcastCardUpdate(call, payload) {
  if (!call) return;
  realtime.emitToChat(call.chatId, 'call:card-updated', payload);
}

/** Serialise card writes per room so a fast join/leave cannot lose a write. */
function queueCardWrite(call, work) {
  const previous = call.__cardChain || Promise.resolve();
  const next = previous.then(work, work);
  call.__cardChain = next.catch(() => {});
  return next;
}

/**
 * Create the persisted call card message and put it in the chat.
 * deliveredTo/readBy are every chat participant, so a call card never raises an
 * unread badge by itself (the ring/overlay is the alert).
 */
async function createCallCard(call, chat) {
  const content = contentFor(call);
  const callData = cardCall(call);
  const deliveredTo = (chat.participants || []).map((id) => id);
  const message = await Message.create({
    chatId: call.chatId,
    senderId: call.initiatorId,
    type: 'call',
    content,
    sentAt: new Date(),
    deliveredTo: [...deliveredTo],
    readBy: [...deliveredTo],
    call: callData,
  });
  call.cardMessageId = String(message._id);
  await Chat.findByIdAndUpdate(call.chatId, { lastMessage: message._id, updatedAt: new Date() });
  const populated = await Message.findById(message._id).populate('senderId', PARTICIPANT_POPULATE);
  realtime.emitToChat(call.chatId, 'message:new', populated);
  return message;
}

/** Update the persisted card text + metadata and tell the chat about it. */
async function updateCallCard(call) {
  if (!call || !call.cardMessageId) return null;
  return queueCardWrite(call, async () => {
    const content = contentFor(call);
    const callData = cardCall(call);
    const updated = await Message.findByIdAndUpdate(
      call.cardMessageId,
      { $set: { content, call: callData } },
      { returnDocument: 'after' },
    );
    if (!updated) return null;
    const payload = {
      chatId: String(call.chatId),
      messageId: String(updated._id),
      call: callData,
      content,
    };
    broadcastCardUpdate(call, payload);
    return payload;
  });
}

/**
 * Finish a room exactly once: persist the outcome (CallLog), freeze the card
 * ("Ended · duration" / "Missed" / "Declined" / "Busy" / "Failed to connect" /
 * "Cancelled"), broadcast the final room state and tell every participant and
 * invitee with `call:ended`. Never shown as "Call ended" for a failed call.
 */
async function endCallRoom(call, { status, reason } = {}) {
  if (!call || call.__ended) return null;
  call.__ended = true;

  const answered = Boolean(call.answeredAt);
  const finalStatus = status || (answered ? 'completed' : 'missed');
  const finalReason = reason || (finalStatus === 'completed' ? 'ended' : finalStatus);
  callRegistry.recordEnd(call.callId, { status: finalStatus, reason: finalReason });
  call.status = finalStatus;
  call.endReason = finalReason;
  if (!call.endedAt) call.endedAt = Date.now();

  const durationSeconds = durationOf(call);
  const audience = audienceIds(call);
  callRegistry.destroy(call.callId);

  await updateCallCard(call);
  broadcastRoom(call);
  for (const userId of audience) {
    realtime.emitToUser(userId, 'call:ended', {
      callId: call.callId,
      chatId: String(call.chatId),
      reason: finalReason,
      status: finalStatus,
      durationSeconds,
      participants: participantsPublic(call),
    });
  }
  await recordCall(call, { status: finalStatus });
  return call;
}

/**
 * A call that never became a room (callee busy, everyone offline) still needs a
 * CallLog row and a card that says the right thing. No registry entry, no media.
 */
async function persistFinishedCall({
  initiator,
  chat,
  callId,
  video = false,
  isGroup = false,
  title = '',
  status = 'missed',
  invitees = [],
  busyBy = [],
}) {
  const createdAt = Date.now();
  const call = {
    callId: String(callId || `call-${createdAt.toString(36)}`),
    chatId: String(chat._id),
    video: video === true,
    isGroup: isGroup === true,
    title: title || '',
    initiatorId: String(initiator.id),
    initiatorPublic: {
      id: String(initiator.id),
      displayName: initiator.displayName || '',
      avatarUrl: initiator.avatarUrl || null,
    },
    createdAt,
    answeredAt: null,
    endedAt: createdAt,
    capacity: callRegistry.CAPS.audio,
    videoCapacity: video ? callRegistry.CAPS.video : 0,
    status,
    endReason: status,
    cardMessageId: null,
    participants: new Map([
      [
        String(initiator.id),
        {
          id: String(initiator.id),
          displayName: initiator.displayName || '',
          avatarUrl: initiator.avatarUrl || null,
          joinedAt: createdAt,
          media: { audioOnly: false, muted: false, cameraOn: video === true, screenSharing: false },
        },
      ],
    ]),
    invitees: new Set([String(initiator.id), ...invitees.map(String)]),
    answeredBy: new Set(),
    declinedBy: new Set(),
    busyBy: new Set(busyBy.map(String)),
    failedBy: new Set(),
    __ended: true,
  };
  const card = await createCallCard(call, chat);
  call.cardMessageId = card ? String(card._id) : null;
  await recordCall(call, { status });
  return call;
}

module.exports = {
  PARTICIPANT_POPULATE,
  formatDuration,
  contentFor,
  cardCall,
  roomSnapshot,
  emptyRoom,
  participantsPublic,
  audienceIds,
  broadcastRoom,
  updateCallCard,
  createCallCard,
  endCallRoom,
  persistFinishedCall,
};
