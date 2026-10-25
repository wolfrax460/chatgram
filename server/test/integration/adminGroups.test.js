/**
 * 9b groups administration: list/search, members + reports, freeze (read-only
 * enforcement), change owner, remove member and delete — all audited.
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/adminGroups.test.js
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
  const identifier = `grp-${label}-${run}@chatgram.test`;
  const result = await api('POST', '/api/auth/register', {
    body: { displayName: `GRP ${label} ${run}`, identifier, password: 'GrpTest1!' },
  });
  if (result.status !== 201) throw new Error(`register ${label}: ${result.status}`);
  return { identifier, password: 'GrpTest1!', accessToken: result.body.accessToken, user: result.body.user };
}

async function main() {
  console.log('\ngroups administration\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
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
  const member = await register('member');
  const created = await api('POST', '/api/chats', {
    token: owner.accessToken,
    body: { type: 'group', groupName: `GRP MOD ${run}`, participantIds: [member.user.id] },
  });
  const groupId = created.body?._id || created.body?.id;
  check('a test group was created', created.status === 201 && Boolean(groupId), created.status);

  try {
    // Auth gates.
    for (const [method, route] of [
      ['GET', '/api/admin/groups'],
      ['GET', `/api/admin/groups/${groupId}`],
      ['POST', `/api/admin/groups/${groupId}/freeze`],
      ['POST', `/api/admin/groups/${groupId}/owner`],
      ['DELETE', `/api/admin/groups/${groupId}`],
    ]) {
      check(`${method} ${route} requires the admin session`, (await api(method, route)).status === 401);
      check(`${method} ${route} rejects a user token`, (await api(method, route, { token: owner.accessToken })).status === 401);
    }
    check('group actions require the CSRF header', (await api('POST', `/api/admin/groups/${groupId}/freeze`, { headers: { Cookie: headers.Cookie }, body: { frozen: true } })).status === 403);

    // List + detail.
    const list = await api('GET', `/api/admin/groups?search=${encodeURIComponent(`GRP MOD ${run}`)}`, { headers });
    check('the group appears in the groups list', list.status === 200 && (list.body.groups || []).some((row) => row.id === groupId), (list.body.groups || []).length);
    check('the list is paginated', typeof list.body.total === 'number' && typeof list.body.pageCount === 'number');
    const detail = await api('GET', `/api/admin/groups/${groupId}`, { headers });
    check('the group detail returns the members', detail.status === 200 && (detail.body.members || []).length === 2, detail.status);
    check('the owner is marked in the member list', (detail.body.members || []).some((row) => row.isOwner && row.id === owner.user.id), detail.body.members);
    check('the detail never returns secrets', !/(password|twoFactorSecret|accessToken)"/i.test(detail.text), 'secret-looking field');

    // Freeze blocks both members.
    const freeze = await api('POST', `/api/admin/groups/${groupId}/freeze`, { headers, body: { frozen: true } });
    check('freezing works', freeze.status === 200 && freeze.body.frozen === true, freeze.status);
    const blockedSend = await api('POST', '/api/messages', { token: member.accessToken, body: { chatId: groupId, type: 'text', content: 'should be blocked' } });
    check('a frozen group rejects messages with GROUP_FROZEN', blockedSend.status === 403 && blockedSend.body.code === 'GROUP_FROZEN', `${blockedSend.status} ${blockedSend.body?.code}`);
    const unfreeze = await api('POST', `/api/admin/groups/${groupId}/freeze`, { headers, body: { frozen: false } });
    check('unfreezing works', unfreeze.status === 200 && unfreeze.body.frozen === false, unfreeze.status);
    const allowedSend = await api('POST', '/api/messages', { token: member.accessToken, body: { chatId: groupId, type: 'text', content: 'now allowed' } });
    check('messages work again after unfreezing', allowedSend.status === 201, allowedSend.status);

    // Change owner.
    const ownerChange = await api('POST', `/api/admin/groups/${groupId}/owner`, { headers, body: { userId: member.user.id } });
    check('changing the owner works', ownerChange.status === 200, ownerChange.status);
    const afterOwner = await api('GET', `/api/admin/groups/${groupId}`, { headers });
    check('the detail shows the new owner', afterOwner.body.group?.owner?.id === member.user.id, afterOwner.body.group?.owner);
    const notMember = await api('POST', `/api/admin/groups/${groupId}/owner`, { headers, body: { userId: '5f0000000000000000000000' } });
    check('an owner who is not a member is refused', [400, 404].includes(notMember.status), notMember.status);

    // Remove a member.
    const removed = await api('POST', `/api/admin/groups/${groupId}/members/${owner.user.id}/remove`, { headers, body: {} });
    check('removing a member works', removed.status === 200, removed.status);
    const afterRemove = await api('GET', `/api/admin/groups/${groupId}`, { headers });
    check('the removed member is gone', (afterRemove.body.members || []).every((row) => row.id !== owner.user.id), afterRemove.body.members);
    const removedSend = await api('POST', '/api/messages', { token: owner.accessToken, body: { chatId: groupId, type: 'text', content: 'not a member' } });
    check('a removed member cannot post', removedSend.status === 403 || removedSend.status === 404, removedSend.status);

    // Audit trail.
    const audit = await api('GET', '/api/admin/audit?search=group_&days=1', { headers });
    const actions = (audit.body.entries || []).map((row) => row.action);
    check('group moderation actions are audited', ['group_freeze', 'group_unfreeze', 'group_change_owner', 'group_remove_member'].every((action) => actions.includes(action)), actions.slice(0, 6));

    // Delete.
    const deletion = await api('DELETE', `/api/admin/groups/${groupId}`, { headers });
    check('deleting the group works', deletion.status === 200, deletion.status);
    check('the group is gone', (await Chat.findById(groupId)) === null);
    check('the group messages are gone', (await Message.countDocuments({ chatId: groupId })) === 0);
    check('a deleted group returns 404', (await api('GET', `/api/admin/groups/${groupId}`, { headers })).status === 404);
    check('deletion is audited', (await api('GET', '/api/admin/audit?search=group_delete&days=1', { headers })).body.entries.length >= 1);
  } finally {
    await Chat.deleteMany({ _id: new mongoose.Types.ObjectId(String(groupId)) });
    await Message.deleteMany({ chatId: new mongoose.Types.ObjectId(String(groupId)) });
    await User.deleteMany({ _id: { $in: [owner.user.id, member.user.id].map((id) => new mongoose.Types.ObjectId(String(id))) } });
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', String((error && error.stack) || error).slice(0, 900));
  process.exit(1);
});
