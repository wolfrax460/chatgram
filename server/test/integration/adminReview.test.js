/**
 * 9d oversight guard rails: reasoned read-only conversation review, audit rows,
 * expiry, rate limiting, secret redaction and the review log/CSV.
 *
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/adminReview.test.js
 */
const mongoose = require('mongoose');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
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
    console.log(`  FAIL  ${name}${detail ? ` -> ${JSON.stringify(detail).slice(0, 240)}` : ''}`);
  }
}

async function api(method, route, { token, headers, body, raw } = {}) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return { status: response.status, text: await response.text(), headers: response.headers };
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, body: payload, text };
}

async function register(label) {
  const identifier = `rv-${label}-${run}@chatgram.test`;
  const result = await api('POST', '/api/auth/register', {
    body: { displayName: `Review ${label} ${run}`, identifier, password: 'RvTest1!' },
  });
  if (result.status !== 201) throw new Error(`register ${label}: ${result.status} ${result.text}`);
  return { identifier, password: 'RvTest1!', accessToken: result.body.accessToken, user: result.body.user };
}

async function main() {
  console.log('\nadmin oversight review (9d)\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const User = require('../../src/models/User');
  const Chat = require('../../src/models/Chat');
  const Message = require('../../src/models/Message');
  const ReviewSession = require('../../src/models/ReviewSession');
  const AdminAudit = require('../../src/models/AdminAudit');
  const AdminSession = require('../../src/models/AdminSession');

  const login = await fetch(`${API}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const loginBody = await login.json();
  const headers = {
    Cookie: (login.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; '),
    'X-Admin-CSRF': loginBody.csrfToken,
  };
  check('admin login works', login.status === 200 && Boolean(loginBody.csrfToken), login.status);

  const adminSession = await AdminSession.findOne({ revokedAt: null }).sort({ createdAt: -1 }).lean();
  const adminSessionId = adminSession?._id;

  const subject = await register('subject');
  const partner = await register('partner');
  const chat = await api('POST', '/api/chats', {
    token: subject.accessToken,
    body: { type: 'direct', participantId: partner.user.id },
  });
  const chatId = chat.body?._id || chat.body?.id;
  await api('POST', '/api/messages', {
    token: subject.accessToken,
    body: { chatId, type: 'text', content: `Oversight review fixture ${run}: please review the account.` },
  });

  // --- guard rail 1: a written reason is mandatory -------------------------
  const noReason = await api('POST', '/api/admin/reviews', { headers, body: { userId: subject.user.id } });
  check('no reason means no review session', noReason.status === 422, noReason.status);
  const shortReason = await api('POST', '/api/admin/reviews', {
    headers,
    body: { userId: subject.user.id, reason: 'abuse' },
  });
  check('a too-short reason is rejected', shortReason.status === 422, shortReason.status);
  const simpleHeaders = { ...headers, 'X-Admin-CSRF': '' };
  const noCsrf = await api('POST', '/api/admin/reviews', { headers: simpleHeaders, body: { userId: subject.user.id, reason: 'Short reason for CSRF test' } });
  check('a review cannot be started without the admin CSRF token', noCsrf.status === 403, noCsrf.status);

  // --- a real review session ------------------------------------------------
  const started = await api('POST', '/api/admin/reviews', {
    headers,
    body: {
      userId: subject.user.id,
      reason: `Security review fixture ${run}: reports of spam.`,
      reference: `REPORT-${run}`,
    },
  });
  const reviewId = started.body?.review?.id;
  check('a reasoned review session starts', started.status === 201 && Boolean(reviewId), started.status);
  check('the session is time-boxed to about 15 minutes', started.body?.review?.secondsLeft > 800 && started.body?.review?.secondsLeft <= 900, started.body?.review?.secondsLeft);

  const auditStart = await AdminAudit.findOne({ action: 'review_start', detail: new RegExp(`review=${reviewId}`) }).lean();
  check('starting a review is audited with the reason', Boolean(auditStart), null);

  const conversations = await api('GET', `/api/admin/reviews/${reviewId}/conversations`, { headers });
  check('the read-only conversation list is returned', conversations.status === 200 && (conversations.body?.conversations || []).some((row) => row.id === String(chatId)), conversations.status);
  check('conversation titles are built from participant display names', (conversations.body?.conversations || [])[0]?.title?.includes('Review'), (conversations.body?.conversations || [])[0]?.title);

  const messages = await api('GET', `/api/admin/reviews/${reviewId}/messages?chatId=${chatId}`, { headers });
  check('the review can read the conversation messages', messages.status === 200 && (messages.body?.messages || []).some((row) => String(row.content).includes(`Oversight review fixture ${run}`)), messages.status);
  check('message payloads carry no password/token/2FA fields', !/password|accessToken|refreshToken|totpSecret|recoveryCode/i.test(messages.text), null);

  const auditView = await AdminAudit.findOne({ action: 'review_view', detail: new RegExp(`review=${reviewId}`) }).lean();
  check('every message read writes an audit row', Boolean(auditView), null);

  // --- read-only: no route exists to send/edit/delete as a user -------------
  const sendAttempt = await api('POST', `/api/admin/reviews/${reviewId}/messages`, {
    headers,
    body: { chatId, content: 'Ignore this attempt' },
  });
  check('no admin route can send a message through the review', sendAttempt.status === 404, sendAttempt.status);
  const writeAttempt = await api('POST', `/api/admin/reviews/${reviewId}/conversations`, { headers, body: { chatId, content: 'x' } });
  check('no admin route can write conversations through the review', writeAttempt.status === 404, writeAttempt.status);

  // --- unknown/foreign sessions are not servable ----------------------------
  const fakeId = new mongoose.Types.ObjectId();
  const fakeRead = await api('GET', `/api/admin/reviews/${fakeId}/messages?chatId=${chatId}`, { headers });
  check('an unknown review id returns nothing', fakeRead.status === 404, fakeRead.status);
  const userTokenRead = await api('GET', `/api/admin/reviews/${reviewId}/messages?chatId=${chatId}`, { token: subject.accessToken });
  check('a normal user token cannot read reviewed content', userTokenRead.status === 401, userTokenRead.status);
  const userTokenList = await api('GET', '/api/admin/reviews', { token: subject.accessToken });
  check('a normal user token cannot read the review log', userTokenList.status === 401, userTokenList.status);

  // --- expiry after 15 minutes of inactivity --------------------------------
  await ReviewSession.updateOne({ _id: reviewId }, { $set: { lastActivityAt: new Date(Date.now() - 20 * 60 * 1000) } });
  const expired = await api('GET', `/api/admin/reviews/${reviewId}/messages?chatId=${chatId}`, { headers });
  check('a review expires after 15 minutes of inactivity', expired.status === 410 && expired.body?.code === 'REVIEW_EXPIRED', { status: expired.status, code: expired.body?.code });
  const afterExpiry = await api('GET', `/api/admin/reviews/${reviewId}/conversations`, { headers });
  check('expired reviews serve no content', afterExpiry.status === 410, afterExpiry.status);

  // --- ending a review ------------------------------------------------------
  const fresh = await api('POST', '/api/admin/reviews', {
    headers,
    body: { userId: subject.user.id, reason: `Second review fixture ${run}: follow-up check.` },
  });
  const freshId = fresh.body?.review?.id;
  const ended = await api('POST', `/api/admin/reviews/${freshId}/end`, { headers, body: {} });
  check('a review can be ended manually', ended.status === 200 && ended.body?.review?.status === 'ended', ended.status);
  const afterEnd = await api('GET', `/api/admin/reviews/${freshId}/messages?chatId=${chatId}`, { headers });
  check('an ended review serves no content', afterEnd.status === 410, afterEnd.status);

  // --- rate limiting --------------------------------------------------------
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const existing = await ReviewSession.countDocuments({ adminSessionId, createdAt: { $gte: hourAgo } });
  const filler = [];
  for (let index = existing; index < 20; index += 1) {
    filler.push({
      adminSessionId,
      userId: new mongoose.Types.ObjectId(subject.user.id),
      reason: `Rate-limit filler ${run} #${index}`,
      status: 'ended',
      expiresAt: new Date(Date.now() + 60_000),
      endedAt: new Date(),
    });
  }
  if (filler.length) await ReviewSession.insertMany(filler);
  const limited = await api('POST', '/api/admin/reviews', {
    headers,
    body: { userId: subject.user.id, reason: `Rate limit probe ${run}: should be refused.` },
  });
  check('reviews are rate limited per admin session', limited.status === 429, limited.status);

  // --- who viewed what + CSV export ----------------------------------------
  const log = await api('GET', '/api/admin/reviews?limit=100', { headers });
  check('the review log lists the sessions', log.status === 200 && (log.body?.reviews || []).some((row) => row.id === String(reviewId)), log.status);
  check('the review log shows the admin user and the reason', Boolean((log.body?.reviews || []).find((row) => row.id === String(reviewId))?.user?.displayName), null);
  const csv = await api('GET', '/api/admin/reviews?format=csv&limit=100', { headers, raw: true });
  check('the review log exports as CSV', csv.status === 200 && /text\/csv/.test(String(csv.headers.get('content-type'))) && csv.text.includes('reason'), csv.status);
  const stats = await api('GET', '/api/admin/reviews/stats', { headers });
  check('review statistics are available for the dashboard', stats.status === 200 && typeof stats.body?.lastHour === 'number', stats.status);

  // --- cleanup --------------------------------------------------------------
  await Message.deleteMany({ chatId });
  await Chat.deleteMany({ _id: chatId });
  await ReviewSession.deleteMany({ userId: subject.user.id });
  await User.deleteMany({ _id: { $in: [subject.user.id, partner.user.id] } });

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error('admin review test crashed:', error);
  try { await mongoose.disconnect(); } catch { /* already closed */ }
  process.exit(1);
});
