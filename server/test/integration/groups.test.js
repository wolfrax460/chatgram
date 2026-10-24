/**
 * Integration test: groups (section E rest).
 *
 * Covers permissions, member changes, system messages, last-admin handoff,
 * empty-group deletion, group settings, invite links, pinning, shared media,
 * "seen by" and @mentions — with three real users.
 *
 *   cd server && node test/integration/groups.test.js
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';

let passed = 0;
const failures = [];
const state = {};

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
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const run = Date.now().toString(36);
const PASSWORD = 'GroupPass1!';

async function createUser(label) {
  const identifier = `grp-${label}-${run}@chatgram.test`;
  const res = await api('POST', '/api/auth/register', {
    body: { displayName: `Group ${label}`, identifier, password: PASSWORD },
  });
  if (res.status !== 201) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken, id: res.body.user.id, displayName: `Group ${label}` };
}

async function messages(token, chatId) {
  const res = await api('GET', `/api/messages?chatId=${chatId}&limit=100`, { token });
  return res.body?.messages || [];
}

async function main() {
  console.log(`\ngroups integration test against ${BASE}\n`);
  const health = await api('GET', '/api/health');
  if (health.status !== 200) {
    console.log('Start the local API first (docs/local-staging.md).');
    process.exit(1);
  }

  const alice = await createUser('alice'); // creator + first admin
  const bob = await createUser('bob');
  const carol = await createUser('carol');
  const dave = await createUser('dave');
  state.users = [alice, bob, carol, dave];
  console.log('[create]');

  const created = await api('POST', '/api/chats', {
    token: alice.token,
    body: { type: 'group', groupName: `Test group ${run}`, participantIds: [bob.id, carol.id] },
  });
  check('create group -> 201', created.status === 201, `got ${created.status}`);
  const chatId = created.body?._id;
  state.chatId = chatId;
  check('creator is recorded as groupCreatedBy', String(created.body?.groupCreatedBy) === alice.id, String(created.body?.groupCreatedBy));
  check('creator is the first admin', (created.body?.groupAdmins || []).map(String).includes(alice.id));
  check('default settings: anyone can edit info', created.body?.groupSettings?.whoCanEditInfo === 'all');
  check('default settings: admins add members', created.body?.groupSettings?.whoCanAddMembers === 'admins');

  const tooLong = await api('POST', '/api/chats', {
    token: alice.token,
    body: { type: 'group', groupName: 'x'.repeat(120), participantIds: [bob.id] },
  });
  check('group name over 100 chars -> 400', tooLong.status === 400, `got ${tooLong.status}`);

  console.log('\n[members]');
  const roster = await api('GET', `/api/chats/${chatId}/participants`, { token: bob.token });
  check('member list -> 200', roster.status === 200, `got ${roster.status}`);
  check('roster has 3 members', roster.body?.memberCount === 3, String(roster.body?.memberCount));
  check('roster flags the admin', (roster.body?.members || []).find((m) => m._id === alice.id)?.isAdmin === true);
  check('roster flags "you"', (roster.body?.members || []).find((m) => m._id === bob.id)?.isYou === true);
  check('roster includes joinedAt', Boolean((roster.body?.members || [])[0]?.joinedAt));
  check('roster returns group meta', roster.body?.group?.name === `Test group ${run}`, JSON.stringify(roster.body?.group));
  const outsider = await api('GET', `/api/chats/${chatId}/participants`, { token: dave.token });
  check('non-member cannot read the roster -> 403', outsider.status === 403, `got ${outsider.status}`);

  console.log('\n[permissions]');
  const nonAdminAdd = await api('POST', `/api/chats/${chatId}/participants`, {
    token: bob.token,
    body: { participantIds: [dave.id] },
  });
  check('non-admin cannot add with admins-only setting -> 403', nonAdminAdd.status === 403, `got ${nonAdminAdd.status}`);
  check('code is GROUP_ADD_FORBIDDEN', nonAdminAdd.body?.code === 'GROUP_ADD_FORBIDDEN', JSON.stringify(nonAdminAdd.body));

  const adminAdd = await api('POST', `/api/chats/${chatId}/participants`, {
    token: alice.token,
    body: { participantIds: [dave.id] },
  });
  check('admin adds a member -> 200', adminAdd.status === 200, `got ${adminAdd.status} ${JSON.stringify(adminAdd.body)}`);
  let history = await messages(alice.token, chatId);
  check('adding posts a system message', history.some((m) => m.type === 'system' && /added/i.test(m.content || '')), JSON.stringify(history.slice(-2)));
  check('system messages never appear as normal text', history.filter((m) => m.type === 'system').every((m) => m.senderId));

  // ------------------------------------------------------------ group photo
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  async function uploadGroupPhoto(token, id, bytes, mimetype, name) {
    const form = new FormData();
    form.append('avatar', new Blob([bytes], { type: mimetype }), name);
    const response = await fetch(`${BASE}/api/chats/${id}/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
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

  const memberPhotoDefault = await uploadGroupPhoto(carol.token, chatId, PNG, 'image/png', 'group.png');
  check('default settings let any member change the photo', memberPhotoDefault.status === 200, `got ${memberPhotoDefault.status}`);
  const photo = await uploadGroupPhoto(alice.token, chatId, PNG, 'image/png', 'group.png');
  check('admin changes the group photo -> 200', photo.status === 200, `got ${photo.status} ${JSON.stringify(photo.body)}`);
  check('group photo URL is stored', typeof photo.body?.url === 'string' && photo.body.url.length > 0, JSON.stringify(photo.body?.url));
  const chatWithPhoto = await api('GET', `/api/chats/${chatId}`, { token: bob.token });
  check('members see the new group photo', chatWithPhoto.body?.groupAvatar === photo.body.url, String(chatWithPhoto.body?.groupAvatar));
  history = await messages(alice.token, chatId);
  check('group photo change posts a system message', history.some((m) => m.type === 'system' && /group photo/i.test(m.content || '')));

  const nonImage = await uploadGroupPhoto(alice.token, chatId, Buffer.from('%PDF-1.4'), 'application/pdf', 'doc.pdf');
  check('non-image group photo -> 415', nonImage.status === 415, `got ${nonImage.status}`);

  const nonAdminRemove = await api('DELETE', `/api/chats/${chatId}/participants/${bob.id}`, { token: carol.token });
  check('non-admin cannot remove members -> 403', nonAdminRemove.status === 403, `got ${nonAdminRemove.status}`);
  const nonAdminPromote = await api('POST', `/api/chats/${chatId}/admins`, {
    token: carol.token,
    body: { userId: carol.id, isAdmin: true },
  });
  check('non-admin cannot promote -> 403', nonAdminPromote.status === 403, `got ${nonAdminPromote.status}`);

  const promote = await api('POST', `/api/chats/${chatId}/admins`, {
    token: alice.token,
    body: { userId: bob.id, isAdmin: true },
  });
  check('admin promotes Bob -> 200', promote.status === 200, `got ${promote.status}`);
  history = await messages(alice.token, chatId);
  check('promotion posts a system message', history.some((m) => m.type === 'system' && /now an admin/i.test(m.content || '')));

  const demote = await api('POST', `/api/chats/${chatId}/admins`, {
    token: bob.token,
    body: { userId: alice.id, isAdmin: false },
  });
  check('Bob demotes Alice (not last admin) -> 200', demote.status === 200, `got ${demote.status}`);
  const lastAdminDemote = await api('POST', `/api/chats/${chatId}/admins`, {
    token: bob.token,
    body: { userId: bob.id, isAdmin: false },
  });
  check('last admin cannot demote themselves -> 400 LAST_ADMIN', lastAdminDemote.status === 400 && lastAdminDemote.body?.code === 'LAST_ADMIN', JSON.stringify(lastAdminDemote.body));

  console.log('\n[settings]');
  const settings = await api('PATCH', `/api/chats/${chatId}`, {
    token: bob.token,
    body: { groupSettings: { whoCanSendMessages: 'admins' } },
  });
  check('admin updates settings -> 200', settings.status === 200, `got ${settings.status} ${JSON.stringify(settings.body)}`);
  check('settings persist who can send', settings.body?.groupSettings?.whoCanSendMessages === 'admins');
  const blockedSend = await api('POST', '/api/messages', {
    token: carol.token,
    body: { chatId, type: 'text', content: 'can I talk?' },
  });
  check('member cannot send when admins-only -> 403', blockedSend.status === 403, `got ${blockedSend.status}`);
  check('code is GROUP_SEND_FORBIDDEN', blockedSend.body?.code === 'GROUP_SEND_FORBIDDEN', JSON.stringify(blockedSend.body));
  const adminSend = await api('POST', '/api/messages', { token: bob.token, body: { chatId, type: 'text', content: 'admin speaking' } });
  check('admin can still send -> 201', adminSend.status === 201, `got ${adminSend.status}`);
  await api('PATCH', `/api/chats/${chatId}`, { token: bob.token, body: { groupSettings: { whoCanSendMessages: 'all', whoCanEditInfo: 'admins' } } });

  const nonAdminEdit = await api('PATCH', `/api/chats/${chatId}`, { token: carol.token, body: { groupName: 'Hijacked' } });
  check('non-admin cannot edit info when admins-only -> 403', nonAdminEdit.status === 403 && nonAdminEdit.body?.code === 'GROUP_EDIT_FORBIDDEN', JSON.stringify(nonAdminEdit.body));
  const nonAdminPhotoForbidden = await uploadGroupPhoto(carol.token, chatId, PNG, 'image/png', 'nope.png');
  check('non-admin cannot change the photo when admins-only -> 403', nonAdminPhotoForbidden.status === 403, `got ${nonAdminPhotoForbidden.status}`);
  const edit = await api('PATCH', `/api/chats/${chatId}`, {
    token: bob.token,
    body: { groupName: `Renamed ${run}`, groupDescription: 'A group for the tests' },
  });
  check('admin edits name + description -> 200', edit.status === 200, `got ${edit.status}`);
  check('description saved', edit.body?.groupDescription === 'A group for the tests', JSON.stringify(edit.body?.groupDescription));
  history = await messages(alice.token, chatId);
  check('edit posts system messages', history.some((m) => m.type === 'system' && /changed the group name/i.test(m.content || '')));

  console.log('\n[invites]');
  const erin = await createUser('erin');
  state.users.push(erin);
  const inviteAdmin = await api('POST', `/api/chats/${chatId}/invite`, { token: bob.token });
  check('admin creates invite -> 200', inviteAdmin.status === 200, `got ${inviteAdmin.status}`);
  const token = inviteAdmin.body?.token;
  check('invite returns a token and path', typeof token === 'string' && inviteAdmin.body?.path === `/join/${token}`, JSON.stringify(inviteAdmin.body));
  const inviteNonAdmin = await api('POST', `/api/chats/${chatId}/invite`, { token: carol.token });
  check('non-admin cannot create invite -> 403', inviteNonAdmin.status === 403, `got ${inviteNonAdmin.status}`);
  const preview = await api('GET', `/api/chats/invite/${token}`, { token: erin.token });
  check('invite preview -> 200', preview.status === 200, `got ${preview.status}`);
  check('preview shows the group name', preview.body?.name === `Renamed ${run}`, JSON.stringify(preview.body?.name));
  const join = await api('POST', `/api/chats/invite/${token}/join`, { token: erin.token });
  check('join via invite -> 200', join.status === 200 && join.body?.alreadyMember === false, JSON.stringify(join.body));
  const joinAgain = await api('POST', `/api/chats/invite/${token}/join`, { token: erin.token });
  check('joining twice is idempotent', joinAgain.body?.alreadyMember === true, JSON.stringify(joinAgain.body));
  const revoke = await api('DELETE', `/api/chats/${chatId}/invite`, { token: bob.token });
  check('revoke invite -> 200', revoke.status === 200 && revoke.body?.inviteEnabled === false, JSON.stringify(revoke.body));
  const previewAfterRevoke = await api('GET', `/api/chats/invite/${token}`, { token: erin.token });
  check('revoked invite -> 404 INVITE_INVALID', previewAfterRevoke.status === 404 && previewAfterRevoke.body?.code === 'INVITE_INVALID', JSON.stringify(previewAfterRevoke.body));

  console.log('\n[pin, media, mentions, seen-by]');
  const pinnedTarget = await api('POST', '/api/messages', { token: bob.token, body: { chatId, type: 'text', content: 'Pin me please' } });
  const pin = await api('POST', `/api/chats/${chatId}/pin`, { token: bob.token, body: { messageId: pinnedTarget.body._id } });
  check('pin a message -> 200', pin.status === 200, `got ${pin.status}`);
  const chatAfterPin = await api('GET', `/api/chats/${chatId}`, { token: alice.token });
  check('chat exposes the pinned message id', String(chatAfterPin.body?.pinnedMessageId) === String(pinnedTarget.body._id), String(chatAfterPin.body?.pinnedMessageId));
  const unpin = await api('DELETE', `/api/chats/${chatId}/pin`, { token: bob.token });
  check('unpin -> 200', unpin.status === 200);

  await api('POST', '/api/messages', {
    token: bob.token,
    body: { chatId, type: 'image', mediaUrl: 'https://example.com/group-image.png' },
  });
  await api('POST', '/api/messages', {
    token: bob.token,
    body: { chatId, type: 'text', content: 'docs at https://chatgram.example/help' },
  });
  const media = await api('GET', `/api/chats/${chatId}/media`, { token: carol.token });
  check('shared media -> 200', media.status === 200, `got ${media.status}`);
  check('media lists the image', (media.body?.media || []).some((m) => m.url === 'https://example.com/group-image.png'), JSON.stringify(media.body?.media?.slice(0, 2)));
  check('media lists the link', (media.body?.links || []).some((l) => l.url.startsWith('https://chatgram.example')), JSON.stringify(media.body?.links));
  const mediaOutsider = await api('GET', `/api/chats/${chatId}/media`, { token: (await createUser('outsider')).token });
  check('outsider cannot read shared media -> 403', mediaOutsider.status === 403, `got ${mediaOutsider.status}`);

  const mentionMessage = await api('POST', '/api/messages', {
    token: bob.token,
    body: { chatId, type: 'text', content: `@${carol.displayName} please check` },
  });
  check('mention message sent -> 201', mentionMessage.status === 201, `got ${mentionMessage.status}`);
  check('mention stores the mentioned user', (mentionMessage.body?.mentionUserIds || []).map(String).includes(carol.id), JSON.stringify(mentionMessage.body?.mentionUserIds));

  const bobMessage = await api('POST', '/api/messages', { token: bob.token, body: { chatId, type: 'text', content: 'read this' } });
  await api('POST', `/api/messages/chat/${chatId}/read`, { token: carol.token });
  const readers = await api('GET', `/api/messages/${bobMessage.body._id}/readers`, { token: bob.token });
  check('seen-by for the sender -> 200', readers.status === 200, `got ${readers.status}`);
  check('seen-by lists the reader', (readers.body?.readers || []).some((r) => r.id === carol.id), JSON.stringify(readers.body));
  const readersOther = await api('GET', `/api/messages/${bobMessage.body._id}/readers`, { token: carol.token });
  check('another member cannot read the list -> 403', readersOther.status === 403, `got ${readersOther.status}`);

  console.log('\n[leave + handoff]');
  const leaveDave = await api('DELETE', `/api/chats/${chatId}/leave`, { token: dave.token });
  check('member leaves -> 200', leaveDave.status === 200, `got ${leaveDave.status}`);
  history = await messages(bob.token, chatId);
  check('leave posts "left" system message', history.some((m) => m.type === 'system' && /left/i.test(m.content || '')));
  const daveChats = await api('GET', `/api/chats/${chatId}`, { token: dave.token });
  check('leaver loses access -> 403/404', daveChats.status === 403 || daveChats.status === 404, `got ${daveChats.status}`);

  // Last-admin handoff: remove Bob from admins first so Alice is the only admin.
  const handoffGroup = await api('POST', '/api/chats', {
    token: bob.token,
    body: { type: 'group', groupName: `Handoff ${run}`, participantIds: [alice.id, carol.id] },
  });
  const handoffId = handoffGroup.body._id;
  // Bob is the only admin here; he leaves and the longest-standing member takes over.
  const bobLeave = await api('DELETE', `/api/chats/${handoffId}/leave`, { token: bob.token });
  check('last admin leaving promotes somebody', bobLeave.status === 200 && Boolean(bobLeave.body?.promoted), JSON.stringify(bobLeave.body));
  const handoffRoster = await api('GET', `/api/chats/${handoffId}/participants`, { token: alice.token });
  check('promoted member is an admin', Boolean(handoffRoster.body?.members?.find((m) => m.isAdmin)), JSON.stringify(handoffRoster.body?.members));

  // Empty group is deleted.
  const emptyGroup = await api('POST', '/api/chats', {
    token: alice.token,
    body: { type: 'group', groupName: `Empty ${run}`, participantIds: [carol.id] },
  });
  const emptyId = emptyGroup.body._id;
  await api('DELETE', `/api/chats/${emptyId}/leave`, { token: carol.token });
  const lastLeave = await api('DELETE', `/api/chats/${emptyId}/leave`, { token: alice.token });
  check('last member leaving deletes the group', lastLeave.body?.deleted === true, JSON.stringify(lastLeave.body));
  const gone = await api('GET', `/api/chats/${emptyId}`, { token: alice.token });
  check('deleted group is gone (404)', gone.status === 404, `got ${gone.status}`);

  // --------------------------------------------------------------- cleanup
  try {
    const mongoose = require('mongoose');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', {
      serverSelectionTimeoutMS: 4000,
    });
    const User = require('../../src/models/User');
    const Chat = require('../../src/models/Chat');
    const Message = require('../../src/models/Message');
    const ids = state.users.map((u) => u.id);
    const chats = await Chat.find({ participants: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } }).select('_id');
    const chatIds = chats.map((c) => c._id).concat([new mongoose.Types.ObjectId(chatId)]);
    await Message.deleteMany({ chatId: { $in: chatIds } });
    await Chat.deleteMany({ _id: { $in: chatIds } });
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
