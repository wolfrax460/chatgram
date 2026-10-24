/**
 * Group "@Chatgram AI" mentions (Change 1) â€” integration against the staging API.
 *
 * The staging server must be running (scripts/start-staging.ps1). A local mock
 * OpenAI-compatible provider is configured through the real admin API, so the
 * full stack is exercised: REST message -> mention hook -> provider -> stored
 * group reply -> people-search exclusion -> rate limiting.
 *
 *   node server/test/integration/groupAiMentions.test.js
 */
const path = require('path');
const mongoose = require('mongoose');
const mockAi = require(path.join(__dirname, '..', '..', '..', 'tests', 'e2e', 'mockAiProvider'));

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const PROVIDER_KEY = 'e2e-group-ai';
const run = Date.now().toString(36);
const mute = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ` -> ${JSON.stringify(detail).slice(0, 220)}` : ''}`);
  }
}

async function api(method, route, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, body: payload };
}

async function register(label) {
  const identifier = `e2e-groupai-${label}-${run}@chatgram.test`;
  const password = 'GroupAiPass1!';
  const result = await api('POST', '/api/auth/register', {
    body: { displayName: `E2E GROUP AI ${label} ${run}`, identifier, password },
  });
  if (result.status !== 201) throw new Error(`register ${label}: ${result.status} ${JSON.stringify(result.body)}`);
  return { identifier, password, accessToken: result.body.accessToken, user: result.body.user };
}

async function adminHeaders() {
  const login = await fetch(`${API}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const payload = await login.json();
  const cookie = (login.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; ');
  return { 'Content-Type': 'application/json', Cookie: cookie, 'X-Admin-CSRF': payload.csrfToken };
}

async function configureProvider() {
  const headers = await adminHeaders();
  const saved = await fetch(`${API}/api/admin/providers/${PROVIDER_KEY}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      key: PROVIDER_KEY,
      provider: 'custom',
      label: 'E2E group AI',
      model: mockAi.MODEL,
      baseUrl: `http://127.0.0.1:${mockAi.PORT}/v1`,
      apiKey: 'e2e-not-a-real-key',
      enabled: true,
      timeoutMs: 15000,
    }),
  });
  if (!saved.ok) throw new Error(`provider save: ${saved.status} ${await saved.text()}`);
  const routed = await fetch(`${API}/api/admin/providers/features`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ features: { chatgramAI: { primary: PROVIDER_KEY, fallbacks: [] } } }),
  });
  if (!routed.ok) throw new Error(`provider route: ${routed.status} ${await routed.text()}`);
  return headers;
}

async function removeProvider(headers) {
  await fetch(`${API}/api/admin/providers/${PROVIDER_KEY}`, { method: 'DELETE', headers }).catch(() => {});
}

/** Wait until a message from the Chatgram AI account appears in the chat. */
async function waitForAiReply(token, chatId, { timeoutMs = 20000, sinceId } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await api('GET', `/api/messages?chatId=${chatId}&limit=50`, { token });
    const rows = Array.isArray(result.body) ? result.body : result.body?.messages || [];
    const ai = rows.filter((row) => {
      const name = row.senderId?.displayName || row.sender?.displayName || '';
      return name === 'Chatgram AI';
    });
    const fresh = sinceId ? ai.filter((row) => String(row._id || row.id) !== String(sinceId)) : ai;
    if (fresh.length > 0) return fresh;
    await mute(500);
  }
  return [];
}

async function sendMention(account, chatId, text) {
  return api('POST', '/api/messages', { token: account.accessToken, body: { chatId, type: 'text', content: text } });
}

async function main() {
  console.log('\ngroup @Chatgram AI mentions\n');
  process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging';
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection.db;

  await mockAi.start();
  const admin = await configureProvider();

  const owner = await register('owner');
  const member = await register('member');
  const created = { chats: [], users: [owner.user.id, member.user.id] };

  try {
    const group = await api('POST', '/api/chats', {
      token: owner.accessToken,
      body: { type: 'group', groupName: `E2E GROUP AI ${run}`, participantIds: [member.user.id] },
    });
    check('group created', group.status === 201, group.status);
    const chatId = String(group.body._id || group.body.id);
    created.chats.push(chatId);

    // 1. Off by default: a mention must NOT reach the provider.
    const beforeToggle = await sendMention(member, chatId, '@Chatgram AI what is Chatgram?');
    const offReplies = await waitForAiReply(member.accessToken, chatId, { timeoutMs: 4000 });
    check('mention request accepted while the toggle is off', beforeToggle.status === 201, beforeToggle.status);
    check('toggle off: no AI reply', offReplies.length === 0, offReplies.length);

    // 2. Enable the toggle in group settings.
    const toggled = await api('PATCH', `/api/chats/${chatId}`, {
      token: owner.accessToken,
      body: { groupSettings: { aiMentions: true } },
    });
    check('admin can enable AI mentions', toggled.status === 200, toggled.status);
    const settings = (await api('GET', `/api/chats/${chatId}`, { token: owner.accessToken })).body?.groupSettings;
    check('the setting is stored', settings?.aiMentions === true, settings);

    // 3. A mention now gets exactly one reply in the group thread.
    const mentioned = await sendMention(member, chatId, '@Chatgram AI summarise Chatgram in one line');
    check('mention message stored', mentioned.status === 201, mentioned.status);
    const replies = await waitForAiReply(member.accessToken, chatId);
    check('an AI reply is posted in the group', replies.length === 1, replies.length);
    const reply = replies[0] || {};
    check('the reply comes from the Chatgram AI account', (reply.senderId?.displayName || '') === 'Chatgram AI', reply.senderId?.displayName);
    check('the reply has real content', String(reply.content || '').length > 20, String(reply.content || '').slice(0, 80));

    // 4. Non-mention messages never reach the provider.
    const plain = await sendMention(member, chatId, 'just chatting, no mention here');
    await mute(1500);
    const afterPlain = await waitForAiReply(member.accessToken, chatId, { timeoutMs: 2500 });
    check('plain message accepted', plain.status === 201, plain.status);
    check('no reply to a message without the mention', afterPlain.length === 1, afterPlain.length);

    // 5. Rate limit: 5 rapid mentions in a fresh group yield at most one reply
    //    (minimum gap 20s + 3 per 10 minutes per group).
    const group2 = await api('POST', '/api/chats', {
      token: owner.accessToken,
      body: { type: 'group', groupName: `E2E GROUP AI RL ${run}`, participantIds: [member.user.id] },
    });
    const chat2 = String(group2.body._id || group2.body.id);
    created.chats.push(chat2);
    await api('PATCH', `/api/chats/${chat2}`, { token: owner.accessToken, body: { groupSettings: { aiMentions: true } } });
    for (let index = 0; index < 5; index += 1) {
      await sendMention(member, chat2, `@Chatgram AI rapid question ${index}`);
      await mute(150);
    }
    const rapidReplies = await waitForAiReply(member.accessToken, chat2, { timeoutMs: 12000 });
    check('rapid mentions are rate limited to one reply', rapidReplies.length === 1, rapidReplies.length);

    // 6. The AI account is never a people-search result.
    const search = await api('GET', '/api/users/search?query=Chatgram', { token: member.accessToken });
    const rows = Array.isArray(search.body) ? search.body : search.body?.users || [];
    const aiRows = rows.filter((row) => (row.displayName || '') === 'Chatgram AI');
    check('Chatgram AI is not searchable as a person', aiRows.length === 0, aiRows.length);

    // 7. React toggling off stops replies again (fresh group).
    await api('PATCH', `/api/chats/${chat2}`, { token: owner.accessToken, body: { groupSettings: { aiMentions: false } } });
    const turnedOff = await sendMention(member, chat2, '@Chatgram AI are you still there?');
    await mute(1500);
    const offAgain = await waitForAiReply(member.accessToken, chat2, { timeoutMs: 2500 });
    check('turning the toggle off stops new replies', turnedOff.status === 201 && offAgain.length === 1, offAgain.length);
  } finally {
    await removeProvider(admin);
    // Delete everything this test created, by exact id.
    const chatIds = created.chats.map((id) => new mongoose.Types.ObjectId(String(id)));
    const userIds = created.users.map((id) => new mongoose.Types.ObjectId(String(id)));
    await db.collection('messages').deleteMany({ chatId: { $in: chatIds } });
    await db.collection('chats').deleteMany({ _id: { $in: chatIds } });
    await db.collection('users').deleteMany({ _id: { $in: userIds } });
    // Keep the Chatgram AI account: it is a shared system account, not test data.
    await mongoose.disconnect();
    await mockAi.stop();
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', String((error && error.stack) || error).slice(0, 900));
  process.exit(1);
});
