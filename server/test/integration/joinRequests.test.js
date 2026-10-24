/**
 * Join-request approval mode.
 *
 *   cd server && node test/integration/joinRequests.test.js
 */
const mongoose = require('mongoose');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';
const run = Date.now().toString(36);
let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

async function api(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, body: json };
}

async function register(label) {
  const res = await api('POST', '/api/auth/register', {
    body: { displayName: `Join ${label}`, identifier: `join-${label}-${run}@chatgram.test`, password: 'JoinTest1!' },
  });
  if (res.status !== 201) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken, id: res.body.user.id, name: `Join ${label}` };
}

async function main() {
  console.log(`\njoin-request integration test against ${BASE}\n`);
  const admin = await register('admin');
  const member = await register('member');
  const eve = await register('eve');
  const frank = await register('frank');

  const group = await api('POST', '/api/chats', {
    token: admin.token,
    body: { type: 'group', groupName: `Approval group ${run}`, participantIds: [member.id] },
  });
  const groupId = group.body?._id;
  check('setup: approval group created', Boolean(groupId), JSON.stringify(group.body).slice(0, 200));

  // Default: approval is off, joining by id works directly.
  const directJoin = await api('POST', `/api/chats/${groupId}/join-request`, { token: eve.token });
  check('default group lets a request join directly', directJoin.status === 200 && directJoin.body?.joined === true, `${directJoin.status}`);

  // Turn approval on (admin only).
  const nonAdminToggle = await api('PATCH', `/api/chats/${groupId}`, { token: member.token, body: { groupSettings: { requireApproval: true } } });
  check('non-admin cannot enable approval -> 403', nonAdminToggle.status === 403, `got ${nonAdminToggle.status}`);
  const toggle = await api('PATCH', `/api/chats/${groupId}`, { token: admin.token, body: { groupSettings: { requireApproval: true } } });
  check('admin enables approval', toggle.status === 200 && toggle.body?.groupSettings?.requireApproval === true, JSON.stringify(toggle.body?.groupSettings));

  // Eve left the group earlier? She joined directly. Have her leave, then request.
  const leave = await api('DELETE', `/api/chats/${groupId}/leave`, { token: eve.token });
  check('eve leaves so she can request again', leave.status === 200, `${leave.status}`);
  const request = await api('POST', `/api/chats/${groupId}/join-request`, { token: eve.token });
  check('requesting to join -> 202 pending', request.status === 202 && request.body?.pending === true, `${request.status} ${JSON.stringify(request.body)}`);
  const duplicate = await api('POST', `/api/chats/${groupId}/join-request`, { token: eve.token });
  check('a second request is idempotent', [200, 202].includes(duplicate.status) && duplicate.body?.alreadyRequested === true, `${duplicate.status}`);
  const alreadyMember = await api('POST', `/api/chats/${groupId}/join-request`, { token: member.token });
  check('a member cannot request to join -> 400', alreadyMember.status === 400, `${alreadyMember.status}`);

  const nonAdminList = await api('GET', `/api/chats/${groupId}/join-requests`, { token: member.token });
  check('non-admin cannot list requests -> 403', nonAdminList.status === 403, `${nonAdminList.status}`);
  const unauthenticated = await api('GET', `/api/chats/${groupId}/join-requests`);
  check('unauthenticated list -> 401', unauthenticated.status === 401, `${unauthenticated.status}`);
  const list = await api('GET', `/api/chats/${groupId}/join-requests`, { token: admin.token });
  check('admin sees the pending request', list.status === 200 && list.body?.requests?.length === 1, JSON.stringify(list.body).slice(0, 200));
  check('pending request names the user', list.body?.requests?.[0]?.user?.displayName === eve.name, JSON.stringify(list.body?.requests?.[0]?.user));

  // Frank requests, then gets declined.
  const frankRequest = await api('POST', `/api/chats/${groupId}/join-request`, { token: frank.token });
  check('second user can request too', [200, 202].includes(frankRequest.status), `${frankRequest.status}`);
  const decline = await api('POST', `/api/chats/${groupId}/join-requests/${frank.id}/reject`, { token: admin.token });
  check('admin declines a request', decline.status === 200 && decline.body?.approved === false, `${decline.status}`);
  const afterDecline = await api('GET', `/api/chats/${groupId}/join-requests`, { token: admin.token });
  check('declined request is gone', afterDecline.body?.requests?.length === 1, `${afterDecline.body?.requests?.length}`);
  const frankAccess = await api('GET', `/api/chats/${groupId}`, { token: frank.token });
  check('declined user still cannot open the group -> 403/404', [403, 404].includes(frankAccess.status), `${frankAccess.status}`);

  const nonAdminApprove = await api('POST', `/api/chats/${groupId}/join-requests/${eve.id}/approve`, { token: member.token });
  check('non-admin cannot approve -> 403', nonAdminApprove.status === 403, `${nonAdminApprove.status}`);
  const approve = await api('POST', `/api/chats/${groupId}/join-requests/${eve.id}/approve`, { token: admin.token });
  check('admin approves the request', approve.status === 200 && approve.body?.approved === true, `${approve.status}`);
  const eveAccess = await api('GET', `/api/chats/${groupId}`, { token: eve.token });
  check('approved user can open the group', eveAccess.status === 200, `${eveAccess.status}`);
  const members = await api('GET', `/api/chats/${groupId}/participants`, { token: admin.token });
  const memberIds = (members.body?.members || []).map((entry) => String(entry._id));
  check('approved user is in the member list', memberIds.includes(eve.id), memberIds.join(','));
  const emptyList = await api('GET', `/api/chats/${groupId}/join-requests`, { token: admin.token });
  check('request list is empty after approval', emptyList.body?.requests?.length === 0, `${emptyList.body?.requests?.length}`);
  const systemMessages = await api('GET', `/api/messages?chatId=${groupId}`, { token: admin.token });
  check(
    'approval posts a system message',
    (systemMessages.body?.messages || []).some((message) => message.type === 'system' && /approved to join/i.test(message.content || '')),
  );
  const approveAgain = await api('POST', `/api/chats/${groupId}/join-requests/${eve.id}/approve`, { token: admin.token });
  check('approving a gone request -> 404', approveAgain.status === 404, `${approveAgain.status}`);

  // ------------------------------------------------------- invite link path
  const invite = await api('POST', `/api/chats/${groupId}/invite`, { token: admin.token });
  check('invite link created', invite.status === 200 && Boolean(invite.body?.token || invite.body?.inviteToken), JSON.stringify(invite.body).slice(0, 160));
  const token = invite.body?.token || invite.body?.inviteToken;
  const inviteJoin = await api('POST', `/api/chats/invite/${token}/join`, { token: frank.token });
  check('invite join in approval mode returns pending', inviteJoin.status === 202 && inviteJoin.body?.pending === true, `${inviteJoin.status} ${JSON.stringify(inviteJoin.body)}`);
  const pendingList = await api('GET', `/api/chats/${groupId}/join-requests`, { token: admin.token });
  check('invite join appears in the request list', pendingList.body?.requests?.some((entry) => String(entry.user?.id || entry.user?._id) === frank.id), JSON.stringify(pendingList.body).slice(0, 240));

  // ------------------------------------------------------------- cleanup
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 4000 });
    const User = require('../../src/models/User');
    const Chat = require('../../src/models/Chat');
    const Message = require('../../src/models/Message');
    const ids = [admin.id, member.id, eve.id, frank.id].map((id) => new mongoose.Types.ObjectId(id));
    const chats = await Chat.find({ participants: { $in: ids } }).select('_id');
    await Message.deleteMany({ chatId: { $in: chats.map((chat) => chat._id) } });
    await Chat.deleteMany({ _id: { $in: chats.map((chat) => chat._id) } });
    await User.deleteMany({ _id: { $in: ids } });
    await mongoose.disconnect();
  } catch (error) {
    console.log(`  (cleanup skipped: ${error.message})`);
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', error);
  process.exit(1);
});
