/**
 * Group "@Chatgram AI" mentions (Change 1 + the Oct-26 production fix) —
 * integration against the local STAGING API.
 *
 * The staging server must be running (scripts/start-staging.ps1). A local
 * OpenAI-compatible mock provider is configured through the real admin API, so
 * the full stack is exercised: REST message -> mention hook -> queue -> provider
 * -> stored group reply(s) -> notices -> metrics -> Admin Inbox on total failure.
 *
 *   node server/test/integration/groupAiMentions.test.js
 *
 * Environment (defaults are the local staging values):
 *   E2E_API_URL   http://127.0.0.1:5000
 *   MONGODB_URI   mongodb://127.0.0.1:27017/chatgram_staging
 *   GROUP_AI_MOCK_PORT 5099 (must be in the staging AI_ALLOWED_LOCAL_HOSTS)
 */
const http = require('http');
const mongoose = require('mongoose');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const MOCK_PORT = Number(process.env.GROUP_AI_MOCK_PORT || 5099);
const run = Date.now().toString(36);
const mute = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const HINT = 'Want more detail? Reply to this message.';

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ` -> ${JSON.stringify(detail).slice(0, 240)}` : ''}`);
  }
}

/* ------------------------------------------------------------ mock provider */

const providerRequests = [];

function longTable() {
  const rows = ['| # | Subnet | First usable | Last usable |', '|---|---|---|---|'];
  for (let index = 1; index <= 40; index += 1) {
    rows.push(`| ${index} | 10.${index}.0.0/24 | 10.${index}.0.1 | 10.${index}.0.254 |`);
  }
  rows.push('', 'All subnets have 254 usable hosts. Want the next step?');
  return rows.join('\n');
}

function cutTable() {
  return [
    'Sure! Splitting 192.168.1.0/24 into four /26 subnets:',
    '',
    '| # | Subnet | First | Last |',
    '|---|---|---|---|',
    '| 1 | 192.168.1.0/26 | 192.168.1.1 | 192.168.1.62 |',
    '| 2 | 192.168.1.64/26 | 192.168.1.65 | 192.168.1.126 |',
    '| 3 | 192.168.1.128/26 | 192.168.1.129 | 192.168.1.190 |',
    '| 4 | 192.168.1.192/26 | 192.168.1.193 | 192.168.1.254 |',
    '| 5 | 192.168',
  ].join('\n');
}

function answerFor(question) {
  if (/SPLIT_TABLE/i.test(question)) return { text: longTable(), finish: 'stop' };
  if (/TRUNCATE/i.test(question)) return { text: cutTable(), finish: 'length' };
  if (/elite|omniscient/i.test(question)) return { text: 'I can help with that. What is your first question?', finish: 'stop' };
  return { text: `Echo: ${question}`, finish: 'stop' };
}

function startMock() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        let body = {};
        try {
          body = JSON.parse(raw || '{}');
        } catch {
          body = {};
        }
        const path = String(req.url || '');
        const users = (Array.isArray(body.messages) ? body.messages : [])
          .filter((message) => message?.role === 'user')
          .map((message) => String(message.content || ''));
        const system = (Array.isArray(body.messages) ? body.messages : [])
          .filter((message) => message?.role === 'system')
          .map((message) => String(message.content || ''))
          .join('\n');

        if (path.startsWith('/fail')) {
          providerRequests.push({ at: Date.now(), path: '/fail', users, system });
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'mock primary rate limited (429)' } }));
          return;
        }
        if (!path.includes('/chat/completions')) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not found' }));
          return;
        }
        providerRequests.push({ at: Date.now(), path: '/v1', users, system });
        const answer = answerFor(users[users.length - 1] || '');
        if (!body.stream) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: answer.text }, finish_reason: answer.finish }] }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const pieces = answer.text.match(/[\s\S]{1,60}/g) || [answer.text];
        for (const piece of pieces) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: answer.finish }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    server.on('error', reject);
    server.listen(MOCK_PORT, '127.0.0.1', () => resolve(server));
  });
}

/* --------------------------------------------------------------- REST helper */

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
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, body: payload, text };
}

async function register(label) {
  const identifier = `e2e-groupai-${label}-${run}@chatgram.test`;
  const password = 'GroupAiPass1!';
  const result = await api('POST', '/api/auth/register', {
    body: { displayName: `E2E GROUP AI ${label} ${run}`, identifier, password },
  });
  if (result.status !== 201) throw new Error(`register ${label}: ${result.status} ${JSON.stringify(result.body).slice(0, 200)}`);
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

async function configureProvider(headers, { key, basePath, label }) {
  const saved = await fetch(`${API}/api/admin/providers/${key}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      key,
      provider: 'custom',
      label,
      model: 'mock-group-1',
      baseUrl: `http://127.0.0.1:${MOCK_PORT}${basePath}`,
      apiKey: 'e2e-not-a-real-key',
      enabled: true,
      timeoutMs: 15000,
    }),
  });
  if (!saved.ok) throw new Error(`provider save ${key}: ${saved.status} ${await saved.text()}`);
}

async function routeFeature(headers, primary, fallbacks = []) {
  const routed = await fetch(`${API}/api/admin/providers/features`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ features: { chatgramAI: { primary, fallbacks } } }),
  });
  if (!routed.ok) throw new Error(`provider route: ${routed.status} ${await routed.text()}`);
}

async function setPolicy(headers, patch) {
  const response = await fetch(`${API}/api/admin/ai/policy`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(`policy update: ${response.status} ${await response.text()}`);
  return (await response.json()).policy;
}

const SAFE_POLICY = {
  groupMinGapMs: 0,
  groupNoticeCooldownMs: 0,
  groupUserHourlyLimit: 100,
  groupChatHourlyLimit: 200,
  groupQueueLimit: 5,
  groupMaxInputChars: 2000,
  groupMaxOutputTokens: 1200,
  blockedTopics: [],
};

async function createGroup(token, name, extraParticipantId) {
  const body = { type: 'group', groupName: name, participantIds: extraParticipantId ? [extraParticipantId] : [] };
  const result = await api('POST', '/api/chats', { token, body });
  if (result.status !== 201) throw new Error(`group create: ${result.status} ${JSON.stringify(result.body).slice(0, 200)}`);
  const chatId = String(result.body._id || result.body.id);
  const toggled = await api('PATCH', `/api/chats/${chatId}`, { token, body: { groupSettings: { aiMentions: true } } });
  if (toggled.status !== 200) throw new Error(`group toggle: ${toggled.status} ${JSON.stringify(toggled.body).slice(0, 200)}`);
  return chatId;
}

async function sendMention(account, chatId, text) {
  return api('POST', '/api/messages', { token: account.accessToken, body: { chatId, type: 'text', content: text } });
}

async function aiMessages(token, chatId) {
  const result = await api('GET', `/api/messages?chatId=${chatId}&limit=200`, { token });
  const rows = Array.isArray(result.body) ? result.body : result.body?.messages || [];
  return rows
    .filter((row) => (row.senderId?.displayName || row.sender?.displayName || '') === 'Chatgram AI')
    .sort((left, right) => new Date(left.sentAt || left.createdAt) - new Date(right.sentAt || right.createdAt));
}

async function waitForAi(token, chatId, predicate, { timeoutMs = 15000, interval = 250 } = {}) {
  const started = Date.now();
  let rows = [];
  while (Date.now() - started < timeoutMs) {
    rows = await aiMessages(token, chatId);
    if (predicate(rows)) return rows;
    await mute(interval);
  }
  return rows;
}

async function countAi(token, chatId) {
  return (await aiMessages(token, chatId)).length;
}

function textOf(row) {
  return String(row?.content || '');
}

/* ------------------------------------------------------------------- main */

async function main() {
  console.log('\ngroup @Chatgram AI mentions\n');
  process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging';
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection.db;
  const testStartedAt = new Date();
  // Snapshot the AI policy so the test can put the DB back exactly as it was.
  const settingsBefore = await db.collection('aisettings').findOne({ key: 'global' });
  const policyBefore = settingsBefore?.aiPolicy;

  let mock;
  try {
    mock = await startMock();
  } catch (error) {
    console.error(`Could not start the mock provider on 127.0.0.1:${MOCK_PORT}:`, error.message);
    process.exit(1);
  }

  const created = { chats: [], users: [] };
  let admin;
  try {
    admin = await adminHeaders();
    await configureProvider(admin, { key: 'e2e-group-ai', basePath: '/v1', label: 'E2E group AI' });
    await configureProvider(admin, { key: 'e2e-group-ai-fail', basePath: '/fail/v1', label: 'E2E group AI fail' });
    await routeFeature(admin, 'e2e-group-ai');
    await setPolicy(admin, SAFE_POLICY);

    const owner = await register('owner');
    const alice = await register('alice');
    const bob = await register('bob');
    const carol = await register('carol');
    const dave = await register('dave');
    for (const account of [owner, alice, bob, carol, dave]) created.users.push(account.user.id);

    // ---- 1. off by default -------------------------------------------------
    const g1 = await api('POST', '/api/chats', {
      token: owner.accessToken,
      body: { type: 'group', groupName: `E2E OFF ${run}`, participantIds: [alice.user.id] },
    });
    const offChat = String(g1.body._id || g1.body.id);
    created.chats.push(offChat);
    const offMention = await sendMention(alice, offChat, '@Chatgram AI hello while off');
    await mute(2500);
    check('mention request accepted while the toggle is off', offMention.status === 201, offMention.status);
    check('toggle off: no AI reply', (await countAi(alice.accessToken, offChat)) === 0);
    await api('PATCH', `/api/chats/${offChat}`, { token: owner.accessToken, body: { groupSettings: { aiMentions: true } } });

    // ---- 2. aliases + exactly one response per mention ---------------------
    const g2 = await createGroup(owner.accessToken, `E2E ALIAS ${run}`, alice.user.id);
    created.chats.push(g2);
    const aliasMentions = ['@chatgramai ALIAS_ONE', '@chatgram ALIAS_TWO', '@Chatgram AI ALIAS_THREE', '@CHATGRAMAI, ALIAS_FOUR'];
    for (let index = 0; index < aliasMentions.length; index += 1) {
      const sent = await sendMention(alice, g2, aliasMentions[index]);
      check(`alias mention ${index + 1} accepted`, sent.status === 201, sent.status);
      await waitForAi(alice.accessToken, g2, (rows) => rows.length >= index + 1);
    }
    const aliasReplies = await aiMessages(alice.accessToken, g2);
    check('every alias produced exactly one visible answer', aliasReplies.length === aliasMentions.length, aliasReplies.length);
    check(
      'answers are addressed to the asker',
      aliasReplies.every((row) => textOf(row).startsWith('@E2E,') || textOf(row).startsWith('@E2E ')),
      aliasReplies.map((row) => textOf(row).slice(0, 20)),
    );
    check(
      'aliases were answered in order',
      ['ALIAS_ONE', 'ALIAS_TWO', 'ALIAS_THREE', 'ALIAS_FOUR'].every((marker, index) => textOf(aliasReplies[index]).includes(marker)),
      aliasReplies.map((row) => textOf(row).slice(0, 40)),
    );

    // ---- 3. queue: 3 rapid mentions answered in order ----------------------
    const g3 = await createGroup(owner.accessToken, `E2E QUEUE ${run}`, alice.user.id);
    created.chats.push(g3);
    for (const marker of ['QUEUE_ONE', 'QUEUE_TWO', 'QUEUE_THREE']) {
      await sendMention(alice, g3, `@chatgramai ${marker}`);
      await mute(40);
    }
    const queueReplies = await waitForAi(alice.accessToken, g3, (rows) => rows.length >= 3, { timeoutMs: 20000 });
    check('3 rapid mentions produced 3 answers', queueReplies.length === 3, queueReplies.length);
    check(
      'queued answers are in arrival order',
      ['QUEUE_ONE', 'QUEUE_TWO', 'QUEUE_THREE'].every((marker, index) => textOf(queueReplies[index]).includes(marker)),
      queueReplies.map((row) => textOf(row).slice(0, 40)),
    );

    // ---- 4. per-user hourly limit -> polite notice, not silence ------------
    const g4 = await createGroup(owner.accessToken, `E2E USER LIMIT ${run}`, carol.user.id);
    created.chats.push(g4);
    await setPolicy(admin, { groupUserHourlyLimit: 1 });
    await sendMention(carol, g4, '@chatgramai USER_LIMIT_FIRST');
    await waitForAi(carol.accessToken, g4, (rows) => rows.length >= 1);
    await sendMention(carol, g4, '@chatgramai USER_LIMIT_SECOND');
    const userLimitReplies = await waitForAi(carol.accessToken, g4, (rows) => rows.length >= 2, { timeoutMs: 8000 });
    check('per-user limit: the second mention is answered with a notice', userLimitReplies.length === 2, userLimitReplies.length);
    check(
      'the per-user notice is polite and visible',
      /reply limit/i.test(textOf(userLimitReplies[1] || {})),
      textOf(userLimitReplies[1] || {}).slice(0, 120),
    );
    await setPolicy(admin, { groupUserHourlyLimit: 100 });

    // ---- 5. too long -> notice, provider is not called ---------------------
    const g5 = await createGroup(owner.accessToken, `E2E TOO LONG ${run}`, alice.user.id);
    created.chats.push(g5);
    await setPolicy(admin, { groupMaxInputChars: 100 });
    const requestsBefore = providerRequests.length;
    await sendMention(alice, g5, `@chatgramai ${'x'.repeat(300)}`);
    const tooLongReplies = await waitForAi(alice.accessToken, g5, (rows) => rows.length >= 1, { timeoutMs: 8000 });
    check('too-long mention gets a notice', tooLongReplies.length >= 1);
    check('the notice names the limit', /too long/i.test(textOf(tooLongReplies[0] || {})) && /100 characters/.test(textOf(tooLongReplies[0] || {})), textOf(tooLongReplies[0] || {}).slice(0, 160));
    check('a too-long mention never reaches the provider', providerRequests.length === requestsBefore, providerRequests.length - requestsBefore);
    await setPolicy(admin, { groupMaxInputChars: 2000 });

    // ---- 6. long persona prompt is answered --------------------------------
    const g6 = await createGroup(owner.accessToken, `E2E PERSONA ${run}`, alice.user.id);
    created.chats.push(g6);
    const persona = `You are an elite, omniscient AI research assistant and problem-solver. ${'Follow every instruction exactly. '.repeat(50)} PERSONA_TEST`;
    check('the persona prompt is under the 2000-char group limit', persona.length < 2000 && persona.length > 1400, persona.length);
    await sendMention(alice, g6, `@chatgramai ${persona}`);
    const personaReplies = await waitForAi(alice.accessToken, g6, (rows) => rows.length >= 1, { timeoutMs: 12000 });
    check('a 1500+ char persona prompt is answered (not ignored)', personaReplies.length >= 1, personaReplies.length);
    check('the persona answer is not a "too long" refusal', !/too long/i.test(textOf(personaReplies[0] || {})), textOf(personaReplies[0] || {}).slice(0, 120));

    // ---- 7. long answer split into 2-3 messages, table intact ---------------
    const g7 = await createGroup(owner.accessToken, `E2E SPLIT ${run}`, alice.user.id);
    created.chats.push(g7);
    await sendMention(alice, g7, '@chatgramai SPLIT_TABLE subnetting plan');
    const splitReplies = await waitForAi(alice.accessToken, g7, (rows) => rows.length >= 2, { timeoutMs: 15000 });
    check('a long answer is split into 2-3 messages', splitReplies.length >= 2 && splitReplies.length <= 3, splitReplies.length);
    check('split messages carry 1/n labels', /\(1\/\d\)/.test(textOf(splitReplies[0] || {})), textOf(splitReplies[0] || {}).slice(0, 40));
    const joined = splitReplies.map(textOf).join('\n');
    check('the split keeps the whole table', joined.includes('| 40 | 10.40.0.0/24 |') && joined.includes('All subnets have 254 usable hosts'), joined.slice(-120));
    let brokenTableLines = 0;
    for (const row of splitReplies) {
      for (const line of textOf(row).split('\n')) {
        if (line.trim().startsWith('|') && !line.trim().endsWith('|')) brokenTableLines += 1;
      }
    }
    check('no table row is cut across a split boundary', brokenTableLines === 0, brokenTableLines);

    // ---- 8. truncated answer gets the "want more detail" hint --------------
    const g8 = await createGroup(owner.accessToken, `E2E TRUNCATE ${run}`, alice.user.id);
    created.chats.push(g8);
    await sendMention(alice, g8, '@chatgramai TRUNCATE the subnetting table');
    const truncReplies = await waitForAi(alice.accessToken, g8, (rows) => rows.length >= 1, { timeoutMs: 10000 });
    check('a truncated answer is still posted (not silent)', truncReplies.length >= 1, truncReplies.length);
    check('the truncated answer carries the detail hint', textOf(truncReplies[truncReplies.length - 1] || {}).includes(HINT), textOf(truncReplies[truncReplies.length - 1] || {}).slice(-160));

    // ---- 9. 429 primary -> fallback provider answers -----------------------
    const g9 = await createGroup(owner.accessToken, `E2E FALLBACK ${run}`, bob.user.id);
    created.chats.push(g9);
    await routeFeature(admin, 'e2e-group-ai-fail', ['e2e-group-ai']);
    const failsBefore = providerRequests.filter((row) => row.path === '/fail').length;
    const goodsBefore = providerRequests.filter((row) => row.path === '/v1').length;
    await sendMention(bob, g9, '@chatgramai FALLBACK_TEST are you there?');
    const fallbackReplies = await waitForAi(bob.accessToken, g9, (rows) => rows.length >= 1, { timeoutMs: 12000 });
    check('a 429 primary falls back to the next provider (answer posted)', fallbackReplies.length >= 1, fallbackReplies.length);
    check('the fallback answer is the real answer, not the trouble notice', /Echo: FALLBACK_TEST/i.test(textOf(fallbackReplies[0] || {})), textOf(fallbackReplies[0] || {}).slice(0, 120));
    check('the failing provider was tried first', providerRequests.filter((row) => row.path === '/fail').length > failsBefore);
    check('the fallback provider was used', providerRequests.filter((row) => row.path === '/v1').length > goodsBefore);

    // ---- 10. all providers fail -> polite notice + Admin Inbox record ------
    const g10 = await createGroup(owner.accessToken, `E2E ALLFAIL ${run}`, bob.user.id);
    created.chats.push(g10);
    await routeFeature(admin, 'e2e-group-ai-fail', []);
    await sendMention(bob, g10, '@chatgramai ALL_PROVIDERS_FAIL please answer');
    const failReplies = await waitForAi(bob.accessToken, g10, (rows) => rows.length >= 1, { timeoutMs: 12000 });
    check('all providers failed: a polite notice is posted (not silence)', failReplies.length >= 1, failReplies.length);
    check('the notice is the "trouble reaching my AI provider" text', /trouble reaching my ai provider/i.test(textOf(failReplies[0] || {})), textOf(failReplies[0] || {}).slice(0, 140));
    const inboxFailure = await db.collection('admininboxes').findOne({ type: 'group_ai_failure', createdAt: { $gte: testStartedAt } });
    check('the all-providers-failed case is recorded in the Admin Inbox', Boolean(inboxFailure), inboxFailure?.type);
    await routeFeature(admin, 'e2e-group-ai');

    // ---- 11. notices are rate limited to 1/user/minute ---------------------
    const g11 = await createGroup(owner.accessToken, `E2E NOTICE LIMIT ${run}`, dave.user.id);
    created.chats.push(g11);
    await setPolicy(admin, { groupNoticeCooldownMs: 60000, groupMaxInputChars: 100 });
    await sendMention(dave, g11, `@chatgramai ${'n'.repeat(300)}`);
    await waitForAi(dave.accessToken, g11, (rows) => rows.length >= 1, { timeoutMs: 8000 });
    await sendMention(dave, g11, `@chatgramai ${'n'.repeat(320)}`);
    await mute(2500);
    const noticeReplies = await aiMessages(dave.accessToken, g11);
    check('repeated notices are rate limited to one per user per minute', noticeReplies.length === 1, noticeReplies.length);
    await setPolicy(admin, { groupNoticeCooldownMs: 0, groupMaxInputChars: 2000 });

    // ---- 12. no group history is sent to the provider ----------------------
    const g12 = await createGroup(owner.accessToken, `E2E CONTEXT ${run}`, alice.user.id);
    created.chats.push(g12);
    await sendMention(alice, g12, 'SECRET_GROUP_CHATTER should never reach the model');
    await mute(600);
    const contextRequestsBefore = providerRequests.length;
    await sendMention(alice, g12, '@chatgramai CONTEXT_TEST what is a subnet mask?');
    await waitForAi(alice.accessToken, g12, (rows) => rows.some((row) => /Echo: CONTEXT_TEST/i.test(textOf(row))), { timeoutMs: 12000 });
    const contextRequest = providerRequests.slice(contextRequestsBefore).find((row) => row.users.some((text) => /CONTEXT_TEST/.test(text)));
    check('the mention was sent to the provider', Boolean(contextRequest));
    check(
      'only the asking message is sent (no group history)',
      Boolean(contextRequest) && contextRequest.users.length === 1 && !contextRequest.users[0].includes('SECRET_GROUP_CHATTER'),
      contextRequest?.users,
    );
    check(
      'the system prompt carries the safety rules',
      Boolean(contextRequest) && /SYSTEM RULES/i.test(contextRequest.system) && /role-play/i.test(contextRequest.system),
      contextRequest?.system?.slice(0, 80),
    );

    // ---- 13. AI account is not a people-search result ----------------------
    const search = await api('GET', '/api/users/search?query=Chatgram', { token: alice.accessToken });
    const rows = Array.isArray(search.body) ? search.body : search.body?.users || [];
    check('Chatgram AI is not searchable as a person', rows.filter((row) => (row.displayName || '') === 'Chatgram AI').length === 0);

    // ---- 14. the admin usage API exposes group metrics ---------------------
    const usage = await fetch(`${API}/api/admin/ai/usage?days=1`, { headers: admin });
    const usageBody = await usage.json();
    check('admin AI usage returns group mention metrics', usage.status === 200 && Boolean(usageBody.groupMentions) && typeof usageBody.groupMentions.last24h.answered === 'number', { status: usage.status });

    // ---- 15. turning the toggle off stops replies --------------------------
    await api('PATCH', `/api/chats/${g12}`, { token: owner.accessToken, body: { groupSettings: { aiMentions: false } } });
    const beforeOff = await countAi(alice.accessToken, g12);
    const turnedOff = await sendMention(alice, g12, '@chatgramai are you still there?');
    await mute(2500);
    const afterOff = await countAi(alice.accessToken, g12);
    check('turning the toggle off stops new replies', turnedOff.status === 201 && afterOff === beforeOff, { beforeOff, afterOff });
  } finally {
    // Cleanup: exact ids created by this run only. The Chatgram AI account is a
    // shared system account and is kept.
    if (admin) {
      await routeFeature(admin, 'e2e-group-ai').catch(() => {});
      for (const key of ['e2e-group-ai', 'e2e-group-ai-fail']) {
        await fetch(`${API}/api/admin/providers/${key}`, { method: 'DELETE', headers: admin }).catch(() => {});
      }
      // Restore the exact AI policy snapshot (unset it when there was none) so
      // the DB is left the way the next test expects.
      if (policyBefore === undefined) {
        await db.collection('aisettings').updateOne({ key: 'global' }, { $unset: { aiPolicy: '' } }).catch(() => {});
      } else {
        await db.collection('aisettings').updateOne({ key: 'global' }, { $set: { aiPolicy: policyBefore } }).catch(() => {});
      }
    }
    const chatIds = created.chats.map((id) => new mongoose.Types.ObjectId(String(id)));
    const userIds = created.users.map((id) => new mongoose.Types.ObjectId(String(id)));
    await db.collection('messages').deleteMany({ chatId: { $in: chatIds } });
    await db.collection('chats').deleteMany({ _id: { $in: chatIds } });
    await db.collection('groupaievents').deleteMany({ $or: [{ chatId: { $in: chatIds } }, { askerId: { $in: userIds } }] });
    await db.collection('admininboxes').deleteMany({ type: 'group_ai_failure', createdAt: { $gte: testStartedAt } });
    await db.collection('users').deleteMany({ _id: { $in: userIds } });
    await mongoose.disconnect();
    await new Promise((resolve) => mock.close(resolve));
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', String((error && error.stack) || error).slice(0, 1200));
  process.exit(1);
});
