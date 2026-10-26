/**
 * Turns a live registry call into a persisted CallLog row.
 *
 * Called exactly once per call (the registry call object is flagged so the
 * expire/hangup/disconnect paths cannot double-write). No media, SDP or ICE is
 * stored — only who called whom, when, for how long and how it ended.
 *
 * Chunk 2: also stores the room id, who was busy, who failed to connect and the
 * coarse end reason, and excludes people who were busy on another call from the
 * participant list (they never saw this call, so it must not appear as a missed
 * call in their history).
 */
const CallLog = require('../models/CallLog');

/**
 * @param {object} call registry call object
 * @param {{status?: 'completed'|'missed'|'declined'|'busy'|'cancelled'|'failed'}} options
 */
async function recordCall(call, { status } = {}) {
  if (!call || call.logged) return null;
  call.logged = true;

  const answeredAt = call.answeredAt ? new Date(call.answeredAt) : null;
  const endedAt = call.endedAt ? new Date(call.endedAt) : new Date();
  const durationSeconds = answeredAt ? Math.max(0, Math.round((endedAt - answeredAt) / 1000)) : 0;

  const finalStatus = status || call.status || (answeredAt ? 'completed' : 'missed');
  const busyBy = [...(call.busyBy || [])].map(String);
  const busySet = new Set(busyBy);

  // Everyone who took part or was rung, so a missed call still shows in the
  // callee's history even though they never joined the registry. People who
  // were busy on another call were never rung: they are not participants.
  const ids = new Set([...call.participants.keys()].map(String));
  for (const id of call.invitees || []) {
    const value = String(id);
    if (!busySet.has(value)) ids.add(value);
  }
  ids.add(String(call.initiatorId));

  try {
    return await CallLog.create({
      callId: call.callId || null,
      chatId: call.chatId,
      callerId: call.initiatorId,
      participants: [...ids],
      type: call.video ? 'video' : 'voice',
      isGroup: call.isGroup === true,
      title: call.title || '',
      startedAt: new Date(call.createdAt),
      answeredAt,
      endedAt,
      durationSeconds,
      status: finalStatus,
      endReason: call.endReason || (finalStatus === 'completed' ? 'ended' : finalStatus),
      answeredBy: [...(call.answeredBy || [])],
      declinedBy: [...(call.declinedBy || [])],
      busyBy,
      failedBy: [...(call.failedBy || [])].map(String),
    });
  } catch (error) {
    console.error('Call log write failed:', error.message);
    return null;
  }
}

module.exports = { recordCall };
