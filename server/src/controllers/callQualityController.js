/**
 * Content-free call-quality events for the admin Inbox.
 *
 * The TURN relay is unreachable from the public internet (UDP/TCP 3478, 5349
 * and the relay range all time out), so calls can connect their signalling but
 * carry no audio/video. The web client reports the stalled media here; this
 * controller turns the numbers into one short diagnostic line and records it in
 * the existing AdminInbox report feed the admin Inbox page already reads
 * (GET /api/admin/ai/inbox). No new collection.
 *
 * Privacy rules (deliberate, do not relax):
 *  - the accepted payload is an exact allowlist: unknown fields are rejected, so
 *    message text, names, tokens or URLs cannot ride along;
 *  - every string must match a narrow label charset (no / @ # ? % = & + " or
 *    whitespace runs), so a URL or an encoded token cannot be smuggled in;
 *  - the stored text is built ONLY from fixed labels plus those validated
 *    numbers/short tokens; the user id is not stored either.
 *
 * The endpoint is fire-and-forget: it answers 204 after the (small) write, and
 * never fails the caller for a diagnostic problem. Bad input is a 400; abuse is
 * a 429 (max 5 reports per user per minute, enforced in routes/callRoutes.js).
 */
const CALL_QUALITY_FIELDS = [
  'callId',
  'video',
  'status',
  'iceConnectionState',
  'connectionState',
  'candidatePair',
  'audioIn',
  'videoIn',
  'audioOut',
  'videoOut',
  'remoteTracks',
  'remoteMuted',
  'stalledSeconds',
  'platform',
];

const MAX_LENGTH = {
  callId: 64,
  status: 32,
  iceConnectionState: 32,
  connectionState: 32,
  candidatePair: 40,
  platform: 20,
};

/**
 * Letters, digits, space and a few punctuation marks only. This is what keeps
 * URLs (`/`, `:`, `?`, `=`, `%`), emails (`@`) and tokens (base64url: `-`, `_`)
 * out of every string that reaches the Inbox text. `→` is allowed because a
 * candidate pair is written as `host→srflx`.
 */
const LABEL_RE = /^[A-Za-z0-9 ._:+\-→]+$/;

const PLATFORM_LABELS = {
  web: 'Web app',
  browser: 'Web app',
  pwa: 'Web app',
  android: 'Android app',
  mobile: 'Mobile app',
  capacitor: 'Mobile app',
  ios: 'iOS app',
  windows: 'Windows app',
  electron: 'Windows app',
  desktop: 'Desktop app',
  mac: 'macOS app',
  macos: 'macOS app',
  linux: 'Linux app',
};

function label(value, max) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (!text || text.length > max || !LABEL_RE.test(text)) return null;
  return text;
}

function finiteNumber(value, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
}

function smallInteger(value, max) {
  return Number.isInteger(value) && value >= 0 && value <= max;
}

/**
 * Strict shape validation. Returns {ok:true, value} or {ok:false} — the reason is
 * deliberately not echoed to the client.
 */
function validateCallQuality(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false };

  const keys = Object.keys(body);
  if (keys.length !== CALL_QUALITY_FIELDS.length) return { ok: false };
  if (keys.some((key) => !CALL_QUALITY_FIELDS.includes(key))) return { ok: false };

  const callId = label(body.callId, MAX_LENGTH.callId);
  const status = label(body.status, MAX_LENGTH.status);
  const iceConnectionState = label(body.iceConnectionState, MAX_LENGTH.iceConnectionState);
  const connectionState = label(body.connectionState, MAX_LENGTH.connectionState);
  const platform = label(body.platform, MAX_LENGTH.platform);
  const candidatePair =
    body.candidatePair === null ? null : label(body.candidatePair, MAX_LENGTH.candidatePair);

  if (!callId || !status || !iceConnectionState || !connectionState || !platform) return { ok: false };
  if (body.candidatePair !== null && !candidatePair) return { ok: false };
  if (typeof body.video !== 'boolean') return { ok: false };
  if (!finiteNumber(body.audioIn, 1e12) || !finiteNumber(body.videoIn, 1e12)) return { ok: false };
  if (!finiteNumber(body.audioOut, 1e12) || !finiteNumber(body.videoOut, 1e12)) return { ok: false };
  if (!smallInteger(body.remoteTracks, 16) || !smallInteger(body.remoteMuted, 16)) return { ok: false };
  if (!finiteNumber(body.stalledSeconds, 3600)) return { ok: false };

  return {
    ok: true,
    value: {
      callId,
      video: body.video,
      status,
      iceConnectionState,
      connectionState,
      candidatePair,
      audioIn: body.audioIn,
      videoIn: body.videoIn,
      audioOut: body.audioOut,
      videoOut: body.videoOut,
      remoteTracks: body.remoteTracks,
      remoteMuted: body.remoteMuted,
      stalledSeconds: body.stalledSeconds,
      platform,
    },
  };
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb * 10) / 10} kB`.replace('.0 kB', ' kB');
  return `${Math.round((kb / 1024) * 10) / 10} MB`.replace('.0 MB', ' MB');
}

function platformLabel(platform) {
  return PLATFORM_LABELS[String(platform || '').toLowerCase()] || 'Client';
}

/**
 * The whole stored event. Fixed words + validated numbers/short labels only.
 * Example:
 *   Call media stalled: 12s, candidate host→srflx, in audio 0 B / video 0 B,
 *   out audio 41 kB / video 0 B, remote tracks 2 (0 muted), Android app
 *   [stalled; ice failed; conn disconnected]
 */
function buildEventText(data) {
  const parts = [
    `Call media stalled: ${Math.round(data.stalledSeconds)}s`,
    `candidate ${data.candidatePair || 'unknown'}`,
    `in audio ${formatBytes(data.audioIn)} / video ${formatBytes(data.videoIn)}`,
    `out audio ${formatBytes(data.audioOut)} / video ${formatBytes(data.videoOut)}`,
    `remote tracks ${data.remoteTracks} (${data.remoteMuted} muted)`,
    platformLabel(data.platform),
  ];
  return `${parts.join(', ')} [${data.status}; ice ${data.iceConnectionState}; conn ${data.connectionState}]`;
}

/**
 * POST /api/calls/quality — record a stalled call for the admin Inbox.
 * Private (the router applies `protect`). 204 on success/DB hiccup, 400 on a
 * payload that is not exactly the allowed shape.
 */
async function reportCallQuality(req, res) {
  let parsed;
  try {
    parsed = validateCallQuality(req.body);
  } catch {
    parsed = { ok: false };
  }
  if (!parsed.ok) {
    return res.status(400).json({ message: 'Invalid call quality payload.', code: 'INVALID_CALL_QUALITY' });
  }

  try {
    // Lazy require: keeps the AI/Inbox module graph out of this route's load path
    // and matches how other system-generated Inbox rows are created.
    const { AdminInbox } = require('../ai/chatgram');
    const text = buildEventText(parsed.value);
    const now = new Date();
    // One row per call: repeat reports of the same call increment `count` and
    // refresh the text; different calls get their own visible row.
    await AdminInbox.findOneAndUpdate(
      { normalized: `call_quality:${parsed.value.callId}`, status: { $ne: 'ignored' } },
      {
        $set: {
          type: 'call_quality',
          question: text,
          title: 'Call media stalled',
          summary: text,
          source: 'call quality',
          lastSeenAt: now,
        },
        $setOnInsert: {
          status: 'new',
          createdAt: now,
          // No identity is stored: the event must stay content-free.
          askerId: null,
          askerHash: '',
          askerName: '',
          redactedContext: '',
        },
        $inc: { count: 1 },
      },
      { upsert: true },
    );
  } catch (error) {
    // Telemetry must never break a call; log a bounded, content-free reason.
    console.warn('Call quality report skipped:', String(error?.message || error).slice(0, 160));
  }

  return res.status(204).end();
}

module.exports = {
  reportCallQuality,
  validateCallQuality,
  buildEventText,
  formatBytes,
  platformLabel,
};
