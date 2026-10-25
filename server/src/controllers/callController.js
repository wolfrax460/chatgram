/**
 * Call configuration and call history.
 *
 * ICE: TURN uses coturn's REST-style shared secret. The server signs
 * `username = <expiry>:<userId>` with HMAC-SHA1 and hands the client that
 * username plus the signature. Credentials therefore expire on their own and no
 * static TURN password ever exists in the client. They are minted per request,
 * so the client refreshes them before each call and on an ICE restart.
 */
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const CallLog = require('../models/CallLog');
const User = require('../models/User');
const Chat = require('../models/Chat');

const parseList = (value) =>
  String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Mint short-lived TURN credentials for one user. */
function mintTurnCredentials(userId, ttlSeconds) {
  const secret = process.env.TURN_SECRET || '';
  if (!secret) return null;
  const ttl = numberOr(ttlSeconds || process.env.TURN_TTL_SECONDS, 3600);
  const expiry = Math.floor(Date.now() / 1000) + ttl;
  const username = `${expiry}:${userId}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential, expiry, ttl };
}

// @desc    ICE servers for WebRTC calls (STUN + TURN with fresh credentials)
// @route   GET /api/calls/ice
// @access  Private
const getIceServers = async (req, res) => {
  try {
    const stunUrls = parseList(
      process.env.STUN_URLS || process.env.STUN_URL || 'stun:stun.l.google.com:19302',
    );
    const host = process.env.TURN_HOST || '';
    const port = numberOr(process.env.TURN_PORT, 3478);
    const tlsPort = numberOr(process.env.TURN_TLS_PORT, 5349);

    const iceServers = [{ urls: stunUrls }];
    let turn = null;

    if (host && process.env.TURN_SECRET) {
      turn = mintTurnCredentials(String(req.user._id));
      if (turn) {
        const urls = [
          `turn:${host}:${port}?transport=udp`,
          `turn:${host}:${port}?transport=tcp`,
          `turns:${host}:${tlsPort}?transport=tcp`,
        ];
        iceServers.push({ urls, username: turn.username, credential: turn.credential });
      }
    }

    return res.json({
      iceServers,
      hasTurn: Boolean(turn),
      // Seconds until the TURN credential stops being accepted; the client
      // fetches a fresh configuration rather than reusing an expired one.
      ttlSeconds: turn ? turn.ttl : 0,
      expiresAt: turn ? new Date(turn.expiry * 1000).toISOString() : null,
    });
  } catch (error) {
    console.error('ICE config error:', error.message);
    return res.status(500).json({ message: 'Could not load call configuration' });
  }
};

/* --------------------------------------------------------------- call logs */

const AVATAR_FIELDS = '_id displayName avatarUrl';

function directionFor(log, meId) {
  return String(log.callerId?._id || log.callerId) === String(meId) ? 'outgoing' : 'incoming';
}

function statusFor(log, meId, direction) {
  const me = String(meId);
  const answered = (log.answeredBy || []).some((id) => String(id) === me);
  if (direction === 'outgoing') {
    if (log.answeredAt) return 'completed';
    if (log.status === 'declined') return 'declined';
    return log.status === 'completed' ? 'completed' : 'cancelled';
  }
  if (answered) return 'completed';
  if ((log.declinedBy || []).some((id) => String(id) === me)) return 'declined';
  return 'missed';
}

function serialize(log, meId) {
  const direction = directionFor(log, meId);
  const status = statusFor(log, meId, direction);
  return {
    id: String(log._id),
    chatId: log.chatId ? String(log.chatId) : null,
    type: log.type,
    isGroup: log.isGroup,
    title: log.title || '',
    direction,
    status,
    startedAt: log.startedAt,
    answeredAt: log.answeredAt,
    endedAt: log.endedAt,
    durationSeconds: log.durationSeconds || 0,
    caller: log.callerId?._id
      ? {
          id: String(log.callerId._id),
          displayName: log.callerId.displayName,
          avatarUrl: log.callerId.avatarUrl || null,
        }
      : null,
    participants: (log.participants || []).map((p) => ({
      id: String(p._id || p),
      displayName: p.displayName || '',
      avatarUrl: p.avatarUrl || null,
    })),
  };
}

// @desc    Call history for the signed-in user (paginated, newest first)
// @route   GET /api/calls
const listCalls = async (req, res) => {
  try {
    const limit = Math.min(numberOr(req.query.limit, 30), 100);
    const filter = { participants: req.user._id, hiddenFor: { $ne: req.user._id } };
    if (req.query.before && !Number.isNaN(Date.parse(String(req.query.before)))) {
      filter.startedAt = { $lt: new Date(String(req.query.before)) };
    }
    const logs = await CallLog.find(filter)
      .sort({ startedAt: -1 })
      .limit(limit + 1)
      .populate('callerId', AVATAR_FIELDS)
      .populate('participants', AVATAR_FIELDS)
      .lean();

    const hasMore = logs.length > limit;
    const page = hasMore ? logs.slice(0, limit) : logs;
    res.json({
      calls: page.map((log) => serialize(log, req.user._id)),
      nextBefore: hasMore ? page[page.length - 1]?.startedAt ?? null : null,
    });
  } catch (error) {
    console.error('List calls error:', error.message);
    res.status(500).json({ message: 'Could not load call history' });
  }
};

// @desc    Count of missed calls the user has not seen yet
// @route   GET /api/calls/missed-count
const missedCount = async (req, res) => {
  try {
    const me = await User.findById(req.user._id).select('callsSeenAt').lean();
    const since = me?.callsSeenAt || new Date(0);
    const count = await CallLog.countDocuments({
      participants: req.user._id,
      callerId: { $ne: req.user._id },
      answeredBy: { $ne: req.user._id },
      declinedBy: { $ne: req.user._id },
      hiddenFor: { $ne: req.user._id },
      startedAt: { $gt: since },
    });
    res.json({ count });
  } catch (error) {
    console.error('Missed call count error:', error.message);
    res.status(500).json({ message: 'Could not count missed calls' });
  }
};

// @desc    Mark the missed-call badge as read
// @route   POST /api/calls/seen
const markCallsSeen = async (req, res) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $set: { callsSeenAt: new Date() } });
    res.json({ ok: true });
  } catch (error) {
    console.error('Mark calls seen error:', error.message);
    res.status(500).json({ message: 'Could not update the call badge' });
  }
};

// @desc    Remove one call from my history
// @route   DELETE /api/calls/:id
const deleteCall = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid call id' });
    const result = await CallLog.updateOne(
      { _id: id, participants: req.user._id },
      { $addToSet: { hiddenFor: req.user._id } },
    );
    if (!result.matchedCount) return res.status(404).json({ message: 'Call not found' });
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete call error:', error.message);
    res.status(500).json({ message: 'Could not delete the call' });
  }
};

// @desc    Clear my whole call history
// @route   DELETE /api/calls
const clearCalls = async (req, res) => {
  try {
    const result = await CallLog.updateMany(
      { participants: req.user._id },
      { $addToSet: { hiddenFor: req.user._id } },
    );
    res.json({ ok: true, cleared: result.modifiedCount || 0 });
  } catch (error) {
    console.error('Clear calls error:', error.message);
    res.status(500).json({ message: 'Could not clear call history' });
  }
};

// @desc    People I can start a call with
// @route   GET /api/calls/contacts
const callContacts = async (req, res) => {
  try {
    const me = await User.findById(req.user._id).select('contacts').lean();
    const ids = (me?.contacts || []).slice(0, 200);
    const people = await User.find({ _id: { $in: ids }, isSupportAccount: { $ne: true } })
      .select(AVATAR_FIELDS)
      .sort({ displayName: 1 })
      .lean();
    res.json({
      contacts: people.map((p) => ({
        id: String(p._id),
        displayName: p.displayName,
        avatarUrl: p.avatarUrl || null,
      })),
    });
  } catch (error) {
    console.error('Call contacts error:', error.message);
    res.status(500).json({ message: 'Could not load contacts' });
  }
};

// @desc    Groups that can host a group call
// @route   GET /api/calls/groups
const callGroups = async (req, res) => {
  try {
    const groups = await Chat.find({ type: 'group', participants: req.user._id })
      .select('_id groupName participants')
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();
    res.json({
      groups: groups.map((g) => ({
        id: String(g._id),
        title: g.groupName || 'Group',
        participantCount: (g.participants || []).length,
      })),
    });
  } catch (error) {
    console.error('Call groups error:', error.message);
    res.status(500).json({ message: 'Could not load groups' });
  }
};

module.exports = {
  getIceServers,
  mintTurnCredentials,
  listCalls,
  missedCount,
  markCallsSeen,
  deleteCall,
  clearCalls,
  callContacts,
  callGroups,
};
