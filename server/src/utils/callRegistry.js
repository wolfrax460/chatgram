/**
 * In-memory registry of live calls.
 *
 * The server never touches media — it only tracks who is in which call so that
 * signalling (SDP/ICE) can be routed between the right peers, and so an
 * unauthenticated or uninvolved socket cannot inject anything into a call.
 *
 * Calls are ephemeral: a restart drops them, which is acceptable because media
 * is peer-to-peer and a call cannot survive the signalling server going away.
 */
const MAX_PARTICIPANTS = 20;
/** Abandoned calls are pruned so a crashed client cannot leak memory forever. */
const MAX_AGE_MS = 4 * 60 * 60 * 1000;

/** callId -> call */
const calls = new Map();

function now() {
  return Date.now();
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

/**
 * Create a call and register the initiator as its first participant.
 * @returns {{ok: true, call: object} | {ok: false, error: string, code: string}}
 */
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
    participants: new Map([[me.id, { ...me, joinedAt: now() }]]),
    // Everyone rung when the call started; used to authorise `call:accept`.
    invitees: new Set([me.id, ...invitees.map((u) => String(u))]),
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
  return [...call.participants.values()].map(({ id, displayName, avatarUrl }) => ({
    id,
    displayName,
    avatarUrl,
  }));
}

/**
 * Add a user who accepted the ring.
 * @returns {{ok: true, call: object, existing: object[]} | {ok: false, error: string, code: string}}
 */
function join(callId, user) {
  const call = get(callId);
  if (!call) return { ok: false, error: 'This call has ended.', code: 'CALL_GONE' };

  const me = normalizeUser(user);
  if (!me.id) return { ok: false, error: 'A participant is required.', code: 'CALL_INVALID' };
  if (call.participants.has(me.id)) {
    // Idempotent: a reconnecting client must not be counted twice.
    return { ok: true, call, existing: participants(callId).filter((p) => p.id !== me.id) };
  }
  if (!call.invitees.has(me.id)) {
    return { ok: false, error: 'You were not invited to this call.', code: 'CALL_FORBIDDEN' };
  }
  if (call.participants.size >= MAX_PARTICIPANTS) {
    return {
      ok: false,
      error: `This call is full (up to ${MAX_PARTICIPANTS} people).`,
      code: 'CALL_FULL',
    };
  }

  const existing = participants(callId);
  call.participants.set(me.id, { ...me, joinedAt: now() });
  return { ok: true, call, existing };
}

/**
 * Remove a user and tell the caller whether the call is now empty.
 * @returns {{call: object|null, destroyed: boolean, removed: boolean}}
 */
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
    maxParticipants: MAX_PARTICIPANTS,
    participants: [...calls.values()].reduce((total, call) => total + call.participants.size, 0),
  };
}

module.exports = {
  MAX_PARTICIPANTS,
  MAX_AGE_MS,
  create,
  get,
  findCallForUser,
  isParticipant,
  participants,
  join,
  leave,
  removeUserFromAll,
  destroy,
  reset,
  stats,
  prune,
};
