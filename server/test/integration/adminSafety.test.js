/**
 * 9b Safety & abuse: blocked words, links and email domains, message rate
 * limiting, signup throttling, IP bans and spam signals — admin session only.
 *
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/adminSafety.test.js
 */
const mongoose = require('mongoose');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const run = Date.now().toString(36);
const BLOCKED_WORD = `safetyword${run}`;
const BLOCKED_LINK = `blocked${run}.test`;
const BLOCKED_EMAIL = `blockedmail${run}.test`;

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` -> ${JSON.stringify(detail).slice(0, 260)}` : ''}`);
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
  return { status: response.status, body: payload, text, headers: response.headers };
}

async function register(label, identifierOverride = '') {
  const identifier = identifierOverride || `safety-${label}-${run}@chatgram.test`;
  const result = await api('POST', '/api/auth/register', {
    body: { displayName: `Safety ${label} ${run}`, identifier, password: 'Safety1!' },
  });
  return { result, identifier };
}

async function main() {
  console.log('\nsafety & abuse (9b)\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const User = require('../../src/models/User');
  const Chat = require('../../src/models/Chat');
  const Message = require('../../src/models/Message');
  const platformSettings = require('../../src/utils/platformSettings');

  const login = await fetch(`${API}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const loginBody = await login.json();
  const headers = {
    Cookie: (login.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; '),
    'X-Admin-CSRF': loginBody.csrfToken,
  };
  check('admin login works', login.status === 200 && Boolean(loginBody.csrfToken), login.status);

  const initial = await api('GET', '/api/admin/safety', { headers });
  check('the safety state loads (settings + signals)', initial.status === 200 && initial.body?.settings && initial.body?.signals, initial.status);
  check('the safety payload carries no secrets', !/passwordHash|accessToken|refreshToken|totpSecret|apiKey/i.test(initial.text), null);
  const userTokenAsk = await api('GET', '/api/admin/safety', { token: 'user-token-that-is-invalid' });
  check('a normal user token cannot read the safety state', userTokenAsk.status === 401, userTokenAsk.status);

  // Configure rules for this test.
  const saved = await api('PUT', '/api/admin/safety', {
    headers,
    body: {
      blockedWords: [BLOCKED_WORD],
      blockedLinkDomains: [BLOCKED_LINK],
      blockedEmailDomains: [BLOCKED_EMAIL],
      messagesPerMinute: 5,
      signupsPerHourPerIp: 50,
      massMessageHourly: 500,
      signupThrottleEnabled: true,
    },
  });
  check('safety rules save', saved.status === 200 && saved.body?.settings?.blockedWords?.includes(BLOCKED_WORD), saved.status);

  const a = await register('a');
  const b = await register('b');
  check('test accounts register', a.result.status === 201 && b.result.status === 201, { a: a.result.status, b: b.result.status });
  const chat = await api('POST', '/api/chats', {
    token: a.result.body.accessToken,
    body: { type: 'direct', participantId: b.result.body.user.id },
  });
  const chatId = chat.body?._id || chat.body?.id;

  // Blocked word.
  const blockedWord = await api('POST', '/api/messages', {
    token: a.result.body.accessToken,
    body: { chatId, type: 'text', content: `this contains ${BLOCKED_WORD} unfortunately` },
  });
  check('a blocked word refuses the message', blockedWord.status === 403 && blockedWord.body?.code === 'BLOCKED_WORD', { status: blockedWord.status, code: blockedWord.body?.code });

  // Blocked link domain.
  const blockedLink = await api('POST', '/api/messages', {
    token: a.result.body.accessToken,
    body: { chatId, type: 'text', content: `visit https://www.${BLOCKED_LINK}/claim now` },
  });
  check('a blocked link domain refuses the message', blockedLink.status === 403 && blockedLink.body?.code === 'BLOCKED_LINK', { status: blockedLink.status, code: blockedLink.body?.code });

  // Clean message works, then the per-minute rate limit trips.
  const firstClean = await api('POST', '/api/messages', {
    token: a.result.body.accessToken,
    body: { chatId, type: 'text', content: `Clean message one ${run}` },
  });
  check('a clean message is accepted', firstClean.status === 201, firstClean.status);
  for (let index = 2; index <= 5; index += 1) {
    await api('POST', '/api/messages', { token: a.result.body.accessToken, body: { chatId, type: 'text', content: `Clean message ${index} ${run}` } });
  }
  const rateLimited = await api('POST', '/api/messages', {
    token: a.result.body.accessToken,
    body: { chatId, type: 'text', content: `Clean message over the limit ${run}` },
  });
  check('the per-user message rate limit returns 429', rateLimited.status === 429 && rateLimited.body?.code === 'MESSAGE_RATE_LIMITED', { status: rateLimited.status, code: rateLimited.body?.code });

  // Blocked email domain blocks registration.
  const blockedEmail = await register('blocked', `blocked-${run}@${BLOCKED_EMAIL}`);
  check('a blocked email domain cannot sign up', blockedEmail.result.status === 403 && blockedEmail.result.body?.code === 'EMAIL_DOMAIN_BLOCKED', { status: blockedEmail.result.status, code: blockedEmail.result.body?.code });

  // Signup throttle: every registration above goes through this IP, so a limit of
  // 1 must refuse the next account from the same network.
  await api('PUT', '/api/admin/safety', { headers, body: { signupsPerHourPerIp: 1 } });
  const throttleOne = await register('throttle1');
  const throttleTwo = await register('throttle2');
  check('the first signup under a fresh limit is allowed', throttleOne.result.status === 201, throttleOne.result.status);
  check('per-IP signup throttling refuses a burst', throttleTwo.result.status === 429 && throttleTwo.result.body?.code === 'SIGNUP_THROTTLED', { status: throttleTwo.result.status, code: throttleTwo.result.body?.code });
  await api('PUT', '/api/admin/safety', { headers, body: { signupsPerHourPerIp: 50 } });

  // IP bans block normal API traffic but keep the admin panel reachable.
  const ban = await api('POST', '/api/admin/safety/ip-bans', { headers, body: { ip: '127.0.0.1', reason: `Safety test ${run}` } });
  check('an IP ban is added', ban.status === 200 && (ban.body?.settings?.ipBans || []).some((entry) => entry.ip === '127.0.0.1'), ban.status);
  const bannedRequest = await api('GET', `/api/users/${b.result.body.user.id}`, { token: b.result.body.accessToken });
  check('a banned IP is refused with IP_BANNED', bannedRequest.status === 403 && bannedRequest.body?.code === 'IP_BANNED', { status: bannedRequest.status, code: bannedRequest.body?.code });
  const adminStillReachable = await api('GET', '/api/admin/safety', { headers });
  check('the admin panel stays reachable from a banned IP', adminStillReachable.status === 200, adminStillReachable.status);
  const unban = await api('DELETE', '/api/admin/safety/ip-bans/127.0.0.1', { headers });
  check('an IP ban can be removed', unban.status === 200 && !((unban.body?.settings?.ipBans || []).some((entry) => entry.ip === '127.0.0.1')), unban.status);
  const afterUnban = await api('GET', `/api/users/${b.result.body.user.id}`, { token: b.result.body.accessToken });
  check('traffic works again after the unban', afterUnban.status === 200, afterUnban.status);

  // Spam signals.
  const signals = await api('GET', '/api/admin/safety/signals', { headers });
  check('spam signals endpoint works', signals.status === 200 && Array.isArray(signals.body?.massMessaging), signals.status);
  check('signals carry no secrets', !/passwordHash|accessToken|totpSecret/i.test(signals.text), null);

  // Restore the default safety settings so staging is not left with test rules.
  const restored = await api('PUT', '/api/admin/safety', {
    headers,
    body: {
      blockedWords: [],
      blockedLinkDomains: [],
      blockedEmailDomains: [],
      messagesPerMinute: 60,
      signupsPerHourPerIp: 20,
      massMessageHourly: 200,
      signupThrottleEnabled: true,
    },
  });
  check('the default safety settings are restored', restored.status === 200 && (restored.body?.settings?.blockedWords || []).length === 0, restored.status);

  // Cleanup test data.
  const ids = [a, b].map((entry) => entry.result.body?.user?.id).filter(Boolean).map((id) => new mongoose.Types.ObjectId(String(id)));
  for (const entry of [throttleOne, throttleTwo]) if (entry.result.status === 201) ids.push(new mongoose.Types.ObjectId(String(entry.result.body.user.id)));
  await Message.deleteMany({ chatId: new mongoose.Types.ObjectId(String(chatId)) });
  await Chat.deleteMany({ _id: new mongoose.Types.ObjectId(String(chatId)) });
  await User.deleteMany({ _id: { $in: ids } });
  platformSettings.resetCache();

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error('safety test crashed:', error);
  try { await mongoose.disconnect(); } catch { /* closed */ }
  process.exit(1);
});
