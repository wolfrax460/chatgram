/**
 * 9b data requests: tracked export + deletion, download, cancel, grace and
 * audit — admin session only.
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/adminDataRequests.test.js
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
  const identifier = `dr-${label}-${run}@chatgram.test`;
  const result = await api('POST', '/api/auth/register', {
    body: { displayName: `DR ${label} ${run}`, identifier, password: 'DrTest1!' },
  });
  if (result.status !== 201) throw new Error(`register ${label}: ${result.status}`);
  return { identifier, password: 'DrTest1!', accessToken: result.body.accessToken, user: result.body.user };
}

async function main() {
  console.log('\ndata requests (export / delete)\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const User = require('../../src/models/User');
  const Status = require('../../src/models/Status');
  const Chat = require('../../src/models/Chat');
  const Message = require('../../src/models/Message');
  const DataRequest = require('../../src/models/DataRequest');

  const login = await fetch(`${API}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const loginBody = await login.json();
  const headers = { Cookie: (login.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; '), 'X-Admin-CSRF': loginBody.csrfToken };
  check('admin login works', login.status === 200 && Boolean(loginBody.csrfToken), login.status);

  const subject = await register('subject');
  const friend = await register('friend');
  const chat = await api('POST', '/api/chats', { token: subject.accessToken, body: { type: 'direct', participantId: friend.user.id } });
  const chatId = chat.body._id || chat.body.id;
  const message = await api('POST', '/api/messages', { token: subject.accessToken, body: { chatId, type: 'text', content: `export me ${run}` } });
  const status = await Status.create({ userId: subject.user.id, text: `export status ${run}` });

  try {
    // Auth gates.
    for (const [method, route] of [
      ['GET', '/api/admin/data-requests'],
      ['POST', '/api/admin/data-requests'],
      ['GET', '/api/admin/data-requests/5f0000000000000000000000/download'],
    ]) {
      check(`${method} ${route} requires the admin session`, (await api(method, route)).status === 401);
      check(`${method} ${route} rejects a user token`, (await api(method, route, { token: subject.accessToken })).status === 401);
    }
    check('creating a request requires the CSRF header', (await api('POST', '/api/admin/data-requests', { headers: { Cookie: headers.Cookie }, body: { userId: subject.user.id, type: 'export' } })).status === 403);

    // A completed export.
    const created = await api('POST', '/api/admin/data-requests', { headers, body: { userId: subject.user.id, type: 'export', reason: `GDPR test ${run}` } });
    check('creating an export request works', created.status === 201 && created.body.request.status === 'pending', created.status);
    const exportId = created.body.request.id;
    const duplicate = await api('POST', '/api/admin/data-requests', { headers, body: { userId: subject.user.id, type: 'export' } });
    check('a duplicate pending request is refused', duplicate.status === 409, duplicate.status);
    const processed = await api('POST', `/api/admin/data-requests/${exportId}/process`, { headers, body: {} });
    check('processing the export works', processed.status === 200 && processed.body.request.status === 'completed', processed.status);
    check('the export records its size', processed.body.request.exportBytes > 0, processed.body.request.exportBytes);

    const list = await api('GET', `/api/admin/data-requests?type=export&limit=20`, { headers });
    check('the request list is paginated', list.status === 200 && typeof list.body.total === 'number' && typeof list.body.pageCount === 'number');
    check('the list never includes the export payload', !list.text.includes('exportData') && !list.text.includes('contactProfiles'), 'payload leaked');

    const download = await api('GET', `/api/admin/data-requests/${exportId}/download`, { headers, raw: true });
    check('the export download works', download.status === 200, download.status);
    check('the export is a JSON attachment', /application\/json/.test(String(download.headers.get('content-type'))), download.headers.get('content-type'));
    const exported = JSON.parse(download.text);
    check('the export includes the profile', exported.profile?.email === subject.identifier, exported.profile?.email);
    check('the export includes the sent message', (exported.messages || []).some((row) => row.content.includes(`export me ${run}`)), (exported.messages || []).length);
    check('the export includes the status', (exported.statuses || []).some((row) => row.text === `export status ${run}`));
    check('the export has no password or token fields', !/(password|twoFactorSecret|accessToken)":/i.test(download.text), 'secret-looking field');

    // Grace + cancel.
    const scheduled = await api('POST', '/api/admin/data-requests', { headers, body: { userId: subject.user.id, type: 'delete', graceDays: 30, reason: 'scheduled test' } });
    check('a deletion can be scheduled with a grace period', scheduled.status === 201 && scheduled.body.request.status === 'scheduled' && Boolean(scheduled.body.request.scheduledFor), scheduled.body.request?.status);
    const cancel = await api('POST', `/api/admin/data-requests/${scheduled.body.request.id}/cancel`, { headers, body: {} });
    check('a scheduled deletion can be cancelled', cancel.status === 200 && cancel.body.request.status === 'cancelled', cancel.status);

    // Immediate deletion.
    const deletion = await api('POST', '/api/admin/data-requests', { headers, body: { userId: subject.user.id, type: 'delete', reason: 'deletion test' } });
    check('a deletion request can be created', deletion.status === 201, deletion.status);
    const deletionId = deletion.body.request.id;
    const refused = await api('POST', `/api/admin/data-requests/${deletionId}/process`, { headers, body: {} });
    check('deletion needs an explicit confirmation', refused.status === 400, refused.status);
    const executed = await api('POST', `/api/admin/data-requests/${deletionId}/process`, { headers, body: { confirm: true } });
    check('confirmed deletion works', executed.status === 200 && executed.body.request.status === 'completed', executed.status);
    check('the user is deleted', (await User.findById(subject.user.id)) === null);
    check('their messages are deleted', (await Message.countDocuments({ senderId: subject.user.id })) === 0);
    check('their statuses are deleted', (await Status.countDocuments({ userId: subject.user.id })) === 0);
    const chatAfter = await Chat.findById(chatId).lean();
    check('their chat membership is removed', !chatAfter || !(chatAfter.participants || []).some((id) => String(id) === String(subject.user.id)), chatAfter?.participants);
    check('the downloaded export still contains no secrets', !/(password|twoFactorSecret)/i.test(download.text));

    // Audit.
    const audit = await api('GET', '/api/admin/audit?search=data_request&days=1', { headers });
    const actions = (audit.body.entries || []).map((row) => row.action);
    check('data requests are audited', ['data_request_create', 'data_request_export', 'data_request_cancel', 'data_request_delete'].every((action) => actions.includes(action)), actions.slice(0, 8));
  } finally {
    await DataRequest.deleteMany({ userLabel: new RegExp(`dr-(subject|friend)-${run}`) });
    await User.deleteMany({ email: new RegExp(`^dr-(subject|friend)-${run}@chatgram\\.test$`) });
    await Chat.deleteMany({ _id: new mongoose.Types.ObjectId(String(chatId)) }).catch(() => undefined);
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', String((error && error.stack) || error).slice(0, 900));
  process.exit(1);
});
