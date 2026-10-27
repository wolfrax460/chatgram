/**
 * Call-quality events for the admin Inbox (TURN unreachable from the internet).
 *
 *   node server/test/integration/callQuality.test.js
 *
 * Requires a staging API on E2E_API_URL (default http://127.0.0.1:5000) with a
 * configured admin password (the local staging one) and the matching Mongo
 * database in MONGODB_URI.
 *
 * Verifies: unauthenticated -> 401; a valid stalled-call payload -> 204 and one
 * visible, content-free AdminInbox row; unknown/missing/wrong-typed/URL-shaped
 * input -> 400; 5 reports/minute per user -> 429; a second user is unaffected;
 * and the stored event contains no identity, message text, URLs or tokens.
 */
const mongoose = require('mongoose');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const run = Date.now().toString(36);

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 240)}` : ''}`);
  }
}

async function api(method, route, { token, headers, body } = {}) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, body: payload, text };
}

async function register(label) {
  const res = await api('POST', '/api/auth/register', {
    body: {
      displayName: `Quality ${label} ${run}`,
      identifier: `call-quality-${label}-${run}@chatgram.test`,
      password: 'CallQuality1!',
    },
  });
  if (res.status !== 201) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken, id: res.body.user.id };
}

const CALL_ID = `call-quality-${run}`;

function payload(overrides = {}) {
  return {
    callId: CALL_ID,
    video: true,
    status: 'stalled',
    iceConnectionState: 'failed',
    connectionState: 'disconnected',
    candidatePair: 'host→srflx',
    audioIn: 0,
    videoIn: 0,
    audioOut: 42000,
    videoOut: 0,
    remoteTracks: 2,
    remoteMuted: 0,
    stalledSeconds: 12,
    platform: 'android',
    ...overrides,
  };
}

const EXPECTED_TEXT =
  'Call media stalled: 12s, candidate host→srflx, in audio 0 B / video 0 B, ' +
  'out audio 41 kB / video 0 B, remote tracks 2 (0 muted), Android app ' +
  '[stalled; ice failed; conn disconnected]';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForRow(AdminInbox, normalized, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const row = await AdminInbox.findOne({ normalized }).lean();
    if (row) return row;
    await sleep(150);
  }
  return null;
}

async function main() {
  console.log('\ncall quality -> admin inbox\n');
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const { AdminInbox } = require('../../src/ai/chatgram');
  const User = require('../../src/models/User');

  const userA = await register('a');
  const userB = await register('b');
  const login = await fetch(`${API}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const loginBody = await login.json();
  const adminHeaders = {
    Cookie: (login.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; '),
    'X-Admin-CSRF': loginBody.csrfToken,
  };
  check('admin login works (needed to read the Inbox)', login.status === 200 && Boolean(loginBody.csrfToken), login.status);

  try {
    /* ------------------------------------------------- auth + happy path */
    const anonymous = await api('POST', '/api/calls/quality', { body: payload() });
    check('an unauthenticated report is rejected with 401', anonymous.status === 401, anonymous.status);

    const accepted = await api('POST', '/api/calls/quality', { token: userA.token, body: payload() });
    check('a valid report is accepted with 204', accepted.status === 204, accepted.status);

    const normalized = `call_quality:${CALL_ID}`;
    const row = await waitForRow(AdminInbox, normalized);
    check('an AdminInbox row is created', Boolean(row), null);
    check('the row is new and of type call_quality', row?.status === 'new' && row?.type === 'call_quality', { status: row?.status, type: row?.type });
    check('the row is titled for the admin Inbox', row?.title === 'Call media stalled', row?.title);
    check('the stored text is exactly the content-free diagnostic', row?.question === EXPECTED_TEXT, row?.question);
    check('the summary matches the event text', row?.summary === EXPECTED_TEXT, row?.summary);
    check('the row carries no identity', row?.askerId === null && !row?.askerName && !row?.askerHash, { askerId: row?.askerId });
    check('no free-text context is stored', !row?.userText && !row?.transcript && !row?.redactedContext);

    // The event text must not contain message content, names, URLs or tokens.
    // (The exact-equality check above is the primary guarantee; these extra
    // guards cover the other stored/admin-visible fields too.)
    const stored = [row?.question, row?.title, row?.summary].filter(Boolean).join(' ');
    const looksLikeContent = /@|https?:|www\.|secret message|bearer|token=|password/i;
    check('the stored text contains no content, URL or token', !looksLikeContent.test(stored), stored);

    // Rate-limit counter: request 1 used above.
    const unknownField = await api('POST', '/api/calls/quality', {
      token: userA.token,
      body: { ...payload(), message: 'secret message that must never be stored' },
    });
    check('an unknown field is rejected with 400', unknownField.status === 400 && unknownField.body?.code === 'INVALID_CALL_QUALITY', unknownField.body);
    check(
      'the rejected field never reaches the Inbox',
      (await AdminInbox.countDocuments({ question: /secret message/i })) === 0,
      null,
    );

    const missingField = payload();
    delete missingField.video;
    const missing = await api('POST', '/api/calls/quality', { token: userA.token, body: missingField });
    check('a missing field is rejected with 400', missing.status === 400, missing.status);

    const wrongType = await api('POST', '/api/calls/quality', { token: userA.token, body: payload({ video: 'yes' }) });
    check('a wrong field type is rejected with 400', wrongType.status === 400, wrongType.status);

    const urlShaped = await api('POST', '/api/calls/quality', {
      token: userA.token,
      body: payload({ status: 'stalled https://evil.example/beacon?u=1' }),
    });
    check('a URL-shaped value is rejected with 400', urlShaped.status === 400, urlShaped.status);

    // 6th request inside the minute for this user -> rate limited.
    const limited = await api('POST', '/api/calls/quality', { token: userA.token, body: payload({ callId: `${CALL_ID}-again` }) });
    check(
      'more than 5 reports per user per minute is rate limited',
      limited.status === 429 && limited.body?.code === 'CALL_QUALITY_RATE_LIMITED',
      limited.body,
    );
    check('the rate limit response says when to retry', Number(limited.body?.retryAfterSeconds) >= 1, limited.body?.retryAfterSeconds);
    check(
      'the rate-limited report is not stored',
      (await AdminInbox.countDocuments({ normalized: `call_quality:${CALL_ID}-again` })) === 0,
      null,
    );

    // A different user has their own counter and gets their own visible row.
    const secondCall = `${CALL_ID}-b`;
    const secondUser = await api('POST', '/api/calls/quality', { token: userB.token, body: payload({ callId: secondCall, platform: 'web' }) });
    check('another user is not affected by the first user\'s limit', secondUser.status === 204, secondUser.status);
    check('the second call gets its own row', Boolean(await waitForRow(AdminInbox, `call_quality:${secondCall}`)), null);

    /* --------------------------------------------------- admin Inbox view */
    const inbox = await api('GET', '/api/admin/ai/inbox?status=all&limit=100', { headers: adminHeaders });
    const visible = (inbox.body?.items || []).find((item) => item.id === String(row?._id));
    check('the event is visible in the admin Inbox API', inbox.status === 200 && Boolean(visible), inbox.status);
    check(
      'the visible row is content-free',
      visible?.title === 'Call media stalled' &&
        visible?.summary === EXPECTED_TEXT &&
        !looksLikeContent.test([visible?.title, visible?.summary, visible?.userText].filter(Boolean).join(' ')),
      visible && { title: visible.title, summary: visible.summary },
    );
  } finally {
    // Cleanup: only this run's rows and users.
    await AdminInbox.deleteMany({ normalized: new RegExp(`call_quality:${run}`) });
    await User.deleteMany({ email: new RegExp(`call-quality-.+-${run}@chatgram\\.test$`) });
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('call quality test crashed:', String((error && error.stack) || error).slice(0, 900));
  process.exit(1);
});
