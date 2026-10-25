/**
 * 9b moderation: account states (suspend / ban / unban) + the report queue
 * (message, user, status and group reports) with audited resolutions.
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/adminModeration.test.js
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

async function api(method, route, { token, body, headers } = {}) {
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
  const identifier = `mod-${label}-${run}@chatgram.test`;
  const password = 'ModTest1!';
  const result = await api('POST', '/api/auth/register', { body: { displayName: `MOD ${label} ${run}`, identifier, password } });
  if (result.status !== 201) throw new Error(`register ${label}: ${result.status} ${JSON.stringify(result.body).slice(0, 200)}`);
  return { identifier, password, accessToken: result.body.accessToken, refreshToken: result.body.refreshToken, user: result.body.user };
}

async function main() {
  console.log('\nmoderation + report queue\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const User = require('../../src/models/User');
  const Chat = require('../../src/models/Chat');
  const Message = require('../../src/models/Message');
  const Report = require('../../src/models/Report');

  const login = await fetch(`${API}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const admin = await login.json();
  const headers = { Cookie: (login.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; '), 'X-Admin-CSRF': admin.csrfToken };
  check('admin login works', login.status === 200 && Boolean(admin.csrfToken), login.status);

  const reporter = await register('reporter');
  const target = await register('target');
  const created = { chats: [], messages: [], statuses: [], users: [reporter.user.id, target.user.id] };

  try {
    // Auth gates.
    for (const [method, route] of [
      ['GET', '/api/admin/reports'],
      ['GET', '/api/admin/reports/5f0000000000000000000000'],
      ['POST', `/api/admin/users/${target.user.id}/suspend`],
      ['POST', `/api/admin/users/${target.user.id}/ban`],
      ['POST', `/api/admin/users/${target.user.id}/unban`],
    ]) {
      check(`${method} ${route} requires the admin session`, (await api(method, route)).status === 401);
      check(`${method} ${route} rejects a normal user token`, (await api(method, route, { token: target.accessToken })).status === 401);
    }

    // --- create one report of each type ------------------------------------
    const chat = await api('POST', '/api/chats', { token: reporter.accessToken, body: { type: 'direct', participantId: target.user.id } });
    const chatId = chat.body._id || chat.body.id;
    created.chats.push(chatId);
    const message = await api('POST', '/api/messages', { token: target.accessToken, body: { chatId, type: 'text', content: `reported content ${run}` } });
    created.messages.push(message.body._id || message.body.id);
    const messageReport = await api('POST', `/api/messages/${created.messages[0]}/report`, { token: reporter.accessToken, body: { reason: 'spam', details: 'unsolicited advertising' } });
    check('reporting a message works', messageReport.status === 201, messageReport.status);
    const userReport = await api('POST', `/api/users/${target.user.id}/report`, { token: reporter.accessToken, body: { reason: 'abuse', details: 'abusive profile' } });
    check('reporting a user works', userReport.status === 201, userReport.status);

    const status = await api('POST', '/api/status', { token: target.accessToken, body: { caption: `reported status ${run}` } });
    check('target can post a text status', status.status === 201, status.status);
    created.statuses.push(status.body._id || status.body.id);
    const statusReport = await api('POST', `/api/status/${created.statuses[0]}/report`, { token: reporter.accessToken, body: { reason: 'abuse', details: 'offensive caption' } });
    check('reporting a status works (new endpoint)', statusReport.status === 201, statusReport.status);

    const group = await api('POST', '/api/chats', { token: target.accessToken, body: { type: 'group', groupName: `MOD GROUP ${run}`, participantIds: [reporter.user.id] } });
    const groupId = group.body._id || group.body.id;
    created.chats.push(groupId);
    const groupReport = await api('POST', `/api/chats/${groupId}/report`, { token: reporter.accessToken, body: { reason: 'spam', details: 'spam group' } });
    check('reporting a group works (new endpoint)', groupReport.status === 201, groupReport.status);
    const ownReport = await api('POST', `/api/status/${created.statuses[0]}/report`, { token: target.accessToken, body: {} });
    check('reports cannot be sent for your own status', ownReport.status === 400, ownReport.status + ' ' + JSON.stringify(ownReport.body).slice(0, 120));

    // --- report queue -------------------------------------------------------
    const queue = await api('GET', '/api/admin/reports?status=open&limit=20', { headers });
    check('reports queue returns 200', queue.status === 200, queue.status);
    check('the queue contains the four reports', (queue.body.reports || []).length >= 4, (queue.body.reports || []).length);
    check('the queue is paginated with status counts', typeof queue.body.total === 'number' && typeof queue.body.counts === 'object', queue.body.counts);
    check('reports never leak passwords or tokens', !/password|token|twoFactorSecret/i.test(queue.text), 'secret-looking field');
    const messageReportRow = (queue.body.reports || []).find((row) => row.targetMessageId === created.messages[0]);
    check('message reports carry the snapshot', Boolean(messageReportRow?.messageSnapshot?.includes('reported content')), messageReportRow?.messageSnapshot);
    check('reports include the reporter and target names', Boolean(messageReportRow?.reporter?.displayName) && Boolean(messageReportRow?.targetUser?.displayName), messageReportRow);

    const detail = await api('GET', `/api/admin/reports/${messageReportRow.id}`, { headers });
    check('report detail returns 200', detail.status === 200, detail.status);
    check('detail shows the message content read-only', String(detail.body.message?.content || '').includes(`reported content ${run}`), detail.body.message?.content);
    check('detail never returns secrets', !/password|twoFactorSecret|accessToken/i.test(detail.text));

    // --- resolve: remove content -------------------------------------------
    const remove = await api('POST', `/api/admin/reports/${messageReportRow.id}/resolve`, { headers, body: { action: 'remove_content' } });
    check('resolving with remove_content works', remove.status === 200, remove.status);
    const removedMessage = await Message.findById(created.messages[0]).lean();
    check('the reported message is removed for everyone', removedMessage?.isDeleted === true, removedMessage?.isDeleted);
    const resolvedAgain = await api('POST', `/api/admin/reports/${messageReportRow.id}/resolve`, { headers, body: { action: 'dismiss' } });
    check('an actioned report cannot be resolved again', resolvedAgain.status === 400, resolvedAgain.status);

    // --- resolve: suspend the reported user ---------------------------------
    const userReportRow = (queue.body.reports || []).find((row) => row.targetUserId === target.user.id && !row.targetMessageId);
    const suspend = await api('POST', `/api/admin/reports/${userReportRow.id}/resolve`, { headers, body: { action: 'suspend', days: 2, reason: 'abusive profile' } });
    check('resolving with suspend works', suspend.status === 200, suspend.status);
    const suspended = await User.findById(target.user.id).select('status suspendedUntil').lean();
    check('the reported user is suspended', suspended?.status === 'suspended' && Boolean(suspended?.suspendedUntil), suspended);

    const blockedLogin = await api('POST', '/api/auth/login', { body: { identifier: target.identifier, password: target.password } });
    check('a suspended account cannot sign in', blockedLogin.status === 403 && blockedLogin.body.code === 'ACCOUNT_SUSPENDED', blockedLogin.body?.code);
    const blockedApi = await api('GET', '/api/users/me', { token: target.accessToken });
    check('an existing token cannot be used while suspended', blockedApi.status === 403 && blockedApi.body.code === 'ACCOUNT_SUSPENDED', blockedApi.status);
    check('the suspension message is readable', /suspended/i.test(String(blockedLogin.body.message)), blockedLogin.body.message);

    // --- direct account actions --------------------------------------------
    const unban = await api('POST', `/api/admin/users/${target.user.id}/unban`, { headers, body: {} });
    check('unban restores the account', unban.status === 200 && unban.body.user.status === 'active', unban.status);
    check('the restored account can sign in again', (await api('POST', '/api/auth/login', { body: { identifier: target.identifier, password: target.password } })).status === 200);

    const ban = await api('POST', `/api/admin/users/${target.user.id}/ban`, { headers, body: { reason: 'repeated abuse' } });
    check('ban works', ban.status === 200 && ban.body.user.status === 'banned', ban.status);
    const bannedLogin = await api('POST', '/api/auth/login', { body: { identifier: target.identifier, password: target.password } });
    check('a banned account cannot sign in', bannedLogin.status === 403 && bannedLogin.body.code === 'ACCOUNT_BANNED', bannedLogin.body?.code);
    check('a banned account cannot use its old token', [401, 403].includes((await api('GET', '/api/users/me', { token: target.accessToken })).status));

    // --- validation, CSRF, protected accounts -------------------------------
    const noCsrf = await api('POST', `/api/admin/users/${target.user.id}/unban`, { headers: { Cookie: headers.Cookie }, body: {} });
    check('moderation actions require the CSRF header', noCsrf.status === 403, noCsrf.status);
    check('an invalid action is rejected', (await api('POST', `/api/admin/reports/${userReportRow.id}/resolve`, { headers, body: { action: 'nuke' } })).status === 400);
    const supportUser = await User.findOne({ isSupportAccount: true }).select('_id').lean();
    if (supportUser) {
      check('the Support account cannot be moderated', (await api('POST', `/api/admin/users/${supportUser._id}/ban`, { headers, body: {} })).status === 400);
    }

    // --- audit trail --------------------------------------------------------
    const audit = await api('GET', '/api/admin/audit?search=user_&days=1', { headers });
    const actions = (audit.body.entries || []).map((row) => row.action);
    check('moderation actions are audited', ['user_suspend', 'user_ban', 'user_unban'].filter((action) => actions.includes(action)).length >= 2, actions.slice(0, 6));
    const reportAudit = await api('GET', '/api/admin/audit?search=report_resolve&days=1', { headers });
    check('report resolutions are audited', (reportAudit.body.entries || []).length >= 2, (reportAudit.body.entries || []).length);
  } finally {
    await Report.deleteMany({ reporterId: { $in: [reporter.user.id, target.user.id].map((id) => new mongoose.Types.ObjectId(String(id))) } });
    await Message.deleteMany({ chatId: { $in: created.chats.map((id) => new mongoose.Types.ObjectId(String(id))) } });
    await Chat.deleteMany({ _id: { $in: created.chats.map((id) => new mongoose.Types.ObjectId(String(id))) } });
    const StatusModel = require('../../src/models/Status');
    await StatusModel.deleteMany({ user: { $in: [reporter.user.id, target.user.id].map((id) => new mongoose.Types.ObjectId(String(id))) } });
    await User.deleteMany({ _id: { $in: [reporter.user.id, target.user.id].map((id) => new mongoose.Types.ObjectId(String(id))) } });
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', String((error && error.stack) || error).slice(0, 900));
  process.exit(1);
});
