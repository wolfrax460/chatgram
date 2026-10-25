/**
 * In-memory registry of live calls.
 *
 * The server never touches media — it only tracks who is in which call so that
 * signalling (SDP/ICE) can be routed between the right peers, and so an
 * unauthenticated or uninvolved socket cannot inject anything into a call.
 *
 * Calls are ephemeral: a restart drops them, which is acceptable because media
 * is peer-to-peer and a call cannot survive the signalling server going away.
 * Every ended call is written to the CallLog collection by the socket layer.
 */

/**
 * Honest mesh limits. A full mesh needs one peer connection per remote person,
 * so video is capped much lower than audio: 6 video (15 connections) and 12
 * audio-only (66 connections). Beyond this a media server (SFU) is required.
 */
const CAPS = { video: 6, audio: 12 };
/** Kept for older callers; the effective cap depends on the call type. */
const MAX_PARTICIPANTS = CAPS.video;
/** Abandoned calls are pruned so a crashed client cannot leak memory forever. */
const MAX_AGE_MS = 4 * 60 * 60 * 1000;
/** A call nobody answers is reported as missed after this long. */
const RING_TIMEOUT_MS = 45_000;

/** callId -> call */
const calls = new Map();

function now() {
  return Date.now();
}

function capacityFor(video) {
  return video ? CAPS.video : CAPS.audio;
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

function create({ callId, chatId, video = false, isGroup = false, title = '', initiator, invitees = [] }) {
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
    createdAt: now(),
    answeredAt: null,
    endedAt: null,
    capacity: capacityFor(video === true),
    participants: new Map([[me.id, { ...me, joinedAt: now() }]]),
    /** Everyone rung when the call started; used to authorise `call:accept`. */
    invitees: new Set([me.id, ...invitees.map((u) => String(u))]),
    answeredBy: new Set(),
    declinedBy: new Set(),
  };
  calls.set(id, call);
  return { ok: true, call };
}

function get(callId) {
  return calls.get(String(callId || '')) || null;
}

function findCallForUser(userId) {
  const id = String(userId || '');
  for (const call of calls.values()) {
    if (call.participants.has(id)) return call;
  }
  return null;
}

function isParticipant(callId, userId) {
  const call = get(callId);
  return Boolean(call && call.participants.has(String(userId)));
}

function participants(callId) {
  const call = get(callId);
  if (!call) return [];
  return [...call.participants.values()].map(({ id, displayName, avatarUrl, audioOnly }) => ({
    id,
    displayName,
    avatarUrl,
    ...(audioOnly ? { audioOnly: true } : {}),
  }));
}

function capacity(callId) {
  const call = get(callId);
  return call ? call.capacity : 0;
}

function join(callId, user, options = {}) {
  const call = get(callId);
  if (!call) return { ok: false, error: 'This call has ended.', code: 'CALL_GONE' };

  const me = normalizeUser(user);
  if (!me.id) return { ok: false, error: 'A participant is required.', code: 'CALL_INVALID' };
  if (call.participants.has(me.id)) {
    return { ok: true, call, existing: participants(callId).filter((p) => p.id !== me.id) };
  }
  if (!call.invitees.has(me.id)) {
    return { ok: false, error: 'You were not invited to this call.', code: 'CALL_FORBIDDEN' };
  }
  // Video calls allow extra people as audio-only participants: 6 with camera,
  // up to 12 in total. A video slot cannot be taken once those 6 are used.
  const audioOnly = options.audioOnly === true;
  const cap = call.video ? (audioOnly ? CAPS.audio : CAPS.video) : CAPS.audio;
  if (call.participants.size >= cap) {
    return {
      ok: false,
      error:
        call.video && cap === CAPS.video
          ? `Video calls are limited to ${CAPS.video} people with this connection technology. Join with audio only, or ask someone to leave.`
          : `This call is full (up to ${cap} people).`,
      code: 'CALL_FULL',
      capacity: cap,
      video: call.video,
    };
  }

  const existing = participants(callId);
  call.participants.set(me.id, { ...me, joinedAt: now(), audioOnly });
  call.answeredBy.add(me.id);
  if (!call.answeredAt) call.answeredAt = now();
  return { ok: true, call, existing };
}

/** Record that someone who was rung said no. */
function markDeclined(callId, userId) {
  const call = get(callId);
  if (!call) return null;
  call.declinedBy.add(String(userId));
  return call;
}

/** Mark the call as finished (does not remove it; the caller destroys it). */
function markEnded(callId) {
  const call = get(callId);
  if (!call) return null;
  if (!call.endedAt) call.endedAt = now();
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

/** Calls that are still ringing past the timeout (nobody answered yet). */
function expiredRings(nowMs = now(), timeoutMs = RING_TIMEOUT_MS) {
  return [...calls.values()].filter((call) => !call.answeredAt && nowMs - call.createdAt > timeoutMs);
}

function destroy(callId) {
  calls.delete(String(callId || ''));
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
  capacityFor,
  create,
  get,
  findCallForUser,
  isParticipant,
  participants,
  capacity,
  join,
  markDeclined,
  markEnded,
  leave,
  removeUserFromAll,
  expiredRings,
  destroy,
  reset,
  stats,
  prune,
};
