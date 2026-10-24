/**
 * Integration test: profile panel, privacy, blocking, mute, report, read receipts
 * and the "who can add me to groups" rule.
 *
 *   cd server && node test/integration/profile.test.js
 *
 * Requires the local staging API (docs/local-staging.md).
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';

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
const PASSWORD = 'ProfilePass1!';

async function createUser(label, usePhone = false) {
  const identifier = usePhone
    ? `+25078${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 90) + 10)}`
    : `prof-${label}-${run}@chatgram.test`;
  const res = await api('POST', '/api/auth/register', {
    body: { displayName: `Profile ${label}`, identifier, password: PASSWORD },
  });
  if (res.status !== 201) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
  return { identifier, token: res.body.accessToken, id: res.body.user.id, displayName: res.body.user.displayName };
}

async function main() {
  console.log(`\nprofile / privacy / blocking integration test against ${BASE}\n`);
  const health = await api('GET', '/api/health');
  if (health.status !== 200) {
    console.log('Start the local API first (docs/local-staging.md).');
    process.exit(1);
  }

  const alice = await createUser('alice');
  // Bob registers with a phone number so the phone-privacy assertions are real.
  const bob = await createUser('bob', true);
  const carol = await createUser('carol');

  // Alice has Bob as a contact; Bob does NOT have Alice in his contacts.
  await api('POST', '/api/contacts', { token: alice.token, body: { userId: bob.id } });

  // --------------------------------------------------------------- profile
  const asContact = await api('GET', `/api/users/${bob.id}/profile`, { token: alice.token });
  check('GET profile as a contact -> 200', asContact.status === 200, `got ${asContact.status}`);
  check('profile returns the display name', asContact.body?.profile?.displayName === bob.displayName);
  check('contact sees the phone number', typeof asContact.body?.profile?.phone === 'string', JSON.stringify(asContact.body?.profile));
  check('a phone-only account has no email to show', asContact.body?.profile?.email === null);
  check('isContact is true for a contact', asContact.body?.isContact === true);
  check('isSelf is false for somebody else', asContact.body?.isSelf === false);

  const asStranger = await api('GET', `/api/users/${alice.id}/profile`, { token: bob.token });
  check('non-contact profile -> 200', asStranger.status === 200, `got ${asStranger.status}`);
  check('non-contact does NOT see the phone', asStranger.body?.profile?.phone === null, JSON.stringify(asStranger.body?.profile));
  check('non-contact does NOT see the email', asStranger.body?.profile?.email === null);
  check('isContact is false for a stranger', asStranger.body?.isContact === false);

  const self = await api('GET', `/api/users/${alice.id}/profile`, { token: alice.token });
  check('own profile -> 200', self.status === 200);
  check('own profile isSelf true', self.body?.isSelf === true);
  check('own profile shows the email', typeof self.body?.profile?.email === 'string');

  const invalid = await api('GET', '/api/users/not-an-id/profile', { token: alice.token });
  check('invalid id -> 400', invalid.status === 400, `got ${invalid.status}`);
  const noAuth = await api('GET', `/api/users/${bob.id}/profile`);
  check('profile requires auth -> 401', noAuth.status === 401, `got ${noAuth.status}`);

  // --------------------------------------------------------------- privacy
  const privacyBefore = await api('GET', '/api/users/me/privacy', { token: bob.token });
  check('privacy returns the new switches', privacyBefore.body?.showPhone === true && privacyBefore.body?.readReceipts === true, JSON.stringify(privacyBefore.body));

  const privacyUpdate = await api('PUT', '/api/users/me/privacy', {
    token: bob.token,
    body: { showPhone: false, showEmail: false, showAbout: false, showOnlineStatus: false, readReceipts: false },
  });
  check('privacy update -> 200', privacyUpdate.status === 200, `got ${privacyUpdate.status}`);
  check('privacy update persists showPhone=false', privacyUpdate.body?.showPhone === false, JSON.stringify(privacyUpdate.body));

  const hidden = await api('GET', `/api/users/${bob.id}/profile`, { token: alice.token });
  check('hidden phone is omitted', hidden.body?.profile?.phone === null, JSON.stringify(hidden.body?.profile));
  check('phoneHidden flag is set', hidden.body?.profile?.phoneHidden === true);
  check('hidden about is omitted', hidden.body?.profile?.about === '' && hidden.body?.profile?.aboutHidden === true);
  check('hidden presence -> presenceHidden', hidden.body?.profile?.presenceHidden === true);
  check('hidden presence has no lastSeen', hidden.body?.profile?.lastSeen === null);

  // ------------------------------------------------------- common groups
  const group = await api('POST', '/api/chats', {
    token: alice.token,
    body: { type: 'group', groupName: `Profile group ${run}`, participantIds: [bob.id, carol.id] },
  });
  check('create group -> 201/200', group.status < 300, `got ${group.status}`);
  const groupId = group.body?._id;
  const withGroups = await api('GET', `/api/users/${bob.id}/profile`, { token: alice.token });
  check(
    'common groups include the shared group',
    (withGroups.body?.commonGroups || []).some((g) => g.id === groupId),
    JSON.stringify(withGroups.body?.commonGroups),
  );

  // -------------------------------------------------- shared media + links
  const direct = await api('POST', '/api/chats', { token: alice.token, body: { type: 'direct', participantId: bob.id } });
  const chatId = direct.body?._id || direct.body?.id;
  const imageMessage = await api('POST', '/api/messages', {
    token: alice.token,
    body: { chatId, type: 'image', mediaUrl: 'https://example.com/photo.png' },
  });
  check('send image message -> 201', imageMessage.status === 201, `got ${imageMessage.status} ${JSON.stringify(imageMessage.body)}`);
  await api('POST', '/api/messages', {
    token: alice.token,
    body: { chatId, type: 'text', content: 'see https://chatgram.example/help for details' },
  });
  const withMedia = await api('GET', `/api/users/${bob.id}/profile`, { token: alice.token });
  check(
    'shared media lists the image',
    (withMedia.body?.sharedMedia || []).some((m) => m.url === 'https://example.com/photo.png'),
    JSON.stringify(withMedia.body?.sharedMedia),
  );
  check(
    'shared links extracts the URL',
    (withMedia.body?.sharedLinks || []).some((l) => l.url.startsWith('https://chatgram.example')),
    JSON.stringify(withMedia.body?.sharedLinks),
  );

  // --------------------------------------------------------------- muting
  const mute = await api('POST', `/api/users/me/muted/${chatId}`, { token: bob.token, body: {} });
  check('mute chat -> 200', mute.status === 200, `got ${mute.status} ${JSON.stringify(mute.body)}`);
  const muted = await api('GET', '/api/users/me/muted', { token: bob.token });
  check('muted list contains the chat', (muted.body || []).some((m) => m.chatId === chatId), JSON.stringify(muted.body));
  const unmute = await api('DELETE', `/api/users/me/muted/${chatId}`, { token: bob.token });
  check('unmute -> 200', unmute.status === 200);
  const mutedAfter = await api('GET', '/api/users/me/muted', { token: bob.token });
  check('muted list is empty after unmute', (mutedAfter.body || []).length === 0, JSON.stringify(mutedAfter.body));
  const muteForeign = await api('POST', `/api/users/me/muted/${chatId}`, { token: carol.token, body: {} });
  check('mute a chat you are not in -> 403', muteForeign.status === 403, `got ${muteForeign.status}`);

  // -------------------------------------------------------- read receipts
  await api('PUT', '/api/users/me/privacy', { token: bob.token, body: { readReceipts: false } });
  await api('POST', `/api/messages/chat/${chatId}/read`, { token: bob.token });
  const afterNoReceipts = await api('GET', `/api/messages?chatId=${chatId}`, { token: alice.token });
  const messageRows = afterNoReceipts.body?.messages || afterNoReceipts.body || [];
  const imageRow = messageRows.find((m) => m.type === 'image');
  check(
    'read receipts off: no readBy for Bob',
    imageRow && !(imageRow.readBy || []).includes(bob.id),
    JSON.stringify(imageRow?.readBy),
  );
  check(
    'read receipts off: delivery is still recorded',
    imageRow && (imageRow.deliveredTo || []).includes(bob.id),
    JSON.stringify(imageRow?.deliveredTo),
  );
  await api('PUT', '/api/users/me/privacy', { token: bob.token, body: { readReceipts: true } });
  await api('POST', `/api/messages/chat/${chatId}/read`, { token: bob.token });
  const afterReceipts = await api('GET', `/api/messages?chatId=${chatId}`, { token: alice.token });
  const rows2 = afterReceipts.body?.messages || afterReceipts.body || [];
  const imageRow2 = rows2.find((m) => m.type === 'image');
  check(
    'read receipts on: readBy includes Bob',
    imageRow2 && (imageRow2.readBy || []).includes(bob.id),
    JSON.stringify(imageRow2?.readBy),
  );

  // --------------------------------------------------------------- report
  const report = await api('POST', `/api/users/${bob.id}/report`, {
    token: alice.token,
    body: { reason: 'spam', details: 'Testing the report flow', chatId },
  });
  check('report user -> 201', report.status === 201, `got ${report.status} ${JSON.stringify(report.body)}`);
  check('report returns a reportId', typeof report.body?.reportId === 'string');
  const badReason = await api('POST', `/api/users/${bob.id}/report`, {
    token: alice.token,
    body: { reason: 'not-a-real-reason' },
  });
  check('unknown reason is coerced to other', badReason.body?.reason === 'other', JSON.stringify(badReason.body));
  const selfReport = await api('POST', `/api/users/${alice.id}/report`, { token: alice.token, body: { reason: 'spam' } });
  check('report yourself -> 400', selfReport.status === 400, `got ${selfReport.status}`);

  // -------------------------------------------------------- group privacy
  const restricted = await api('PUT', '/api/users/me/privacy', {
    token: carol.token,
    body: { whoCanAddToGroups: 'contacts' },
  });
  check('whoCanAddToGroups saved', restricted.body?.whoCanAddToGroups === 'contacts', JSON.stringify(restricted.body));
  const rejectedAdd = await api('POST', '/api/chats', {
    token: alice.token,
    body: { type: 'group', groupName: `Should fail ${run}`, participantIds: [carol.id] },
  });
  check('adding a contacts-only user -> 403', rejectedAdd.status === 403, `got ${rejectedAdd.status}`);
  check('rejection code is GROUP_ADD_NOT_ALLOWED', rejectedAdd.body?.code === 'GROUP_ADD_NOT_ALLOWED', JSON.stringify(rejectedAdd.body));
  // Carol adds Alice as a contact -> the same add is now allowed.
  await api('POST', '/api/contacts', { token: carol.token, body: { userId: alice.id } });
  const allowedAdd = await api('POST', '/api/chats', {
    token: alice.token,
    body: { type: 'group', groupName: `Should work ${run}`, participantIds: [carol.id] },
  });
  check('adding after becoming a contact -> allowed', allowedAdd.status < 300, `got ${allowedAdd.status} ${JSON.stringify(allowedAdd.body)}`);

  // --------------------------------------------------------------- block
  const block = await api('POST', `/api/users/${bob.id}/block`, { token: alice.token });
  check('block -> 200', block.status === 200, `got ${block.status}`);
  const blockedList = await api('GET', '/api/users/me/blocked', { token: alice.token });
  check('blocked list contains Bob', (blockedList.body || []).some((u) => u._id === bob.id || u.id === bob.id), JSON.stringify(blockedList.body));

  const blockedProfile = await api('GET', `/api/users/${alice.id}/profile`, { token: bob.token });
  check('blocked person cannot view my profile -> 404', blockedProfile.status === 404, `got ${blockedProfile.status}`);
  const myViewAfterBlock = await api('GET', `/api/users/${bob.id}/profile`, { token: alice.token });
  check('blocker sees a minimal profile (to be able to unblock)', myViewAfterBlock.status === 200, `got ${myViewAfterBlock.status}`);
  check('minimal blocked profile has no contact details', myViewAfterBlock.body?.profile?.phone === null && myViewAfterBlock.body?.profile?.email === null);
  check('minimal blocked profile reports iBlocked', myViewAfterBlock.body?.iBlocked === true && myViewAfterBlock.body?.canMessage === false, JSON.stringify(myViewAfterBlock.body));
  check('minimal blocked profile hides shared content', (myViewAfterBlock.body?.sharedMedia || []).length === 0);

  const blockedSend = await api('POST', '/api/messages', {
    token: bob.token,
    body: { chatId, type: 'text', content: 'hello?' },
  });
  check('blocked user cannot send -> 403', blockedSend.status === 403, `got ${blockedSend.status}`);
  check('blocked send code is BLOCKED', blockedSend.body?.code === 'BLOCKED', JSON.stringify(blockedSend.body));

  const blockedCreate = await api('POST', '/api/chats', {
    token: bob.token,
    body: { type: 'direct', participantId: alice.id },
  });
  check('blocked user cannot start a chat -> 403', blockedCreate.status === 403, `got ${blockedCreate.status}`);

  const unblock = await api('DELETE', `/api/users/${bob.id}/block`, { token: alice.token });
  check('unblock -> 200', unblock.status === 200);
  const sendAfterUnblock = await api('POST', '/api/messages', {
    token: bob.token,
    body: { chatId, type: 'text', content: 'hello again' },
  });
  check('after unblock messages flow again -> 201', sendAfterUnblock.status === 201, `got ${sendAfterUnblock.status}`);
  const blockSelf = await api('POST', `/api/users/${alice.id}/block`, { token: alice.token });
  check('block yourself -> 400', blockSelf.status === 400, `got ${blockSelf.status}`);

  // --------------------------------------------------------------- cleanup
  try {
    const mongoose = require('mongoose');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', {
      serverSelectionTimeoutMS: 4000,
    });
    const User = require('../../src/models/User');
    const Chat = require('../../src/models/Chat');
    const Message = require('../../src/models/Message');
    const Report = require('../../src/models/Report');
    const ids = [alice.id, bob.id, carol.id];
    const chats = await Chat.find({ participants: { $in: ids } }).select('_id');
    const chatIds = chats.map((c) => c._id);
    await Message.deleteMany({ chatId: { $in: chatIds } });
    await Chat.deleteMany({ _id: { $in: chatIds } });
    await Report.deleteMany({ targetUserId: { $in: ids } });
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
