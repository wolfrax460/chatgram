/**
 * Integration test: account settings (section F server side).
 *
 *   cd server && node test/integration/accountSettings.test.js
 *
 * Covers: change sign-in email/phone with verification, "log out other devices",
 * delete account (with data cleanup) and the privacy switches the Settings page
 * writes.
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
const PASSWORD = 'AccountPass1!';

async function createUser(label, identifier) {
  const target = identifier || `acc-${label}-${run}@chatgram.test`;
  const res = await api('POST', '/api/auth/register', {
    body: { displayName: `Account ${label}`, identifier: target, password: PASSWORD },
  });
  if (res.status !== 201) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
  return { identifier: target, token: res.body.accessToken, refresh: res.body.refreshToken, id: res.body.user.id };
}

const ids = [];

async function main() {
  console.log(`\naccount settings integration test against ${BASE}\n`);
  const health = await api('GET', '/api/health');
  if (health.status !== 200) {
    console.log('Start the local API first (docs/local-staging.md).');
    process.exit(1);
  }

  const alice = await createUser('alice');
  const secondUser = await createUser('taken', `acc-taken-${run}@chatgram.test`);
  ids.push(alice.id, secondUser.id);

  // ------------------------------------------------------ change identifier
  const newEmail = `acc-new-${run}@chatgram.test`;
  const requested = await api('POST', '/api/auth/account/identifier/request', {
    token: alice.token,
    body: { identifier: newEmail },
  });
  check('request identifier change -> 200', requested.status === 200, `got ${requested.status}`);
  check('request says which channel', requested.body?.channel === 'email', JSON.stringify(requested.body));
  check('request returns a dev code locally', typeof requested.body?.devCode === 'string', requested.body?.devCode);
  const code = requested.body?.devCode;

  const taken = await api('POST', '/api/auth/account/identifier/request', {
    token: alice.token,
    body: { identifier: secondUser.identifier },
  });
  check('requesting an address used by another account -> 409', taken.status === 409, `got ${taken.status}`);
  check('code is IDENTIFIER_TAKEN', taken.body?.code === 'IDENTIFIER_TAKEN', JSON.stringify(taken.body));

  const wrongPassword = await api('POST', '/api/auth/account/identifier/confirm', {
    token: alice.token,
    body: { identifier: newEmail, code, currentPassword: 'wrong-password' },
  });
  check('confirm with a wrong password -> 400', wrongPassword.status === 400, `got ${wrongPassword.status}`);
  check('code is CURRENT_PASSWORD_INVALID', wrongPassword.body?.code === 'CURRENT_PASSWORD_INVALID', JSON.stringify(wrongPassword.body));

  const badCode = await api('POST', '/api/auth/account/identifier/confirm', {
    token: alice.token,
    body: { identifier: newEmail, code: '000000', currentPassword: PASSWORD },
  });
  check('confirm with a wrong code -> 400', badCode.status === 400, `got ${badCode.status}`);

  const confirmed = await api('POST', '/api/auth/account/identifier/confirm', {
    token: alice.token,
    body: { identifier: newEmail, code, currentPassword: PASSWORD },
  });
  check('confirm with the right code + password -> 200', confirmed.status === 200, `got ${confirmed.status} ${JSON.stringify(confirmed.body)}`);
  check('confirm returns fresh tokens (this device stays in)', typeof confirmed.body?.accessToken === 'string');
  const newToken = confirmed.body.accessToken;

  const oldTokenNow = await api('GET', '/api/auth/me', { token: alice.token });
  check('token from before the change is revoked', oldTokenNow.status === 401 && oldTokenNow.body?.code === 'SESSION_REVOKED', JSON.stringify(oldTokenNow.body));
  const meNow = await api('GET', '/api/auth/me', { token: newToken });
  check('new token works', meNow.status === 200, `got ${meNow.status}`);
  check('account email actually changed', meNow.body?.email === newEmail, meNow.body?.email);
  const oldLogin = await api('POST', '/api/auth/login', { body: { identifier: alice.identifier, password: PASSWORD } });
  check('old email no longer signs in', oldLogin.status === 401, `got ${oldLogin.status}`);
  const newLogin = await api('POST', '/api/auth/login', { body: { identifier: newEmail, password: PASSWORD } });
  check('new email signs in', newLogin.status === 200, `got ${newLogin.status}`);
  const workingToken = newLogin.body.accessToken;
  const workingRefresh = newLogin.body.refreshToken;

  // ------------------------------------------------------ log out other devices
  const deviceTwo = await api('POST', '/api/auth/login', { body: { identifier: newEmail, password: PASSWORD } });
  check('second device signs in', deviceTwo.status === 200, `got ${deviceTwo.status}`);

  const wrongLogout = await api('POST', '/api/auth/account/logout-others', {
    token: workingToken,
    body: { currentPassword: 'nope' },
  });
  check('log out others with a wrong password -> 400', wrongLogout.status === 400, `got ${wrongLogout.status}`);

  const logoutOthers = await api('POST', '/api/auth/account/logout-others', {
    token: workingToken,
    body: { currentPassword: PASSWORD },
  });
  check('log out other devices -> 200', logoutOthers.status === 200, `got ${logoutOthers.status}`);
  const otherDeviceNow = await api('GET', '/api/auth/me', { token: deviceTwo.body.accessToken });
  check('other device token is revoked', otherDeviceNow.status === 401, `got ${otherDeviceNow.status}`);
  const currentDeviceNow = await api('GET', '/api/auth/me', { token: logoutOthers.body.accessToken });
  check('current device stays signed in', currentDeviceNow.status === 200, `got ${currentDeviceNow.status}`);
  const oldRefresh = await api('POST', '/api/auth/refresh', { body: { refreshToken: workingRefresh } });
  check('refresh token from before logout-others is revoked', oldRefresh.status === 401, `got ${oldRefresh.status}`);
  const currentToken = logoutOthers.body.accessToken;

  // ------------------------------------------------------------- privacy API
  const privacyUpdate = await api('PUT', '/api/users/me/privacy', {
    token: currentToken,
    body: {
      showOnlineStatus: false,
      showProfilePhoto: false,
      showAbout: false,
      showPhone: false,
      showEmail: false,
      readReceipts: false,
      whoCanAddToGroups: 'contacts',
    },
  });
  check('privacy update -> 200', privacyUpdate.status === 200, `got ${privacyUpdate.status}`);
  const privacyRead = await api('GET', '/api/users/me/privacy', { token: currentToken });
  check('privacy round-trips every switch', privacyRead.body?.showProfilePhoto === false && privacyRead.body?.whoCanAddToGroups === 'contacts', JSON.stringify(privacyRead.body));

  // -------------------------------------------------------- delete account
  const wrongConfirmation = await api('DELETE', '/api/auth/account', {
    token: currentToken,
    body: { password: PASSWORD, confirmation: 'yes' },
  });
  check('delete without typing DELETE -> 400', wrongConfirmation.status === 400, `got ${wrongConfirmation.status}`);
  check('code is CONFIRM_REQUIRED', wrongConfirmation.body?.code === 'CONFIRM_REQUIRED', JSON.stringify(wrongConfirmation.body));

  const wrongDeletePassword = await api('DELETE', '/api/auth/account', {
    token: currentToken,
    body: { password: 'wrong', confirmation: 'DELETE' },
  });
  check('delete with a wrong password -> 400', wrongDeletePassword.status === 400, `got ${wrongDeletePassword.status}`);

  // Data cleanup: create a group with the second user first.
  const group = await api('POST', '/api/chats', {
    token: currentToken,
    body: { type: 'group', groupName: `Delete cleanup ${run}`, participantIds: [secondUser.id] },
  });
  check('cleanup group created', group.status === 201, `got ${group.status}`);

  const deleted = await api('DELETE', '/api/auth/account', {
    token: currentToken,
    body: { password: PASSWORD, confirmation: 'DELETE' },
  });
  check('delete account -> 200', deleted.status === 200, `got ${deleted.status} ${JSON.stringify(deleted.body)}`);

  const loginAfterDelete = await api('POST', '/api/auth/login', { body: { identifier: newEmail, password: PASSWORD } });
  check('deleted account cannot sign in', loginAfterDelete.status === 401, `got ${loginAfterDelete.status}`);
  const meAfterDelete = await api('GET', '/api/auth/me', { token: deleted.body?.accessToken || currentToken });
  check('deleted token is rejected', meAfterDelete.status === 401, `got ${meAfterDelete.status}`);

  const rosterAfterDelete = await api('GET', `/api/chats/${group.body._id}/participants`, { token: secondUser.token });
  check('deleted user is removed from groups', rosterAfterDelete.body?.memberCount === 1, JSON.stringify(rosterAfterDelete.body?.members));
  const groupHistory = await api('GET', `/api/messages?chatId=${group.body._id}`, { token: secondUser.token });
  check(
    'group shows a system message about the deletion',
    (groupHistory.body?.messages || []).some((m) => m.type === 'system' && /deleted their account/i.test(m.content || '')),
    JSON.stringify((groupHistory.body?.messages || []).slice(-1)),
  );

  // --------------------------------------------------------------- cleanup
  try {
    const mongoose = require('mongoose');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', {
      serverSelectionTimeoutMS: 4000,
    });
    const User = require('../../src/models/User');
    const Chat = require('../../src/models/Chat');
    const Message = require('../../src/models/Message');
    await Message.deleteMany({ chatId: group.body._id });
    await Chat.deleteMany({ participants: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } });
    await User.deleteMany({ email: new RegExp(`^acc-(new|taken|alice)-${run}@chatgram\\.test$`) });
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
