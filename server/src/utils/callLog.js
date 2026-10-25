/**
 * Turns a live registry call into a persisted CallLog row.
 *
 * Called exactly once per call (the registry call object is flagged so the
 * expire/hangup/disconnect paths cannot double-write). No media, SDP or ICE is
 * stored — only who called whom, when, for how long and how it ended.
 */
const CallLog = require('../models/CallLog');

/**
 * @param {object} call registry call object
 * @param {{status?: 'completed'|'missed'|'declined'|'cancelled'|'failed'}} options
 */
async function recordCall(call, { status } = {}) {
  if (!call || call.logged) return null;
  call.logged = true;

  const answeredAt = call.answeredAt ? new Date(call.answeredAt) : null;
  const endedAt = call.endedAt ? new Date(call.endedAt) : new Date();
  const durationSeconds = answeredAt ? Math.max(0, Math.round((endedAt - answeredAt) / 1000)) : 0;

  const finalStatus = status || (answeredAt ? 'completed' : 'missed');

  // Everyone who took part or was rung, so a missed call still shows in the
  // callee's history even though they never joined the registry.
  const ids = new Set([...call.participants.keys()]);
  for (const id of call.invitees || []) ids.add(String(id));
  ids.add(String(call.initiatorId));

  try {
    return await CallLog.create({
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
      answeredBy: [...(call.answeredBy || [])],
      declinedBy: [...(call.declinedBy || [])],
    });
  } catch (error) {
    console.error('Call log write failed:', error.message);
    return null;
  }
}

module.exports = { recordCall };
