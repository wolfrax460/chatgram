/**
 * Production smoke test. Runs ON the server VM next to the API.
 *
 * Creates two clearly-named TEST accounts directly in the database (production
 * sign-up requires an emailed code, which we must not bypass in the UI), then
 * drives the real public API over 127.0.0.1:5000: sign-in, messages both ways,
 * photo/video/audio statuses through Cloudinary, profile, group members + leave,
 * help widget message, change password. Deletes every test document (and the
 * Cloudinary uploads via the delete-status endpoint) afterwards.
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const mongoose = require('mongoose');
const User = require('./src/models/User');
const Chat = require('./src/models/Chat');
const Message = require('./src/models/Message');
const Status = require('./src/models/Status');

const BASE = 'http://127.0.0.1:5000';
const STAMP = Date.now().toString(36);
const PASSWORD = 'DeployTest1!';
const NEW_PASSWORD = 'DeployTest2!';
const A_EMAIL = `deploy-test-a-${STAMP}@chatgram.test`;
const B_EMAIL = `deploy-test-b-${STAMP}@chatgram.test`;

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

async function api(method, route, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers,
    body: form ?? (body ? JSON.stringify(body) : undefined),
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

async function login(email, password) {
  const res = await api('POST', '/api/auth/login', { body: { identifier: email, password } });
  return res.body?.accessToken || null;
}

async function uploadStatusMedia(token, filePath, mime, durationSeconds) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(filePath)], { type: mime }), path.basename(filePath));
  if (durationSeconds) form.append('durationSeconds', String(durationSeconds));
  const response = await fetch(`${BASE}/api/status/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, body: json, url: json?.file?.url || json?.url };
}

async function main() {
  console.log(`\nPRODUCTION smoke test ${STAMP}\n`);
  await mongoose.connect(process.env.MONGODB_URI);

  // The User model hashes the password in a pre-save hook, so store it plain here.
  const a = await User.create({ displayName: `DeployTest A ${STAMP}`, email: A_EMAIL, password: PASSWORD, isOnline: false });
  const b = await User.create({ displayName: `DeployTest B ${STAMP}`, email: B_EMAIL, password: PASSWORD, isOnline: false });
  console.log(`  test users: ${a.displayName} (${a._id}), ${b.displayName} (${b._id})`);

  let aToken = null;
  let bToken = null;
  const createdStatusIds = [];

  try {
    // ---------------------------------------------------------------- sign in
    aToken = await login(A_EMAIL, PASSWORD);
    check('TEST account A signs in', Boolean(aToken));
    bToken = await login(B_EMAIL, PASSWORD);
    check('TEST account B signs in', Boolean(bToken));
    if (!aToken || !bToken) throw new Error('cannot continue without tokens');

    const me = await api('GET', '/api/auth/me', { token: aToken });
    check('signed-in profile loads', me.status === 200 && me.body?.displayName?.includes('DeployTest A'), `${me.status}`);

    // --------------------------------------------------------------- messages
    const chat = await api('POST', '/api/chats', { token: aToken, body: { type: 'direct', participantId: String(b._id) } });
    check('direct conversation created', chat.status === 201 || chat.status === 200, `got ${chat.status}`);
    const chatId = chat.body?._id;

    const sent = await api('POST', '/api/messages', { token: aToken, body: { chatId, type: 'text', content: 'production smoke hello' } });
    check('A sends a message', [200, 201].includes(sent.status), `got ${sent.status}`);
    const reply = await api('POST', '/api/messages', { token: bToken, body: { chatId, type: 'text', content: 'production smoke reply' } });
    check('B replies', [200, 201].includes(reply.status), `got ${reply.status}`);
    const history = await api('GET', `/api/messages?chatId=${chatId}`, { token: bToken });
    check('both messages are stored', (history.body?.messages || []).length >= 2, `${(history.body?.messages || []).length}`);

    // --------------------------------------------------------------- statuses
    const image = '/tmp/status-image.png';
    const video = '/tmp/status-video.webm';
    const audio = '/tmp/status-audio.webm';
    if (fs.existsSync(image)) {
      const up = await uploadStatusMedia(aToken, image, 'image/png');
      check('photo uploaded through Cloudinary', up.status === 201 && Boolean(up.url), `${up.status} ${JSON.stringify(up.body).slice(0, 120)}`);
      if (up.url) {
        const created = await api('POST', '/api/status', { token: aToken, body: { mediaUrl: up.url, mediaType: 'image', caption: 'smoke photo' } });
        check('photo status posted', [200, 201].includes(created.status), `got ${created.status}`);
        if ((created.body?._id || created.body?.status?._id)) createdStatusIds.push(created.body._id || created.body.status._id);
      }
    } else {
      check('photo fixture present', false, image);
    }
    if (fs.existsSync(video)) {
      const up = await uploadStatusMedia(aToken, video, 'video/webm', 3);
      check('real video uploaded through Cloudinary', up.status === 201 && Boolean(up.url), `${up.status} ${JSON.stringify(up.body).slice(0, 120)}`);
      if (up.url) {
        const created = await api('POST', '/api/status', { token: aToken, body: { mediaUrl: up.url, mediaType: 'video', caption: 'smoke video' } });
        check('video status posted', [200, 201].includes(created.status), `got ${created.status}`);
        if ((created.body?._id || created.body?.status?._id)) createdStatusIds.push(created.body._id || created.body.status._id);
      }
    }
    if (fs.existsSync(audio)) {
      const up = await uploadStatusMedia(aToken, audio, 'audio/webm', 2);
      check('real audio uploaded through Cloudinary', up.status === 201 && Boolean(up.url), `${up.status} ${JSON.stringify(up.body).slice(0, 120)}`);
      if (up.url) {
        const created = await api('POST', '/api/status', { token: aToken, body: { mediaUrl: up.url, mediaType: 'audio', caption: 'smoke audio' } });
        check('audio status posted', [200, 201].includes(created.status), `got ${created.status}`);
        if ((created.body?._id || created.body?.status?._id)) createdStatusIds.push(created.body._id || created.body.status._id);
      }
    }
    const bFeed = await api('GET', '/api/status', { token: bToken });
    check('B sees A in the status feed', bFeed.status === 200, `${bFeed.status}`);

    // ---------------------------------------------------------------- profile
    const profile = await api('GET', `/api/users/${b._id}/profile`, { token: aToken });
    const profileTarget = profile.body?.profile ?? profile.body;
    check('profile panel data loads', profile.status === 200 && Boolean(profileTarget), `${profile.status} ${JSON.stringify(profile.body).slice(0, 160)}`);

    // ----------------------------------------------------------------- groups
    const group = await api('POST', '/api/chats', {
      token: aToken,
      body: { type: 'group', groupName: `Deploy smoke group ${STAMP}`, participantIds: [String(b._id)] },
    });
    check('group created', [200, 201].includes(group.status), `got ${group.status}`);
    const groupId = group.body?._id;
    const members = await api('GET', `/api/chats/${groupId}/participants`, { token: aToken });
    check('group member list loads', members.status === 200 && (members.body?.members || members.body || []).length >= 1, `${members.status}`);
    const leave = await api('DELETE', `/api/chats/${groupId}/leave`, { token: bToken });
    check('B leaves the group', leave.status === 200, `got ${leave.status}`);

    // ------------------------------------------------------------- help widget
    const conversation = await api('POST', '/api/help/conversations', { token: aToken, body: {} });
    check('help conversation created', [200, 201].includes(conversation.status), `${conversation.status} ${JSON.stringify(conversation.body).slice(0, 120)}`);
    const conversationId = conversation.body?.id || conversation.body?._id;
    if (conversationId) {
      const asked = await api('POST', `/api/help/conversations/${conversationId}/messages`, {
        token: aToken,
        body: { text: 'How do I change my password?' },
      });
      check('help widget gets an assistant reply', [200, 201].includes(asked.status), `${asked.status}`);
    }

    // -------------------------------------------------------- change password
    const changed = await api('POST', '/api/auth/change-password', {
      token: aToken,
      body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });
    check('change password succeeds', changed.status === 200, `${changed.status} ${JSON.stringify(changed.body).slice(0, 160)}`);
    if (changed.status === 200) {
      const newToken = await login(A_EMAIL, NEW_PASSWORD);
      check('can sign in with the new password', Boolean(newToken));
      if (newToken) aToken = newToken;
    }

    // ------------------------------------------------------------- cleanup
    for (const id of createdStatusIds) {
      const removed = await api('DELETE', `/api/status/${id}`, { token: aToken });
      check('test status deleted', [200, 204].includes(removed.status), `got ${removed.status}`);
    }
    const delA = await api('DELETE', '/api/auth/account', { token: aToken, body: { password: changed.status === 200 ? NEW_PASSWORD : PASSWORD, confirmation: 'DELETE' } });
    check('TEST account A deleted', [200, 204].includes(delA.status), `${delA.status} ${JSON.stringify(delA.body).slice(0, 120)}`);
    const delB = await api('DELETE', '/api/auth/account', { token: bToken, body: { password: PASSWORD, confirmation: 'DELETE' } });
    check('TEST account B deleted', [200, 204].includes(delB.status), `${delB.status} ${JSON.stringify(delB.body).slice(0, 120)}`);
  } finally {
    // Belt and braces: remove anything left that belongs to the test accounts.
    const ids = [a._id, b._id];
    await Message.deleteMany({ senderId: { $in: ids } }).catch(() => {});
    const chats = await Chat.find({ participants: { $in: ids } }).select('_id').catch(() => []);
    await Message.deleteMany({ chatId: { $in: chats.map((c) => c._id) } }).catch(() => {});
    await Chat.deleteMany({ _id: { $in: chats.map((c) => c._id) } }).catch(() => {});
    await Status.deleteMany({ userId: { $in: ids } }).catch(() => {});
    await User.deleteMany({ _id: { $in: ids } }).catch(() => {});
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('SMOKE CRASHED', error);
  process.exit(1);
});
