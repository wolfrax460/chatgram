/**
 * Protected account deletion (14-day grace) — integration suite.
 *
 *   node server/test/integration/accountDeletion.test.js
 *
 * Requires an isolated staging API (E2E_API_URL, default :5000) sharing
 * MONGODB_URI with this process, REQUIRE_VERIFICATION=false, DEV_SHOW_CODES=true,
 * AUTH_RATE_LIMIT_DISABLED=true, EMAIL_ENABLED=false and NODE_ENV != production.
 * The suite never sends real email/SMS and cleans up the data it creates.
 *
 * Covers: 401s, 10-minute code expiry, 5-attempt limit, wrong password, 3 sends
 * per hour, EMAIL_REQUIRED for phone-only accounts, DELETE confirm word, cancel
 * (idempotent), signed-in auto-restore during grace, discovery/contact/new-chat
 * hiding, the expired-account purger (messages become deleted-author while the
 * other participant's chat/message survives), the media queue and content-free
 * audit rows.
 */
const mongoose = require('mongoose');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging';
const run = Date.now().toString(36);
const DAY = 24 * 60 * 60 * 1000;

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
  return { status: response.status, body: payload };
}

async function register(label, identifier, password = 'AccountDel1!') {
  const res = await api('POST', '/api/auth/register', {
    body: { displayName: `Account Delete ${label} ${run}`, identifier, password },
  });
  if (res.status !== 201) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken, id: res.body.user.id, password };
}

async function main() {
  console.log('\nprotected account deletion (14-day grace)\n');
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const User = require('../../src/models/User');
  const Status = require('../../src/models/Status');
  const Message = require('../../src/models/Message');
  const Chat = require('../../src/models/Chat');
  const DeviceToken = require('../../src/models/DeviceToken');
  const VerificationCode = require('../../src/models/VerificationCode');
  const UserSession = require('../../src/models/UserSession');
  const AdminAudit = require('../../src/models/AdminAudit');
  const PendingMediaDeletion = require('../../src/models/PendingMediaDeletion');
  const { runAccountDeletionPurge, deletionTarget } = require('../../src/utils/accountDeletion');
  const platformSettings = require('../../src/utils/platformSettings');

  // This suite creates several accounts; disable the per-IP signup throttle for
  // the run (restored in `finally`). The API process caches the setting for 5 s.
  const platformBefore = await platformSettings.get().catch(() => null);
  await platformSettings.update({ signupThrottleEnabled: false }, { ip: '127.0.0.1', headers: {} }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 5500));

  const emailA = `acct-del-a-${run}@chatgram.test`;
  const emailB = `acct-del-b-${run}@chatgram.test`;
  const emailC = `acct-del-c-${run}@chatgram.test`;
  const emailD = `acct-del-d-${run}@chatgram.test`;
  const emailPurge = `acct-del-purge-${run}@chatgram.test`;
  const emailOther = `acct-del-other-${run}@chatgram.test`;
  const phoneOnly = `+25078${String(Date.now()).slice(-7)}`;
  const createdIds = [];
  const userA = await register('A', emailA);
  const userB = await register('B', emailB);
  const userC = await register('C', emailC);
  const userD = await register('D', emailD);
  const phoneUser = await register('Phone', phoneOnly);
  createdIds.push(userA.id, userB.id, userC.id, userD.id, phoneUser.id);

  async function sendCode(token) {
    return api('POST', '/api/account/delete/request-code', { token });
  }
  async function confirm(token, body) {
    return api('POST', '/api/account/delete/confirm', { token, body });
  }
  async function backdateCode(target) {
    return VerificationCode.updateOne(
      { channel: 'email', target },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
  }
  async function clearCooldown(target) {
    return VerificationCode.updateOne(
      { channel: 'email', target },
      { $set: { lastSentAt: new Date(Date.now() - 61_000) } },
    );
  }
  async function me(token) {
    return api('GET', '/api/users/me', { token });
  }

  try {
    /* ------------------------------------------------------ unauthenticated */
    const unauth = await Promise.all([
      api('POST', '/api/account/delete/request-code'),
      api('POST', '/api/account/delete/confirm', { body: {} }),
      api('POST', '/api/account/delete/cancel'),
    ]);
    check('all three deletion routes require auth (401)', unauth.every((res) => res.status === 401), unauth.map((res) => res.status));

    /* --------------------------------------------- phone-only -> EMAIL_REQUIRED */
    const phoneRes = await sendCode(phoneUser.token);
    check('a phone-only account gets 409 EMAIL_REQUIRED', phoneRes.status === 409 && phoneRes.body?.code === 'EMAIL_REQUIRED', phoneRes.body);

    /* --------------------------------------- code request contract + expiry */
    const sent = await sendCode(userC.token);
    check('request-code returns { sent, channel, expiresInSeconds: 600 }', sent.status === 200 && sent.body?.sent === true && sent.body?.channel === 'email' && sent.body?.expiresInSeconds === 600, sent.body);
    check('development mode exposes the code only for the isolated test', typeof sent.body?.devCode === 'string' && sent.body.devCode.length === 6, Boolean(sent.body?.devCode));
    const codeC = sent.body.devCode;

    const storedCode = await VerificationCode.findOne({ channel: 'email', target: deletionTarget(emailC) }).lean();
    const ttlSeconds = storedCode ? Math.round((new Date(storedCode.expiresAt) - new Date(storedCode.lastSentAt)) / 1000) : null;
    check('the stored deletion code lives 10 minutes', ttlSeconds === 600, ttlSeconds);

    await backdateCode(deletionTarget(emailC));
    const expired = await confirm(userC.token, { password: 'AccountDel1!', code: codeC, confirmWord: 'DELETE' });
    check('an expired code is rejected with CODE_EXPIRED', expired.status === 400 && expired.body?.code === 'CODE_EXPIRED', expired.body);

    /* ------------------------------------------------ wrong password + word */
    await clearCooldown(deletionTarget(emailB));
    const sentB = await sendCode(userB.token);
    check('a second code request works after the resend cooldown', sentB.status === 200, sentB.status);
    const codeB = sentB.body.devCode;

    const wrongPassword = await confirm(userB.token, { password: 'WrongPassword1!', code: codeB, confirmWord: 'DELETE' });
    check('a wrong password is rejected with PASSWORD_INVALID', wrongPassword.status === 400 && wrongPassword.body?.code === 'PASSWORD_INVALID', wrongPassword.body);

    const wrongWord = await confirm(userB.token, { password: 'AccountDel1!', code: codeB, confirmWord: 'delete' });
    check('a missing/incorrect DELETE confirm word is rejected', wrongWord.status === 400 && wrongWord.body?.code === 'CONFIRM_WORD_REQUIRED', wrongWord.body);

    /* --------------------------------------------- attempts limit (5 tries) */
    await clearCooldown(deletionTarget(emailC));
    // Burn the previous record first: the expired attempt already consumed it,
    // so request a fresh code for the attempt-limit scenario.
    const sentAgain = await sendCode(userC.token);
    check('a fresh code can be requested after the cooldown', sentAgain.status === 200, sentAgain.status);
    const codeC2 = sentAgain.body.devCode;
    let lastAttempt;
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      lastAttempt = await confirm(userC.token, { password: 'AccountDel1!', code: '000000', confirmWord: 'DELETE' });
    }
    check('the first five wrong guesses are plain CODE_INVALID', lastAttempt.status === 400 && lastAttempt.body?.code === 'CODE_INVALID', lastAttempt.body);
    const afterBurn = await confirm(userC.token, { password: 'AccountDel1!', code: codeC2, confirmWord: 'DELETE' });
    check('the sixth verification hits the attempt limit (429 TOO_MANY)', afterBurn.status === 429 && afterBurn.body?.code === 'CODE_TOO_MANY_ATTEMPTS', afterBurn.body);

    /* ------------------------------------------------------ 3 sends per hour */
    const hourLimitUser = userD;
    await sendCode(hourLimitUser.token);
    await AdminAudit.create([
      { action: 'account_delete_code_sent', userId: hourLimitUser.id, detail: 'sent', at: new Date() },
      { action: 'account_delete_code_sent', userId: hourLimitUser.id, detail: 'sent', at: new Date() },
    ]);
    const fourthSend = await sendCode(hourLimitUser.token);
    check('a fourth send within an hour is rate limited', fourthSend.status === 429 && fourthSend.body?.code === 'CODE_RATE_LIMITED', fourthSend.body);

    /* ------------------------------------ schedule + hide from discovery/chat */
    const scheduled = await confirm(userB.token, { password: 'AccountDel1!', code: codeB, confirmWord: 'DELETE', reason: 'switching accounts' });
    check('confirm schedules deletion and returns deleteAt', scheduled.status === 200 && scheduled.body?.scheduled === true && Boolean(scheduled.body?.deleteAt), scheduled.body);
    const deleteAtMs = new Date(scheduled.body.deleteAt).getTime();
    const graceDays = Math.round((deleteAtMs - Date.now()) / DAY);
    check('the grace period is 14 days', graceDays === 14, graceDays);

    const rowB = await User.findById(userB.id).select('pendingDeletionAt deleteAt deletionReason').lean();
    check('the user stores pendingDeletionAt + deleteAt + capped reason', Boolean(rowB?.pendingDeletionAt) && Boolean(rowB?.deleteAt) && rowB?.deletionReason === 'switching accounts', rowB);

    const meB = await me(userB.token);
    check('GET /api/users/me exposes pendingDeletion during grace', meB.status === 200 && meB.body?.pendingDeletion?.deleteAt === scheduled.body.deleteAt, meB.body?.pendingDeletion);

    const searchHidden = await api('GET', `/api/users/search?query=${encodeURIComponent(emailB)}`, { token: userA.token });
    const searchRows = Array.isArray(searchHidden.body) ? searchHidden.body : searchHidden.body?.users || [];
    check('a pending-deletion account is hidden from user search', searchRows.length === 0, searchRows.length);

    const directoryHidden = await api('GET', `/api/contacts/search?query=${encodeURIComponent(emailB)}`, { token: userA.token });
    check('a pending-deletion account is hidden from the contact directory', directoryHidden.status === 200 && (directoryHidden.body?.length ?? directoryHidden.body?.users?.length ?? 0) === 0, directoryHidden.body);

    const addContact = await api('POST', '/api/contacts', { token: userA.token, body: { userId: userB.id } });
    check('a pending-deletion account cannot be added as a contact', addContact.status === 404, addContact.status);

    const newChat = await api('POST', '/api/chats', { token: userA.token, body: { type: 'direct', participantId: userB.id } });
    check('a new direct chat cannot be started with a pending-deletion account', newChat.status === 404 && newChat.body?.code === 'USER_UNAVAILABLE', newChat.body);

    /* --------------------------------------------------------------- cancel */
    const cancelled = await api('POST', '/api/account/delete/cancel', { token: userB.token });
    check('cancel clears the pending deletion', cancelled.status === 200 && cancelled.body?.cancelled === true, cancelled.body);
    const afterCancel = await User.findById(userB.id).select('pendingDeletionAt deleteAt deletionReason').lean();
    check('cancel clears the stored fields', !afterCancel?.pendingDeletionAt && !afterCancel?.deleteAt, afterCancel);
    const cancelAgain = await api('POST', '/api/account/delete/cancel', { token: userB.token });
    check('cancel is idempotent (200 when nothing is pending)', cancelAgain.status === 200 && cancelAgain.body?.cancelled === true, cancelAgain.body);

    const meAfterCancel = await me(userB.token);
    check('pendingDeletion is null after cancel', meAfterCancel.body?.pendingDeletion === null, meAfterCancel.body?.pendingDeletion);

    /* --------------------------------- signed-in auto-restore during grace */
    await clearCooldown(deletionTarget(emailB));
    const sentB2 = await sendCode(userB.token);
    const codeB2 = sentB2.body.devCode;
    const scheduled2 = await confirm(userB.token, { password: 'AccountDel1!', code: codeB2, confirmWord: 'DELETE' });
    check('the account can be scheduled again', scheduled2.status === 200 && scheduled2.body?.scheduled === true, scheduled2.body);
    const loginRestore = await api('POST', '/api/auth/login', { body: { identifier: emailB, password: 'AccountDel1!' } });
    check('signing in during grace succeeds and returns pendingDeletion: null', loginRestore.status === 200 && loginRestore.body?.user?.pendingDeletion === null, loginRestore.body?.user?.pendingDeletion);
    const restoredRow = await User.findById(userB.id).select('pendingDeletionAt deleteAt').lean();
    check('signing in automatically cancels the pending deletion', !restoredRow?.pendingDeletionAt && !restoredRow?.deleteAt, restoredRow);

    /* ------------------------------------------------ purger + message policy */
    const purgeUser = await register('Purge', emailPurge);
    const otherUser = await register('Other', emailOther);
    createdIds.push(purgeUser.id, otherUser.id);
    await User.updateOne({ _id: purgeUser.id }, {
      $set: { avatarUrl: `https://cdn.example.test/avatars/${purgeUser.id}.jpeg` },
    });
    const chat = await Chat.create({ type: 'direct', participants: [purgeUser.id, otherUser.id] });
    await Message.create([
      { chatId: chat._id, senderId: purgeUser.id, content: 'my private message', mediaUrl: `https://cdn.example.test/msg/${purgeUser.id}.jpg`, type: 'text' },
      { chatId: chat._id, senderId: otherUser.id, content: 'keep me', type: 'text' },
    ]);
    await Status.create({
      userId: purgeUser.id,
      text: 'status text',
      mediaUrl: `https://cdn.example.test/status/${purgeUser.id}.jpg`,
      mediaType: 'image',
      mediaProvider: 'local',
    });
    await DeviceToken.create({ userId: purgeUser.id, token: `tok-${run}`, platform: 'android' });
    await UserSession.create({ userId: purgeUser.id, ip: '127.0.0.1', userAgent: 'test', deviceLabel: 'test' });
    await VerificationCode.create({
      channel: 'email',
      target: deletionTarget(emailPurge),
      codeHash: 'x',
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      lastSentAt: new Date(),
    });
    await User.updateOne({ _id: purgeUser.id }, {
      $set: { pendingDeletionAt: new Date(Date.now() - 15 * DAY), deleteAt: new Date(Date.now() - 60_000) },
    });

    const purgeResult = await runAccountDeletionPurge();
    const purgedIds = purgeResult.map((entry) => entry.userId);
    check('the purger deletes the expired account', purgedIds.includes(String(purgeUser.id)), purgedIds);
    check('the purged user document is gone', (await User.findById(purgeUser.id)) === null, null);
    check('statuses, device tokens, sessions and codes are gone', (await Status.countDocuments({ userId: purgeUser.id })) === 0
      && (await DeviceToken.countDocuments({ userId: purgeUser.id })) === 0
      && (await UserSession.countDocuments({ userId: purgeUser.id })) === 0
      && (await VerificationCode.countDocuments({ target: deletionTarget(emailPurge) })) === 0, null);

    const survivorChat = await Chat.findById(chat._id).lean();
    check('the other participant still has the direct chat', Boolean(survivorChat), Boolean(survivorChat));
    const purgedMessages = await Message.find({ chatId: chat._id }).lean();
    const mine = purgedMessages.find((message) => String(message.senderId) === String(purgeUser.id));
    const theirs = purgedMessages.find((message) => String(message.senderId) === String(otherUser.id));
    check('the deleted author\'s message is marked deleted-author', Boolean(mine) && mine.isDeleted === true && mine.content === '' && mine.mediaUrl === null, mine);
    check('the other participant\'s message is untouched', Boolean(theirs) && theirs.isDeleted !== true && theirs.content === 'keep me', theirs);

    const queued = await PendingMediaDeletion.find({ userId: purgeUser.id }).lean();
    const queuedKinds = queued.map((entry) => entry.kind).sort();
    check('media URLs are queued for operator cleanup instead of external calls', queuedKinds.includes('message') && queuedKinds.includes('status') && queuedKinds.includes('avatar'), queuedKinds);

    /* ---------------------------------------------------- audit rows content-free */
    const lifecycle = await AdminAudit.find({ action: { $in: [
      'account_delete_code_sent',
      'account_deletion_scheduled',
      'account_deletion_cancelled',
      'account_deletion_executed',
    ] } }).lean();
    const actions = new Set(lifecycle.map((entry) => entry.action));
    check('audit rows exist for request/schedule/cancel/execution',
      actions.has('account_delete_code_sent') && actions.has('account_deletion_scheduled') && actions.has('account_deletion_cancelled') && actions.has('account_deletion_executed'),
      [...actions]);
    const flagsOnly = new Set(['sent', 'scheduled', 'has_reason', 'cancelled', 'restored_on_login', 'purged']);
    check('audit rows are content-free (flags only, no email/code/reason)', lifecycle.every((entry) => flagsOnly.has(String(entry.detail || ''))), lifecycle.map((entry) => entry.detail).slice(0, 10));
    const auditText = JSON.stringify(lifecycle);
    check('audit rows never contain the email, the code or the reason text',
      !auditText.includes(emailB) && !auditText.includes(emailC) && !auditText.includes('switching accounts') && !auditText.includes('devCode'),
      null);
  } finally {
    const ids = createdIds.filter(Boolean);
    await Promise.all([
      User.deleteMany({ _id: { $in: ids } }),
      Chat.deleteMany({ participants: { $in: ids } }),
      Message.deleteMany({ senderId: { $in: ids } }),
      Status.deleteMany({ userId: { $in: ids } }),
      DeviceToken.deleteMany({ userId: { $in: ids } }),
      UserSession.deleteMany({ userId: { $in: ids } }),
      VerificationCode.deleteMany({ target: new RegExp(`(acct-del|delete:)`) }),
      PendingMediaDeletion.deleteMany({ userId: { $in: ids } }),
      AdminAudit.deleteMany({ userId: { $in: ids } }),
    ]).catch(() => {});
    if (platformBefore) {
      await platformSettings
        .update({ signupThrottleEnabled: platformBefore.signupThrottleEnabled !== false }, { ip: '127.0.0.1', headers: {} })
        .catch(() => {});
    }
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('account deletion test crashed:', String((error && error.stack) || error).slice(0, 1200));
  process.exit(1);
});
