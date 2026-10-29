/**
 * Smart replies (opt-in), auto-reply/away message, global disappearing default
 * and the public changelog.
 *
 *   node server/test/integration/personalizationFeatures.test.js
 *
 * Self-contained: local OpenAI-compatible stub, an isolated API on :5094 and a
 * temporary database; nothing here touches the real AI providers or production.
 */
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const SERVER_ROOT = path.resolve(__dirname, '../..');
const DB = 'mongodb://127.0.0.1:27017/chatgram_personalization_test';
const PORT = 5094;
const run = Date.now().toString(36);

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

function startStub(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        let body = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
        handler(req, res, body, raw);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}
function openAiAnswer(res, text) {
  sendJson(res, 200, {
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 10, completion_tokens: 10 },
  });
}
async function waitFor(fn, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const value = await fn();
    if (value) return value;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

function spawnApi(extraEnv) {
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(PORT),
    MONGODB_URI: DB,
    JWT_SECRET: 'personalization-test-jwt-secret-0123456789',
    JWT_REFRESH_SECRET: 'personalization-test-refresh-0123456789',
    REQUIRE_VERIFICATION: 'false',
    DEV_SHOW_CODES: 'true',
    AUTH_RATE_LIMIT_DISABLED: 'true',
    HELP_RATE_LIMIT_DISABLED: 'true',
    EMAIL_ENABLED: 'false',
    EMAIL_PROVIDER: 'console',
    SMS_PROVIDER: 'console',
    SUPPORT_AI_LAYER: '',
    NVIDIA_API_KEY: '',
    ...extraEnv,
  };
  const child = spawn(process.execPath, ['src/server.js'], { cwd: SERVER_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  return { child, baseUrl: `http://127.0.0.1:${PORT}`, output: () => output };
}

async function api(method, route, { token, body } = {}) {
  const response = await fetch(`http://127.0.0.1:${PORT}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, body: payload, headers: response.headers };
}

async function register(label) {
  const identifier = `personalization-${label}-${run}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await api('POST', '/api/auth/register', {
    body: { displayName: `Personalization ${label}`, identifier, password: 'Personalization1!' },
  });
  if (res.status !== 201) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken, id: res.body.user.id, email: identifier };
}

async function createDirect(token, participantId) {
  const res = await api('POST', '/api/chats', { token, body: { type: 'direct', participantId } });
  if (res.status !== 201 && res.status !== 200) throw new Error(`create direct: ${res.status} ${JSON.stringify(res.body)}`);
  return String(res.body._id);
}

async function send(token, chatId, content) {
  return api('POST', '/api/messages', { token, body: { chatId, type: 'text', content } });
}

function timeAgoOrAhead(minutesOffset) {
  const date = new Date(Date.now() + minutesOffset * 60 * 1000);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

async function main() {
  console.log('\npersonalization features (smart replies, auto-reply, disappearing, changelog)\n');
  const aiCalls = [];
  let aiMode = 'ok';
  const aiStub = await startStub((req, res, body) => {
    if (!/\/chat\/completions$/.test(req.url || '')) return sendJson(res, 404, {});
    aiCalls.push(body);
    if (aiMode === 'fail') return sendJson(res, 500, { error: { message: 'provider down' } });
    return openAiAnswer(res, [
      '1. Sounds good!',
      '- Sounds good!',
      'Let me check and get back to you.',
      'Sure, see you there 🙂',
      'https://evil.example/path',
      'Email me at user@example.com',
      'A'.repeat(140),
    ].join('\n'));
  });
  const aiBase = `http://127.0.0.1:${aiStub.address().port}`;

  const app = spawnApi({
    SUPPORT_AI_ENABLED: 'true',
    SUPPORT_AI_PROVIDER: 'custom',
    SUPPORT_AI_MODEL: 'suggestion-model',
    SUPPORT_AI_BASE_URL: `${aiBase}/v1`,
    SUPPORT_AI_API_KEY: 'test-key-1234567890123456',
  });

  await mongoose.connect(DB, { serverSelectionTimeoutMS: 5000 });
  const User = require('../../src/models/User');
  const Chat = require('../../src/models/Chat');
  const Message = require('../../src/models/Message');
  const AutoReplyLog = require('../../src/models/AutoReplyLog');
  const AppRelease = require('../../src/models/AppRelease');
  const autoReply = require('../../src/utils/autoReply');
  const createdUsers = [];

  try {
    const ready = await waitFor(async () => {
      const health = await api('GET', '/api/health').catch(() => null);
      return health?.body?.database === 'connected';
    });
    check('the isolated API boots (AI provider stubbed)', Boolean(ready), app.output().slice(-300));
    if (!ready) throw new Error('API did not boot');

    const alice = await register('alice');
    const bob = await register('bob');
    const carol = await register('carol');
    const dave = await register('dave');
    const erin = await register('erin');
    const frank = await register('frank');
    const gina = await register('gina');
    createdUsers.push(alice, bob, carol, dave, erin, frank, gina);

    /* ---------------------------------------------------- smart replies */
    const aliceChat = await createDirect(alice.token, bob.id);
    await send(alice.token, aliceChat, 'Hey Bob, are we still on for tomorrow?');
    const disabled = await api('POST', '/api/ai/suggest-replies', { token: alice.token, body: { chatId: aliceChat } });
    check('suggest replies are off by default (empty, no provider call)', disabled.status === 200 && Array.isArray(disabled.body?.suggestions) && disabled.body.suggestions.length === 0 && aiCalls.length === 0, { body: disabled.body, calls: aiCalls.length });

    const enabledPrefs = await api('PUT', '/api/users/me/ai-settings', { token: alice.token, body: { suggestReplies: true } });
    check('suggestReplies can be enabled via the settings endpoint', enabledPrefs.status === 200 && enabledPrefs.body?.suggestReplies === true, enabledPrefs.body);
    const badPrefs = await api('PUT', '/api/users/me/ai-settings', { token: alice.token, body: { suggestReplies: 'yes' } });
    check('invalid suggestReplies values are rejected', badPrefs.status === 400, badPrefs.status);

    await send(bob.token, aliceChat, 'Yes! See you at 10. My number is +250788123456 or bob@example.test');
    const suggestionsRes = await api('POST', '/api/ai/suggest-replies', { token: alice.token, body: { chatId: aliceChat } });
    const suggestions = suggestionsRes.body?.suggestions || [];
    check('enabled suggestions return three validated replies', suggestionsRes.status === 200 && suggestions.length === 3, suggestions);
    check('suggestions are deduped, trimmed and length-capped', suggestions.includes('Sounds good!') && suggestions.includes('Let me check and get back to you.') && suggestions.includes('Sure, see you there 🙂') && suggestions.every((item) => item.length <= 120), suggestions);
    check('links, emails, phone numbers and long lines are dropped', suggestions.every((item) => !/https?:|@|2507/.test(item)), suggestions);
    const lastAiCall = aiCalls[aiCalls.length - 1] || {};
    const transcript = JSON.stringify(lastAiCall.messages || []);
    check('the transcript is redacted before it reaches the provider', !transcript.includes('+250788123456') && !transcript.includes('bob@example.test'), transcript.slice(0, 200));

    // Nothing is stored: only the normal message rows changed.
    const messageCountBefore = await Message.countDocuments({ chatId: aliceChat });
    const inboxCountBefore = await (async () => {
      try { return await mongoose.connection.collection('admininboxes').countDocuments(); } catch { return 0; }
    })();
    await api('POST', '/api/ai/suggest-replies', { token: alice.token, body: { chatId: aliceChat } });
    check('suggestions do not write messages or Inbox rows', (await Message.countDocuments({ chatId: aliceChat })) === messageCountBefore && (await mongoose.connection.collection('admininboxes').countDocuments().catch(() => 0)) === inboxCountBefore, null);

    aiMode = 'fail';
    const failRes = await api('POST', '/api/ai/suggest-replies', { token: alice.token, body: { chatId: aliceChat } });
    check('a provider failure returns suggestions: [] with 200', failRes.status === 200 && Array.isArray(failRes.body?.suggestions) && failRes.body.suggestions.length === 0, failRes.body);
    aiMode = 'ok';

    const badChat = await api('POST', '/api/ai/suggest-replies', { token: alice.token, body: { chatId: 'not-an-id' } });
    check('an invalid chatId is rejected', badChat.status === 400, badChat.status);

    // Rate limit for a fresh user: 20/hour.
    await api('PUT', '/api/users/me/ai-settings', { token: erin.token, body: { suggestReplies: true } });
    const erinChat = await createDirect(erin.token, frank.id);
    await send(frank.token, erinChat, 'Hello Erin');
    let rateStatus = 0;
    for (let i = 0; i < 21; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await api('POST', '/api/ai/suggest-replies', { token: erin.token, body: { chatId: erinChat } });
      rateStatus = res.status;
    }
    check('suggestion requests are rate limited per user (21st -> 429)', rateStatus === 429, rateStatus);

    /* --------------------------------------------------------- auto-reply */
    const defaultAuto = await api('GET', '/api/users/me/auto-reply', { token: bob.token });
    check('auto-reply is off by default with valid shape', defaultAuto.status === 200 && defaultAuto.body?.enabled === false && defaultAuto.body?.schedule === 'always' && defaultAuto.body?.audience === 'contacts', defaultAuto.body);

    const emptyMessage = await api('PUT', '/api/users/me/auto-reply', { token: bob.token, body: { enabled: true, message: '' } });
    check('enabling with an empty message is rejected', emptyMessage.status === 400 && emptyMessage.body?.code === 'MESSAGE_REQUIRED', emptyMessage.body);
    const badTime = await api('PUT', '/api/users/me/auto-reply', { token: bob.token, body: { enabled: true, message: 'Away', schedule: 'outside-hours', startTime: '25:00' } });
    check('an invalid time is rejected', badTime.status === 400 && badTime.body?.code === 'INVALID_TIME', badTime.body);
    const badAudience = await api('PUT', '/api/users/me/auto-reply', { token: bob.token, body: { enabled: true, message: 'Away', audience: 'friends' } });
    check('an invalid audience is rejected', badAudience.status === 400 && badAudience.body?.code === 'INVALID_AUDIENCE', badAudience.body);
    const longMessage = await api('PUT', '/api/users/me/auto-reply', { token: bob.token, body: { enabled: true, message: 'x'.repeat(501) } });
    check('an auto-reply message over 500 chars is rejected', longMessage.status === 400 && longMessage.body?.code === 'MESSAGE_TOO_LONG', longMessage.body);

    const bobSaved = await api('PUT', '/api/users/me/auto-reply', {
      token: bob.token,
      body: { enabled: true, message: 'I am away from my phone and will reply soon.', schedule: 'always', audience: 'everyone' },
    });
    check('valid auto-reply settings are saved and returned', bobSaved.status === 200 && bobSaved.body?.enabled === true && bobSaved.body?.audience === 'everyone' && bobSaved.body?.message.includes('away'), bobSaved.body);

    const replyOne = await send(alice.token, aliceChat, 'Are you there?');
    check('the original message still sends', replyOne.status === 201, replyOne.body);
    let autoReplyRows = await Message.find({ chatId: aliceChat, autoReply: true }).lean();
    check('the recipient auto-replies once in a direct chat', autoReplyRows.length === 1 && String(autoReplyRows[0].senderId) === String(bob.id) && autoReplyRows[0].content.includes('away'), autoReplyRows);
    await send(alice.token, aliceChat, 'Hello again?');
    autoReplyRows = await Message.find({ chatId: aliceChat, autoReply: true }).lean();
    check('at most one auto-reply per sender per 24 h', autoReplyRows.length === 1, autoReplyRows.length);

    const carolChat = await createDirect(carol.token, bob.id);
    await send(carol.token, carolChat, 'Hi Bob, quick question');
    const carolReplies = await Message.find({ chatId: carolChat, autoReply: true }).lean();
    check('a different sender gets their own auto-reply', carolReplies.length === 1, carolReplies.length);

    // Groups never get auto-replies.
    const groupRes = await api('POST', '/api/chats', { token: alice.token, body: { type: 'group', groupName: `Group ${run}`, participantIds: [bob.id] } });
    const groupId = String(groupRes.body?._id || '');
    if (groupId) await send(alice.token, groupId, 'Group message');
    check('a group message does not trigger an auto-reply', groupId ? (await Message.countDocuments({ chatId: groupId, autoReply: true })) === 0 : true, groupId);

    // Blocking excludes the sender (create the chat first, then block).
    const erinChat2 = await createDirect(erin.token, bob.id);
    await api('POST', `/api/users/${erin.id}/block`, { token: bob.token, body: {} });
    const blockedSend = await send(erin.token, erinChat2, 'Blocked hello');
    check('a blocked sender cannot message and gets no auto-reply', blockedSend.status === 403 && (await Message.countDocuments({ chatId: erinChat2, autoReply: true })) === 0, blockedSend.status);

    // Schedule window (outside-hours uses "Between start and end").
    const daveChat = await createDirect(alice.token, dave.id);
    await api('PUT', '/api/users/me/auto-reply', {
      token: dave.token,
      body: { enabled: true, message: 'Away until later.', schedule: 'outside-hours', startTime: timeAgoOrAhead(120), endTime: timeAgoOrAhead(180), audience: 'everyone' },
    });
    await send(alice.token, daveChat, 'Outside the window');
    check('the auto-reply schedule window is respected (outside -> no reply)', (await Message.countDocuments({ chatId: daveChat, autoReply: true })) === 0, null);
    await api('PUT', '/api/users/me/auto-reply', {
      token: dave.token,
      body: { enabled: true, message: 'Away until later.', schedule: 'outside-hours', startTime: timeAgoOrAhead(-60), endTime: timeAgoOrAhead(60), audience: 'everyone' },
    });
    await send(alice.token, daveChat, 'Inside the window');
    check('the auto-reply fires inside the configured window', (await Message.countDocuments({ chatId: daveChat, autoReply: true })) === 1, null);

    // No loops + AI accounts excluded (helper-level, same database).
    const aliceChatDoc = await Chat.findById(aliceChat).lean();
    const firstAutoReply = await Message.findOne({ chatId: aliceChat, autoReply: true }).lean();
    const logsBefore = await AutoReplyLog.countDocuments();
    const loop = await autoReply.maybeSendAutoReply({ chat: aliceChatDoc, message: firstAutoReply });
    check('an auto-reply message never triggers another auto-reply', loop === null && (await AutoReplyLog.countDocuments()) === logsBefore, loop);
    const aiUser = await User.create({ displayName: `AI Contact ${run}`, phone: `+25076${String(Date.now()).slice(-7)}`, isAiAccount: true, password: 'not-used-123456', authProvider: 'local' });
    const aiAllowed = await autoReply.canAutoReply({
      recipient: await User.findById(bob.id).select('autoReply contacts isAiAccount isSupportAccount').lean(),
      sender: aiUser.toObject(),
      chat: aliceChatDoc,
    });
    check('the AI/bot account is never auto-replied to', aiAllowed === false, aiAllowed);
    await User.deleteOne({ _id: aiUser._id });

    /* ------------------------------------------ disappearing default */
    const defaultDisappearing = await api('GET', '/api/users/me/disappearing-default', { token: frank.token });
    check('disappearing default starts at off', defaultDisappearing.status === 200 && defaultDisappearing.body?.duration === 'off' && defaultDisappearing.body?.seconds === 0, defaultDisappearing.body);
    const invalidDisappearing = await api('PUT', '/api/users/me/disappearing-default', { token: frank.token, body: { duration: '5m' } });
    check('invalid disappearing defaults are rejected', invalidDisappearing.status === 400 && invalidDisappearing.body?.code === 'INVALID_DURATION', invalidDisappearing.body);

    const oldChat = await createDirect(frank.token, gina.id);
    const savedDisappearing = await api('PUT', '/api/users/me/disappearing-default', { token: frank.token, body: { duration: '7d' } });
    check('the disappearing default persists', savedDisappearing.status === 200 && savedDisappearing.body?.duration === '7d' && savedDisappearing.body?.seconds === 604800, savedDisappearing.body);
    const newChat = await createDirect(frank.token, dave.id);
    const newChatSetting = await api('GET', `/api/chats/${newChat}/disappearing`, { token: frank.token });
    check('a new direct chat inherits the creator default', newChatSetting.status === 200 && newChatSetting.body?.disappearing === '7d', newChatSetting.body);
    const oldChatSetting = await api('GET', `/api/chats/${oldChat}/disappearing`, { token: frank.token });
    check('existing chats are not changed', oldChatSetting.body?.disappearing === 'off', oldChatSetting.body);

    const groupByFrank = await api('POST', '/api/chats', { token: frank.token, body: { type: 'group', groupName: `Frank group ${run}`, participantIds: [gina.id] } });
    const frankGroupId = String(groupByFrank.body?._id || '');
    if (frankGroupId) {
      const groupSetting = await api('GET', `/api/chats/${frankGroupId}/disappearing`, { token: frank.token });
      check('groups do not inherit the disappearing default', groupSetting.body?.disappearing === 'off', groupSetting.body);
    }

    const perChat = await api('PUT', `/api/chats/${newChat}/disappearing`, { token: frank.token, body: { duration: '90d' } });
    check('a per-chat disappearing setting can be changed', perChat.status === 200 && perChat.body?.disappearing === '90d', perChat.body);
    const invalidPerChat = await api('PUT', `/api/chats/${newChat}/disappearing`, { token: frank.token, body: { duration: '1h' } });
    check('an invalid per-chat value is rejected', invalidPerChat.status === 400, invalidPerChat.status);

    const sent = await send(frank.token, newChat, 'This should disappear later');
    const sentRow = await Message.findById(sent.body?._id).lean();
    const expectedExpiry = Date.now() + 90 * 24 * 60 * 60 * 1000;
    check('messages in a disappearing chat get an expiresAt', Boolean(sentRow?.expiresAt) && Math.abs(new Date(sentRow.expiresAt).getTime() - expectedExpiry) < 5000, sentRow?.expiresAt);
    const expired = await Message.create({ chatId: newChat, senderId: frank.id, type: 'text', content: 'expired', sentAt: new Date(), expiresAt: new Date(Date.now() - 1000) });
    const listed = await api('GET', `/api/messages?chatId=${newChat}`, { token: frank.token });
    const ids = (listed.body?.messages || []).map((message) => String(message._id));
    check('expired disappearing messages are hidden from readers', !ids.includes(String(expired._id)) && ids.includes(String(sent.body._id)), ids.slice(-5));
    await Message.deleteOne({ _id: expired._id });

    /* -------------------------------------------------------- changelog */
    const changelog = await api('GET', '/api/app/changelog?limit=2');
    check('the changelog is public and returns an entries array', changelog.status === 200 && Array.isArray(changelog.body?.entries) && changelog.body.entries.length === 2, changelog.body);
    check('the changelog is cacheable for 5 minutes', String(changelog.headers.get('cache-control') || '').includes('max-age=300'), changelog.headers.get('cache-control'));
    check('changelog entries have version/platform/releasedAt/notes', changelog.body.entries.every((entry) => typeof entry.version === 'string' && typeof entry.platform === 'string' && 'releasedAt' in entry && typeof entry.notes === 'string'), changelog.body.entries);

    await AppRelease.deleteMany({});
    await AppRelease.create([
      { platform: 'windows', version: '9.9.9', published: true, withdrawn: false, releaseNotes: 'Test published release', releasedAt: new Date(Date.now() + 86400000) },
      { platform: 'android', version: '8.8.8', published: true, withdrawn: true, releaseNotes: 'Test withdrawn release', releasedAt: new Date(Date.now() + 2 * 86400000) },
      { platform: 'web', version: '7.7.7', published: false, withdrawn: false, releaseNotes: 'Test draft release', releasedAt: new Date(Date.now() + 3 * 86400000) },
    ]);
    const full = await api('GET', '/api/app/changelog?limit=50');
    const notes = (full.body?.entries || []).map((entry) => entry.notes);
    check('published releases are included, withdrawn/draft releases are not', notes.includes('Test published release') && !notes.includes('Test withdrawn release') && !notes.includes('Test draft release'), notes);
    check('the newest published release is first', full.body.entries[0]?.version === '9.9.9', full.body.entries[0]);
    const curatedPresent = ['wallpaper', 'voice notes', 'replies', 'remote control', 'screen-share', 'settings', 'account deletion', 'report automation']
      .every((needle) => notes.some((note) => String(note).toLowerCase().includes(needle)));
    check('the curated web-only changelog entries are present', curatedPresent, notes.slice(0, 12));
    const clampedLow = await api('GET', '/api/app/changelog?limit=0');
    check('the limit is clamped to at least 1', clampedLow.body?.entries?.length === 1, clampedLow.body?.entries?.length);
    const clampedHigh = await api('GET', '/api/app/changelog?limit=999');
    check('the limit is clamped to at most 50', Array.isArray(clampedHigh.body?.entries) && clampedHigh.body.entries.length <= 50, clampedHigh.body?.entries?.length);

    await AppRelease.deleteMany({});
  } finally {
    try { app.child.kill('SIGTERM'); } catch { /* ignore */ }
    await new Promise((resolve) => setTimeout(resolve, 800));
    await mongoose.connection.dropDatabase().catch(() => {});
    await new Promise((resolve) => aiStub.close(resolve));
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('personalization test crashed:', String((error && error.stack) || error).slice(0, 1500));
  process.exit(1);
});
