/**
 * FCM push: device registration routes + sender rules.
 *
 *   cd server && node test/integration/pushDevices.test.js
 *
 * Requires a staging API on E2E_API_URL (default http://127.0.0.1:5000) and the
 * same MongoDB through MONGODB_URI. The API is expected to be running WITHOUT
 * Firebase configured, which is what the "test push returns a clear non-500"
 * check proves.
 *
 * The sender is exercised in-process with its test seams (fake FCM client and
 * presence checker) so no real push is ever sent.
 */
const mongoose = require('mongoose');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging';
const run = Date.now().toString(36);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 240)}` : ''}`);
  }
}

async function api(method, route, { token, body } = {}) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, body: payload, text };
}

async function register(label) {
  const res = await api('POST', '/api/auth/register', {
    body: {
      displayName: `Push ${label} ${run}`,
      identifier: `push-${label}-${run}@chatgram.test`,
      password: 'PushTest1!',
    },
  });
  if (res.status !== 201) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken, id: res.body.user.id };
}

function deviceToken(label) {
  return `fcm-${run}-${label}-000000000000`;
}

async function main() {
  console.log('\nFCM device registration + push sender\n');
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const DeviceToken = require('../../src/models/DeviceToken');
  const User = require('../../src/models/User');
  const Chat = require('../../src/models/Chat');
  const Message = require('../../src/models/Message');
  const { AdminInbox } = require('../../src/ai/chatgram');
  const pushSender = require('../../src/services/pushSender');

  const userA = await register('a');
  const userB = await register('b');
  const userC = await register('c');
  const createdChats = [];
  const createdMessages = [];

  /** Fresh stubs: fake FCM capture + controllable presence, no coalescing. */
  function stubSender({ online = false, send } = {}) {
    pushSender.resetForTests();
    const captured = [];
    pushSender.setMessagingForTests(async (message) => {
      captured.push(message);
      if (send) return send(message);
      return 'projects/test/messages/1';
    });
    pushSender.setOnlineCheckerForTests(() => online);
    return captured;
  }

  try {
    /* ---------------------------------------------------- routes + auth */
    const tokenB = deviceToken('b');
    const anonymousRegister = await api('POST', '/api/notifications/devices', { body: { token: tokenB, platform: 'android' } });
    check('device registration requires auth (401)', anonymousRegister.status === 401, anonymousRegister.status);
    const anonymousDelete = await api('DELETE', '/api/notifications/devices', { body: { token: tokenB } });
    check('device removal requires auth (401)', anonymousDelete.status === 401, anonymousDelete.status);
    const anonymousTest = await api('POST', '/api/notifications/devices/test', { body: {} });
    check('test push requires auth (401)', anonymousTest.status === 401, anonymousTest.status);

    const missingToken = await api('POST', '/api/notifications/devices', { token: userB.token, body: { platform: 'android' } });
    check('a missing device token is rejected (400)', missingToken.status === 400 && missingToken.body?.code === 'INVALID_DEVICE', missingToken.body);
    const badPlatform = await api('POST', '/api/notifications/devices', { token: userB.token, body: { token: tokenB, platform: 'ios' } });
    check('an unsupported platform is rejected (400)', badPlatform.status === 400, badPlatform.status);

    /* ----------------------------------------- register / upsert / cap */
    const tokenA = deviceToken('a');
    const registered = await api('POST', '/api/notifications/devices', {
      token: userA.token,
      body: { token: tokenA, platform: 'android', deviceLabel: 'Pixel 8' },
    });
    check('a valid device registration returns 204', registered.status === 204, registered.status);
    const storedA = await DeviceToken.findOne({ token: tokenA }).lean();
    check('the device row is stored for the caller', storedA && String(storedA.userId) === String(userA.id) && storedA.platform === 'android', storedA);
    check('the device row starts valid', storedA?.invalid === false, storedA?.invalid);
    check('the device label is stored', storedA?.deviceLabel === 'Pixel 8', storedA?.deviceLabel);

    const reRegistered = await api('POST', '/api/notifications/devices', {
      token: userA.token,
      body: { token: tokenA, platform: 'web', deviceLabel: 'Chrome' },
    });
    const afterUpsert = await DeviceToken.find({ token: tokenA }).lean();
    check('re-registering the same token upserts (204, one row)', reRegistered.status === 204 && afterUpsert.length === 1, afterUpsert.length);
    check('the upsert refreshes platform and label', afterUpsert[0]?.platform === 'web' && afterUpsert[0]?.deviceLabel === 'Chrome', afterUpsert[0]);

    // Cap: 12 registrations leave the 10 most recent devices.
    for (let i = 1; i <= 12; i += 1) {
      const result = await api('POST', '/api/notifications/devices', {
        token: userC.token,
        body: { token: deviceToken(`cap-${i}`), platform: 'android', deviceLabel: `Device ${i}` },
      });
      if (result.status !== 204) throw new Error(`cap register ${i}: ${result.status}`);
      await sleep(5);
    }
    const capped = await DeviceToken.find({ userId: userC.id }).lean();
    check('a user is capped at 10 devices', capped.length === 10, capped.length);
    check(
      'the oldest devices are dropped by the cap',
      !capped.some((row) => row.token === deviceToken('cap-1')) && !capped.some((row) => row.token === deviceToken('cap-2')),
      null,
    );

    const removed = await api('DELETE', '/api/notifications/devices', { token: userC.token, body: { token: deviceToken('cap-3') } });
    check('removing a device returns 204', removed.status === 204, removed.status);
    check('the removed device is gone', (await DeviceToken.countDocuments({ token: deviceToken('cap-3') })) === 0, null);
    const removedAgain = await api('DELETE', '/api/notifications/devices', { token: userC.token, body: { token: deviceToken('cap-3') } });
    check('removing an absent device still returns 204', removedAgain.status === 204, removedAgain.status);

    /* ------------------------------------------ test push (disabled) */
    const disabledTest = await api('POST', '/api/notifications/devices/test', { token: userA.token, body: {} });
    check('a test push with Firebase disabled is a clear non-500 response', disabledTest.status !== 500, disabledTest.status);
    check('the disabled push response is explicit', disabledTest.body?.code === 'PUSH_DISABLED', disabledTest.body);

    /* ----------------------------------------------------- sender rules */
    const chat = await Chat.create({ type: 'direct', participants: [userA.id, userB.id] });
    createdChats.push(chat._id);
    const message = await Message.create({
      chatId: chat._id,
      senderId: userA.id,
      type: 'text',
      content: 'hello secret text',
      sentAt: new Date(),
      deliveredTo: [userA.id],
      readBy: [userA.id],
    });
    createdMessages.push(message._id);
    const senderA = { _id: userA.id, displayName: 'Sender A' };

    // The user B device token must be registered for delivery.
    const regB = await api('POST', '/api/notifications/devices', {
      token: userB.token,
      body: { token: tokenB, platform: 'android', deviceLabel: 'Pixel B' },
    });
    check('the recipient device is registered', regB.status === 204, regB.status);

    let captured = stubSender({ online: true });
    let result = await pushSender.pushChatMessage({ chat, sender: senderA, message });
    check('an online recipient with a live socket is skipped', result.sent === 0 && captured.length === 0, result);

    captured = stubSender({ online: false });
    result = await pushSender.pushChatMessage({ chat, sender: senderA, message });
    check('an offline recipient is pushed', result.sent === 1 && captured.length === 1, result);
    const push = captured[0];
    check('the notification title is the sender name', push?.notification?.title === 'Sender A', push?.notification);
    check('the notification body is the message preview', push?.notification?.body === 'hello secret text', push?.notification);
    check(
      'the data block carries chatId/type/hidePreview',
      push?.data?.chatId === String(chat._id) && push?.data?.type === 'message' && push?.data?.hidePreview === 'false',
      push?.data,
    );
    check('the push is high priority and collapsed per chat', push?.android?.priority === 'high' && push?.android?.collapseKey === `chat-${chat._id}`, push?.android);
    check('the Android notification is tagged per chat', push?.android?.notification?.tag === String(chat._id), push?.android?.notification);
    check('the Android channel is messages', push?.android?.notification?.channelId === 'messages', push?.android?.notification);
    check('the push targets the recipient token', push?.token === tokenB, push?.token ? 'present' : 'missing');

    // Coalescing: the same recipient+chat within 3 s is dropped.
    result = await pushSender.pushChatMessage({ chat, sender: senderA, message });
    check('a second push for the same chat within 3 s is coalesced', captured.length === 1 && result.sent === 0, result);

    // DND window covers now -> skipped.
    await User.updateOne({ _id: userB.id }, { $set: { 'notificationPrefs.dndEnabled': true, 'notificationPrefs.dndStart': '00:00', 'notificationPrefs.dndEnd': '23:59' } });
    captured = stubSender({ online: false });
    result = await pushSender.pushChatMessage({ chat, sender: senderA, message });
    check('a user in do-not-disturb is not pushed', result.sent === 0 && captured.length === 0, result);
    await User.updateOne({ _id: userB.id }, { $set: { 'notificationPrefs.dndEnabled': false } });

    // Muted chat -> skipped; unmuted -> delivered again.
    await User.updateOne({ _id: userB.id }, { $set: { mutedChats: [{ chatId: chat._id, until: null }] } });
    captured = stubSender({ online: false });
    result = await pushSender.pushChatMessage({ chat, sender: senderA, message });
    check('a muted chat is not pushed', result.sent === 0 && captured.length === 0, result);
    await User.updateOne({ _id: userB.id }, { $set: { mutedChats: [] } });

    /* ------------------------------------ invalid tokens + failure rows */
    const tokenBad = deviceToken('bad');
    await api('POST', '/api/notifications/devices', { token: userB.token, body: { token: tokenBad, platform: 'android' } });
    const tokenErr = deviceToken('err');
    await api('POST', '/api/notifications/devices', { token: userB.token, body: { token: tokenErr, platform: 'android' } });

    captured = stubSender({
      online: false,
      send(message) {
        if (message.token === tokenBad) {
          throw Object.assign(new Error('token gone'), { code: 'messaging/registration-token-not-registered' });
        }
        if (message.token === tokenErr) {
          throw Object.assign(new Error('internal'), { code: 'messaging/internal-error' });
        }
        return 'projects/test/messages/1';
      },
    });
    result = await pushSender.pushChatMessage({ chat, sender: senderA, message });
    check('delivery reports the failed device', result.failed >= 2, result);

    const badRow = await DeviceToken.findOne({ token: tokenBad }).lean();
    check('a permanently invalid token is marked invalid', badRow?.invalid === true, badRow?.invalid);
    const errRow = await DeviceToken.findOne({ token: tokenErr }).lean();
    check('a generic failure does not invalidate the token', errRow?.invalid === false, errRow?.invalid);

    const badInbox = await AdminInbox.findOne({ normalized: `push:${String(badRow?._id)}` }).lean();
    const errInbox = await AdminInbox.findOne({ normalized: `push:${String(errRow?._id)}` }).lean();
    check('a push failure creates an AdminInbox row', Boolean(badInbox) && Boolean(errInbox), null);
    check('the failure row uses type push_failure and status new', badInbox?.type === 'push_failure' && badInbox?.status === 'new', badInbox);
    check(
      'the failure text is the sanitized error code only',
      badInbox?.question === 'Push delivery failed: messaging/registration-token-not-registered (Android)' &&
        errInbox?.question === 'Push delivery failed: messaging/internal-error (Android)',
      { bad: badInbox?.question, err: errInbox?.question },
    );

    // A second failure for the same token increments the same row (count++).
    captured = stubSender({
      online: false,
      send(message) {
        if (message.token === tokenErr) throw Object.assign(new Error('internal'), { code: 'messaging/internal-error' });
        return 'projects/test/messages/1';
      },
    });
    await pushSender.pushChatMessage({ chat, sender: senderA, message });
    const errInboxAgain = await AdminInbox.findOne({ normalized: `push:${String(errRow?._id)}` }).lean();
    check('repeated failures increment the same row', errInboxAgain?.count === (errInbox?.count || 1) + 1, { before: errInbox?.count, after: errInboxAgain?.count });

    // Invalid tokens are skipped after marking: no further FCM attempt.
    check('invalid tokens are no longer attempted', !captured.some((row) => row.token === tokenBad), null);

    // No push-failure row may leak message content, names, tokens or the chat id.
    const failureRows = await AdminInbox.find({ type: 'push_failure', normalized: { $in: [String(badRow?._id), String(errRow?._id)].map((id) => `push:${id}`) } }).lean();
    const leaked = failureRows
      .map((row) => `${row.question} ${row.title} ${row.summary} ${row.userText} ${row.askerName} ${row.redactedContext}`)
      .join(' ');
    check(
      'the failure rows are content-free',
      !/hello secret text|Sender A|fcm-/i.test(leaked),
      leaked,
    );

    /* --------------------------------------------------- call payloads */
    const callCaptured = stubSender({ online: true }); // force must bypass presence
    const callResult = await pushSender.pushCall({
      callId: `call-${run}`,
      chatId: String(chat._id),
      callerName: 'Caller A',
      kind: 'video',
      groupName: 'Team',
      recipientIds: [userB.id],
      force: true,
    });
    check('a forced call push reaches an online recipient', callResult.sent >= 1 && callCaptured.length >= 1, callResult);
    const callPush = callCaptured[0];
    check('the call push is data-only (no notification block)', callPush && !callPush.notification, Object.keys(callPush || {}));
    check(
      'the call data carries type/callId/chatId/caller/kind/group',
      callPush?.data?.type === 'call' &&
        callPush?.data?.callId === `call-${run}` &&
        callPush?.data?.chatId === String(chat._id) &&
        callPush?.data?.callerName === 'Caller A' &&
        callPush?.data?.kind === 'video' &&
        callPush?.data?.groupName === 'Team',
      callPush?.data,
    );
    check('the call push is high priority with a 45 s TTL', callPush?.android?.priority === 'high' && callPush?.android?.ttl === 45000, callPush?.android);
  } finally {
    pushSender.resetForTests();
    // Cleanup only this run's data.
    const pushRows = await DeviceToken.find({ token: new RegExp(`^fcm-${run}-`) }).select('_id').lean();
    if (pushRows.length) {
      await AdminInbox.deleteMany({ normalized: { $in: pushRows.map((row) => `push:${String(row._id)}`) } });
    }
    await DeviceToken.deleteMany({ token: new RegExp(`^fcm-${run}-`) });
    if (createdMessages.length) await Message.deleteMany({ _id: { $in: createdMessages } });
    if (createdChats.length) await Chat.deleteMany({ _id: { $in: createdChats } });
    await User.deleteMany({ email: new RegExp(`^push-.+-${run}@chatgram\\.test$`) });
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('push devices test crashed:', String((error && error.stack) || error).slice(0, 900));
  process.exit(1);
});
