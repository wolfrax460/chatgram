/**
 * In-memory registry of live call rooms.
 *
 * The server never touches media — it only tracks who is in which room so that
 * signalling (SDP/ICE) can be routed between the right peers, and so an
 * unauthenticated or uninvolved socket cannot inject anything into a call.
 *
 * Chunk 2 additions:
 *  * a room is a real room, not a pair: every group member is an invitee from
 *    the start, members who were offline (or who missed the ring) can join
 *    later with `call:join`, and adding someone converts a 1:1 room into a
 *    group room (same call object, `isGroup` flips to true);
 *  * caps are honest mesh caps: 12 people total for both audio and video, but
 *    only 6 of them may send camera video in a video room. Past 6 camera slots
 *    a video room can still be joined audio-only;
 *  * each participant carries the in-call media state (muted / cameraOn /
 *    screenSharing / sharingKind / hasSystemAudio) so a late joiner already
 *    sees "camera off" / "sharing" before the first frame arrives;
 *  * the end of a room records a status (completed / missed / declined / busy /
 *    failed / cancelled) and a reason, so call logs and call cards can tell the
 *    outcomes apart.
 *
 * Calls are ephemeral: a restart drops them, which is acceptable because media
 * is peer-to-peer and a call cannot survive the signalling server going away.
 * Every ended call is written to the CallLog collection by the socket layer.
 */

/**
 * Honest mesh limits. A full mesh needs one peer connection per remote person,
 * so a video room is capped much lower than an audio room: 6 camera slots
 * (15 connections for the camera senders) and 12 people total (66
 * connections). Beyond this a media server (SFU) is required.
 */
const CAPS = { video: 6, audio: 12 };
/** Kept for older callers; the effective video cap depends on the room type. */
const MAX_PARTICIPANTS = CAPS.video;
/** Abandoned calls are pruned so a crashed client cannot leak memory forever. */
const MAX_AGE_MS = 4 * 60 * 60 * 1000;
/** A call nobody answers is reported as missed after this long. */
const RING_TIMEOUT_MS = 45_000;

/** Effective ring timeout (env override mainly lets staging prove the missed path fast). */
function ringTimeoutMs() {
  return Number(process.env.CALL_RING_TIMEOUT_MS || RING_TIMEOUT_MS);
}

const STATUSES = ['ringing', 'completed', 'missed', 'declined', 'busy', 'failed', 'cancelled'];

/** callId -> call */
const calls = new Map();

function now() {
  return Date.now();
}

function capacityFor(video) {
  // Legacy helper: the number of *camera* seats for a video room, or the total
  // seats for an audio room. Room objects expose the total cap in `.capacity`
  // (always 12) and the camera seats in `.videoCapacity`.
  return video ? CAPS.video : CAPS.audio;
}

function videoCapacityFor(video) {
  return video ? CAPS.video : 0;
}

function prune(nowMs = now()) {
  for (const [callId, call] of calls) {
    if (nowMs - call.createdAt > MAX_AGE_MS) calls.delete(callId);
  }
}

function normalizeUser(user = {}) {
  return {
    id: String(user.id || user._id || ''),
    displayName: user.displayName || '',
    avatarUrl: user.avatarUrl || null,
  };
}

/** Default media state for a participant who just joined. */
function defaultMedia(audioOnly, video) {
  return {
    audioOnly: audioOnly === true,
    muted: false,
    cameraOn: Boolean(video) && audioOnly !== true,
    screenSharing: false,
    sharingKind: null,
    /** Which of the participant's tracks is being shared ('video' for a screen). */
    trackKind: null,
    hasSystemAudio: false,
  };
}

/** Public shape of one participant (media state included). */
function publicParticipant(participant) {
  if (!participant) return null;
  const media = participant.media || {};
  return {
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
  };
}

function cameraCount(call) {
  let count = 0;
  for (const participant of call.participants.values()) {
    if (participant.media?.audioOnly !== true) count += 1;
  }
  return count;
}

function create({
  callId,
  chatId,
  video = false,
  isGroup = false,
  title = '',
  initiator,
  invitees = [],
}) {
  prune();
  const id = String(callId || '').trim();
  if (!id) return { ok: false, error: 'A call id is required.', code: 'CALL_INVALID' };
  if (calls.has(id)) return { ok: false, error: 'That call already exists.', code: 'CALL_DUPLICATE' };

  const me = normalizeUser(initiator);
  if (!me.id) return { ok: false, error: 'A caller is required.', code: 'CALL_INVALID' };
  if (findCallForUser(me.id)) {
    return { ok: false, error: 'You are already in a call.', code: 'CALL_BUSY' };
  }

  const call = {
    callId: id,
    chatId: String(chatId),
    video: video === true,
    isGroup: isGroup === true,
    title,
    initiatorId: me.id,
    /** Kept so the card / ended payload still names the starter after they leave. */
    initiatorPublic: { ...me },
    createdAt: now(),
    answeredAt: null,
    endedAt: null,
    capacity: CAPS.audio,
    videoCapacity: videoCapacityFor(video === true),
    status: 'ringing',
    endReason: null,
    cardMessageId: null,
    participants: new Map([
      [me.id, { ...me, joinedAt: now(), media: defaultMedia(false, video === true) }],
    ]),
    /**
     * Everyone who was ever in the room (public snapshots). Kept after a person
     * leaves so an ended card can still say "· 3 people · 5:32" and list them.
     */
    everParticipants: new Map([
      [me.id, publicParticipant({ id: me.id, displayName: me.displayName, avatarUrl: me.avatarUrl, media: defaultMedia(false, video === true) })],
    ]),
    /** Everyone authorised to join (rung at start, or added later). */
    invitees: new Set([me.id, ...invitees.map((u) => String(u))]),
    answeredBy: new Set(),
    declinedBy: new Set(),
    busyBy: new Set(),
    failedBy: new Set(),
  };
  calls.set(id, call);
  return { ok: true, call };
}

function get(callId) {
  return calls.get(String(callId || '')) || null;
}

/** The live room for a chat, if any. */
function findCallForChat(chatId) {
  const id = String(chatId || '');
  for (const call of calls.values()) {
    if (call.chatId === id) return call;
  }
  return null;
}

function activeCalls() {
  return [...calls.values()];
}

function findCallForUser(userId) {
  const id = String(userId || '');
  for (const call of calls.values()) {
    if (call.participants.has(id)) return call;
  }
  return null;
}

/** True when the user was rung / added to a room but is not in it. */
function isInvitee(callId, userId) {
  const call = get(callId);
  return Boolean(call && call.invitees.has(String(userId)));
}

function isParticipant(callId, userId) {
  const call = get(callId);
  return Boolean(call && call.participants.has(String(userId)));
}

/** Participant list (media state included). */
function participants(callId) {
  const call = get(callId);
  if (!call) return [];
  return [...call.participants.values()].map(publicParticipant);
}

function capacity(callId) {
  const call = get(callId);
  return call ? call.capacity : 0;
}

/** Add a person to the authorised set (add-participant / late ring). */
function addInvitee(callId, user) {
  const call = get(callId);
  if (!call) return null;
  const me = normalizeUser(user);
  if (!me.id) return null;
  call.invitees.add(me.id);
  return me;
}

/**
 * Turn a 1:1 room into a group room. The callId and the people already in it
 * stay exactly as they are; only the semantics (isGroup, title, capacity) change,
 * which is why an in-progress call is not interrupted by "add participant".
 */
function convertToGroup(callId, { title = 'Group call' } = {}) {
  const call = get(callId);
  if (!call) return null;
  if (!call.isGroup) {
    call.isGroup = true;
    call.title = title || 'Group call';
    call.videoCapacity = videoCapacityFor(call.video);
  }
  return call;
}

/**
 * Join a room. The caller (socket layer) has already checked chat membership /
 * block rules; this function owns the honest mesh caps.
 *
 * Caps: 12 people total in any room. In a video room only 6 people may send
 * camera video; past that the room can still be joined audio-only.
 */
function join(callId, user, options = {}) {
  const call = get(callId);
  if (!call) return { ok: false, error: 'This call has ended.', code: 'CALL_GONE' };

  const me = normalizeUser(user);
  if (!me.id) return { ok: false, error: 'A participant is required.', code: 'CALL_INVALID' };
  if (call.participants.has(me.id)) {
    return {
      ok: true,
      call,
      participant: publicParticipant(call.participants.get(me.id)),
      existing: participants(callId).filter((p) => p.id !== me.id),
      rejoin: true,
    };
  }
  // Only a person who was actually rung or explicitly added may join. The
  // socket layer additionally checks group membership and blocking; this is the
  // registry-level invariant that keeps an outsider out even if it is bypassed.
  if (!call.invitees.has(me.id)) {
    return { ok: false, error: 'You were not invited to this call.', code: 'CALL_FORBIDDEN' };
  }

  const total = call.participants.size;
  const wantsCamera = call.video && options.audioOnly !== true;
  const cameraSlots = call.video ? CAPS.video : 0;
  const usedCameraSlots = cameraCount(call);

  if (total >= CAPS.audio) {
    return {
      ok: false,
      error: `This call is full (up to ${CAPS.audio} people).`,
      code: 'CALL_FULL',
      capacity: CAPS.audio,
      videoCapacity: call.videoCapacity,
      audioOnlyAvailable: false,
    };
  }
  if (wantsCamera && usedCameraSlots >= cameraSlots) {
    return {
      ok: false,
      error: `Video is limited to ${CAPS.video} people on this connection technology. Join with audio only, or ask someone to leave.`,
      code: 'CALL_FULL',
      capacity: CAPS.audio,
      videoCapacity: call.videoCapacity,
      audioOnlyAvailable: total < CAPS.audio,
    };
  }

  const audioOnly = call.video ? options.audioOnly === true : true;
  const existing = participants(callId);
  const participant = {
    ...me,
    joinedAt: now(),
    media: defaultMedia(audioOnly, call.video),
  };
  call.participants.set(me.id, participant);
  call.answeredBy.add(me.id);
  if (!call.answeredAt) call.answeredAt = now();
  const publicNow = publicParticipant(participant);
  if (call.everParticipants) call.everParticipants.set(me.id, publicNow);
  return { ok: true, call, participant: publicNow, existing, rejoin: false };
}

/** Record that someone who was rung said no. */
function markDeclined(callId, userId) {
  const call = get(callId);
  if (!call) return null;
  call.declinedBy.add(String(userId));
  return call;
}

/** Record that someone who was rung was already on another call. */
function markBusy(callId, userId) {
  const call = get(callId);
  if (!call) return null;
  call.busyBy.add(String(userId));
  return call;
}

/** Record that someone's media connection failed (ICE/media failure). */
function markFailed(callId, userId) {
  const call = get(callId);
  if (!call) return null;
  call.failedBy.add(String(userId));
  return call;
}

/** Mark the call as finished (does not remove it; the room helper destroys it). */
function markEnded(callId) {
  const call = get(callId);
  if (!call) return null;
  if (!call.endedAt) call.endedAt = now();
  return call;
}

/** Record the final outcome of a room (single value, first writer wins). */
function recordEnd(callId, { status, reason } = {}) {
  const call = get(callId);
  if (!call) return null;
  if (!call.endedAt) call.endedAt = now();
  if (status && STATUSES.includes(status) && status !== 'ringing') call.status = status;
  if (reason) call.endReason = reason;
  return call;
}

function leave(callId, userId) {
  const call = get(callId);
  if (!call) return { call: null, destroyed: false, removed: false };
  const removed = call.participants.delete(String(userId));
  if (call.participants.size === 0) {
    calls.delete(call.callId);
    return { call, destroyed: true, removed };
  }
  return { call, destroyed: false, removed };
}

function removeUserFromAll(userId) {
  const id = String(userId || '');
  const affected = [];
  for (const call of [...calls.values()]) {
    if (!call.participants.has(id)) continue;
    const result = leave(call.callId, id);
    affected.push({ call: result.call, destroyed: result.destroyed });
  }
  return affected;
}

/** Calls that are still ringing past the timeout (nobody else ever joined). */
function expiredRings(nowMs = now(), timeoutMs = ringTimeoutMs()) {
  return [...calls.values()].filter((call) => !call.answeredAt && nowMs - call.createdAt > timeoutMs);
}

function destroy(callId) {
  calls.delete(String(callId || ''));
}

/** Update one participant's in-call media state; returns the public participant. */
function setMediaState(callId, userId, patch = {}) {
  const call = get(callId);
  if (!call) return null;
  const participant = call.participants.get(String(userId));
  if (!participant) return null;
  const next = { ...participant.media, ...patch };
  // An audio-only seat cannot claim a camera; the cap counts camera seats at
  // join time and a stray "camera on" must not make the state lie.
  if (next.audioOnly === true) next.cameraOn = false;
  participant.media = next;
  // The audio-only seat is decided when joining; turning the camera off does
  // not free a camera slot (it can be turned back on again).
  const publicNow = publicParticipant(participant);
  if (call.everParticipants) call.everParticipants.set(String(userId), publicNow);
  return publicNow;
}

/** Test/debug helper. */
function reset() {
  calls.clear();
}

function stats() {
  return {
    calls: calls.size,
    caps: { ...CAPS },
    participants: [...calls.values()].reduce((total, call) => total + call.participants.size, 0),
  };
}

module.exports = {
  CAPS,
  MAX_PARTICIPANTS,
  MAX_AGE_MS,
  RING_TIMEOUT_MS,
  ringTimeoutMs,
  STATUSES,
  capacityFor,
  videoCapacityFor,
  create,
  get,
  findCallForChat,
  activeCalls,
  findCallForUser,
  isInvitee,
  isParticipant,
  participants,
  publicParticipant,
  cameraCount,
  capacity,
  addInvitee,
  convertToGroup,
  join,
  markDeclined,
  markBusy,
  markFailed,
  markEnded,
  recordEnd,
  leave,
  removeUserFromAll,
  expiredRings,
  destroy,
  setMediaState,
  reset,
  stats,
  prune,
};
