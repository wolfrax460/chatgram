/**
 * 9b statuses & media admin: recent statuses + report counts, the media library
 * across messages and statuses, storage totals and audited removal.
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/adminMedia.test.js
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
    console.log(`  FAIL  ${name}${detail ? ` -> ${JSON.stringify(detail).slice(0, 220)}` : ''}`);
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
  const identifier = `media-${label}-${run}@chatgram.test`;
  const result = await api('POST', '/api/auth/register', {
    body: { displayName: `MEDIA ${label} ${run}`, identifier, password: 'MediaTest1!' },
  });
  if (result.status !== 201) throw new Error(`register ${label}: ${result.status}`);
  return { identifier, password: 'MediaTest1!', accessToken: result.body.accessToken, user: result.body.user };
}

async function main() {
  console.log('\nstatuses & media administration\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const Status = require('../../src/models/Status');
  const Chat = require('../../src/models/Chat');
  const Message = require('../../src/models/Message');
  const User = require('../../src/models/User');

  const login = await fetch(`${API}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const loginBody = await login.json();
  const headers = { Cookie: (login.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; '), 'X-Admin-CSRF': loginBody.csrfToken };
  check('admin login works', login.status === 200 && Boolean(loginBody.csrfToken), login.status);

  const owner = await register('owner');
  const viewer = await register('viewer');
  const textStatus = await Status.create({ userId: owner.user.id, text: `text status ${run}` });
  const mediaStatus = await Status.create({
    userId: owner.user.id,
    text: `photo status ${run}`,
    mediaUrl: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
    mediaType: 'image',
    mediaSize: 123456,
    mimetype: 'image/jpeg',
  });
  const chat = await api('POST', '/api/chats', { token: owner.accessToken, body: { type: 'direct', participantId: viewer.user.id } });
  const chatId = chat.body._id || chat.body.id;
  const mediaMessage = await api('POST', '/api/messages', {
    token: owner.accessToken,
    body: { chatId, type: 'image', mediaUrl: 'https://res.cloudinary.com/demo/image/upload/sample2.jpg' },
  });
  const messageId = mediaMessage.body._id || mediaMessage.body.id;

  try {
    // Auth gates.
    for (const [method, route] of [
      ['GET', '/api/admin/statuses'],
      ['GET', '/api/admin/media'],
      ['GET', '/api/admin/media/storage'],
      ['DELETE', `/api/admin/statuses/${mediaStatus._id}`],
      ['POST', '/api/admin/media/remove'],
    ]) {
      check(`${method} ${route} requires the admin session`, (await api(method, route)).status === 401);
      check(`${method} ${route} rejects a user token`, (await api(method, route, { token: owner.accessToken })).status === 401);
    }
    check('status removal requires the CSRF header', (await api('DELETE', `/api/admin/statuses/${textStatus._id}`, { headers: { Cookie: headers.Cookie } })).status === 403);

    // Statuses list.
    const statuses = await api('GET', `/api/admin/statuses?limit=100`, { headers });
    check('the statuses list returns 200', statuses.status === 200, statuses.status);
    check('the list is paginated', typeof statuses.body.total === 'number' && typeof statuses.body.pageCount === 'number');
    const textRow = (statuses.body.statuses || []).find((row) => row.id === String(textStatus._id));
    const mediaRow = (statuses.body.statuses || []).find((row) => row.id === String(mediaStatus._id));
    check('text statuses appear with owner details', Boolean(textRow?.owner?.displayName) && textRow.mediaType === 'text', textRow);
    check('media statuses carry the media info + size', mediaRow?.mediaType === 'image' && mediaRow?.mediaBytes === 123456 && Boolean(mediaRow?.mediaUrl), mediaRow);
    check('the statuses payload has no secrets', !/(password|twoFactorSecret|accessToken)"/i.test(statuses.text), 'secret-looking field');
    check('the media filter narrows the list', ((await api('GET', '/api/admin/statuses?mediaType=image&limit=100', { headers })).body.statuses || []).every((row) => row.mediaType === 'image'));

    // Media library.
    const media = await api('GET', '/api/admin/media?limit=100', { headers });
    check('the media library returns 200', media.status === 200, media.status);
    const sources = new Set((media.body.media || []).map((row) => row.source));
    check('the library includes message and status media', sources.has('message') && sources.has('status'), [...sources]);
    check('media rows carry a type, url and owner', (media.body.media || []).every((row) => row.type && row.url && row.owner?.displayName));
    const filtered = await api('GET', '/api/admin/media?source=status&limit=20', { headers });
    check('the source filter works', (filtered.body.media || []).every((row) => row.source === 'status'), (filtered.body.media || []).length);
    check('the media payload has no secrets', !/(password|twoFactorSecret|accessToken)"/i.test(media.text), 'secret-looking field');

    // Storage stats.
    const storage = await api('GET', '/api/admin/media/storage', { headers });
    check('storage stats return 200', storage.status === 200, storage.status);
    check('status bytes are summed', storage.body.statuses?.bytes >= 123456, storage.body.statuses);
    check('message media is counted', storage.body.messages?.mediaCount >= 1, storage.body.messages);
    check('top users are listed with owner + counts', (storage.body.topUsers || []).length > 0 && (storage.body.topUsers || []).every((row) => typeof row.messageCount === 'number'), (storage.body.topUsers || []).length);

    // Audited removals.
    const removeStatus = await api('DELETE', `/api/admin/statuses/${mediaStatus._id}`, { headers });
    check('removing a status works', removeStatus.status === 200, removeStatus.status);
    check('the status row is gone', (await Status.findById(mediaStatus._id)) === null);
    const removeMessage = await api('POST', '/api/admin/media/remove', { headers, body: { source: 'message', id: messageId } });
    check('removing message media works', removeMessage.status === 200, removeMessage.status);
    check('the message is soft-deleted', (await Message.findById(messageId).lean())?.isDeleted === true);
    check('the removal is audited', (await api('GET', '/api/admin/audit?search=status_remove&days=1', { headers })).body.entries.length >= 1 && (await api('GET', '/api/admin/audit?search=media_remove_message&days=1', { headers })).body.entries.length >= 1);
    check('an invalid media source is refused', (await api('POST', '/api/admin/media/remove', { headers, body: { source: 'nope', id: String(mediaStatus._id) } })).status === 400);
  } finally {
    await Status.deleteMany({ userId: { $in: [owner.user.id, viewer.user.id].map((id) => new mongoose.Types.ObjectId(String(id))) } });
    await Message.deleteMany({ chatId: new mongoose.Types.ObjectId(String(chatId)) });
    await Chat.deleteOne({ _id: new mongoose.Types.ObjectId(String(chatId)) });
    await User.deleteMany({ _id: { $in: [owner.user.id, viewer.user.id].map((id) => new mongoose.Types.ObjectId(String(id))) } });
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', String((error && error.stack) || error).slice(0, 900));
  process.exit(1);
});
