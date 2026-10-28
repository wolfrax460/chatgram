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
const reportsModule = require('../../src/ai/reports');
const reportTelegramModule = require('../../src/support/reportTelegram');

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
  // 1A report integration: the model emits the hidden report action the server
  // executes. The title carries the run id so duplicates merge into one row.
  if (/REPORT_BUG/i.test(question)) {
    const directive = JSON.stringify({
      type: 'bug_report',
      title: `E2E report bug ${run}`,
      summary: 'Group calls end by themselves after about 10 seconds. The reporter tried twice.',
      includeConversation: false,
    });
    return { text: `Okay, I'll pass that on.\n\n[[CHATGRAM_REPORT]]\n${directive}\n[[/CHATGRAM_REPORT]]`, finish: 'stop' };
  }
  // A claim with NO action block: the server must rewrite it honestly.
  if (/CLAIM_ONLY/i.test(question)) return { text: "I've forwarded your request to the development team.", finish: 'stop' };
  return { text: `Echo: ${question}`, finish: 'stop' };
}

// The fix-prompt generator's second admin-side AI call (server/src/ai/fixPrompt.js)
// gets a structured JSON answer from this mock, so the report stores promptSource='ai'.
const FIX_PROMPT_MOCK = JSON.stringify({
  goal: 'Make the group call reporting flow work end to end',
  featureArea: 'Chatgram AI reports, mentions and the admin Inbox',
  observed: 'The report flow lost the reference in the reply.',
  expected: 'Every explicit report creates one Inbox row and the reply carries its reference.',
  steps: [
    'Mention @Chatgram AI in a group with an explicit report request.',
    'Check the Admin Inbox row and the reply reference.',
  ],
  likelyFiles: ['server/src/ai/reports.js', 'server/src/ai/fixPrompt.js'],
  acceptanceCriteria: ['One AdminInbox row is created and the reply contains its RPT reference.'],
  needsClarification: [],
  confidence: 0.86,
});


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
        // Fix-prompt generator call (non-stream, JSON answer expected).
        if (/fix prompts for a coding assistant/i.test(system)) {
          providerRequests.push({ at: Date.now(), path: '/v1-fixprompt', users, system });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: FIX_PROMPT_MOCK }, finish_reason: 'stop' }] }));
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

  const created = { chats: [], users: [], reports: [] };
  // The built-in assistant account used by the "add Chatgram AI to a group" flow.
  const aiAccount = require('../../src/utils/aiAccount');
  const aiId = await aiAccount.ensureAiUser();
  // Snapshot the Telegram module functions: some notifier assertions run in this
  // process (the staging API has no bot token, so its real send is skipped and
  // not observable from here), and they are restored in the finally block.
  const savedTelegram = { sendReport: reportTelegramModule.sendReport, isEnabled: reportTelegramModule.isEnabled };
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

    // ---- 1b. adding the Chatgram AI member opts the group in ----------------
    // The "add the assistant as a member" flow must be the opt-in: a group that
    // shows "added Chatgram AI" and still has aiMentions=false silently drops
    // every mention as feature_off (the reported production regression).
    check('the Chatgram AI account exists', Boolean(aiId), aiId);
    const aiMemberGroup = await api('POST', '/api/chats', {
      token: owner.accessToken,
      body: { type: 'group', groupName: `E2E AI MEMBER ${run}`, participantIds: [alice.user.id] },
    });
    check('a group can be created without enabling AI mentions', aiMemberGroup.status === 201 && aiMemberGroup.body?.groupSettings?.aiMentions !== true, aiMemberGroup.status);
    const aiMemberChat = String(aiMemberGroup.body._id || aiMemberGroup.body.id);
    created.chats.push(aiMemberChat);

    const addAiMember = await api('POST', `/api/chats/${aiMemberChat}/participants`, {
      token: owner.accessToken,
      body: { participantIds: [String(aiId)] },
    });
    check('adding the Chatgram AI account as a member succeeds', addAiMember.status === 200, addAiMember.status);
    const settingsAfterAdd = (await api('GET', `/api/chats/${aiMemberChat}`, { token: owner.accessToken })).body?.groupSettings;
    check('adding the Chatgram AI member enables AI mention replies', settingsAfterAdd?.aiMentions === true, settingsAfterAdd);

    const memberMention = await sendMention(alice, aiMemberChat, '@Chatgram AI AI_MEMBER_TEST explain DNS briefly');
    check('the mention in the AI-member group is accepted', memberMention.status === 201, memberMention.status);
    const memberReplies = await waitForAi(
      alice.accessToken,
      aiMemberChat,
      (rows) => rows.some((row) => /AI_MEMBER_TEST/.test(textOf(row))),
      { timeoutMs: 15000 },
    );
    check('a group with the Chatgram AI member answers a mention (no manual toggle)', memberReplies.length >= 1, memberReplies.length);

    // Removing the AI member must opt the group out again: otherwise the
    // mention path silently re-adds the account and keeps answering.
    const removeAiMember = await api('DELETE', `/api/chats/${aiMemberChat}/participants/${String(aiId)}`, { token: owner.accessToken });
    check('removing the Chatgram AI member succeeds', removeAiMember.status === 200, removeAiMember.status);
    const settingsAfterRemove = (await api('GET', `/api/chats/${aiMemberChat}`, { token: owner.accessToken })).body?.groupSettings;
    check('removing the Chatgram AI member disables AI mention replies', settingsAfterRemove?.aiMentions === false, settingsAfterRemove);
    const repliesAfterRemove = await countAi(alice.accessToken, aiMemberChat);
    await sendMention(alice, aiMemberChat, '@Chatgram AI AFTER_REMOVE should not answer');
    await mute(2500);
    check(
      'a mention after the AI member was removed neither answers nor re-adds it',
      (await countAi(alice.accessToken, aiMemberChat)) === repliesAfterRemove,
      repliesAfterRemove,
    );

    // Creating a group with the AI account already in the member list opts in too.
    const groupCreatedWithAi = await api('POST', '/api/chats', {
      token: owner.accessToken,
      body: { type: 'group', groupName: `E2E AI CREATE ${run}`, participantIds: [alice.user.id, String(aiId)] },
    });
    const chatCreatedWithAi = String(groupCreatedWithAi.body._id || groupCreatedWithAi.body.id);
    created.chats.push(chatCreatedWithAi);
    check('creating a group with the Chatgram AI member enables AI mention replies', groupCreatedWithAi.status === 201 && groupCreatedWithAi.body?.groupSettings?.aiMentions === true, groupCreatedWithAi.body?.groupSettings);

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
    // ---- 16. 1A real reports: one record, reference in the reply, duplicates ----
    const reportGroup = await createGroup(owner.accessToken, `E2E REPORT ${run}`, alice.user.id);
    created.chats.push(reportGroup);
    const reportTitle = `E2E report bug ${run}`;
    const reportMention = await sendMention(alice, reportGroup, '@chatgramai REPORT_BUG the group call keeps ending, please tell the admin');
    check('the explicit report mention is accepted', reportMention.status === 201, reportMention.status);
    const firstReportReplies = await waitForAi(
      alice.accessToken,
      reportGroup,
      (rows) => rows.some((row) => /RPT-[A-Z0-9]{4}/.test(textOf(row))),
      { timeoutMs: 20000 },
    );
    const firstReportReply = firstReportReplies.find((row) => /RPT-[A-Z0-9]{4}/.test(textOf(row)));
    let reportRows = await db.collection('admininboxes').find({ title: reportTitle }).toArray();
    const reportRecord = reportRows[0] || {};
    if (reportRecord._id) created.reports.push(reportRecord._id);
    check('an explicit report creates exactly ONE AdminInbox record', reportRows.length === 1, reportRows.length);
    check(
      'the report record carries type, source, asker, exact words and a reference',
      reportRecord.type === 'bug_report' &&
        String(reportRecord.source || '').includes(`E2E REPORT ${run}`) &&
        String(reportRecord.askerName || '').includes('alice') &&
        /REPORT_BUG/i.test(String(reportRecord.userText || '')) &&
        /^RPT-[A-Z0-9]{4}$/.test(String(reportRecord.ref || '')),
      { type: reportRecord.type, source: reportRecord.source, askerName: reportRecord.askerName },
    );
    check(
      'the user-visible reply contains the record reference',
      Boolean(firstReportReply) && textOf(firstReportReply).includes(reportRecord.ref),
      textOf(firstReportReply || {}).slice(0, 160),
    );
    check(
      'the report reply never keeps a false forwarding/notified claim',
      !/forwarded|notified/i.test(textOf(firstReportReply || {})),
      textOf(firstReportReply || {}).slice(0, 160),
    );
    check(
      'the stored fix prompt has every required section',
      ['Goal:', 'Context:', 'Observed behaviour', 'Expected behaviour:', 'Steps to reproduce:', 'Likely files or modules', 'Acceptance criteria:', 'Constraints:'].every((section) =>
        String(reportRecord.fixPrompt || '').includes(section),
      ),
      Object.keys(reportRecord).length,
    );
    check('the fix prompt was written by the admin AI call', reportRecord.fixPromptSource === 'ai', reportRecord.fixPromptSource);
    check(
      'the fix prompt is specific and grounded (files + steps, no old filler)',
      /server\/src\/ai\/reports\.js/.test(String(reportRecord.fixPrompt || '')) &&
        /Mention @Chatgram AI in a group/i.test(String(reportRecord.fixPrompt || '')) &&
        !/Open Chatgram and reproduce the reported flow/i.test(String(reportRecord.fixPrompt || '')),
      String(reportRecord.fixPrompt || '').slice(0, 120),
    );

    // A duplicate explicit report merges and increments the same row.
    await sendMention(alice, reportGroup, '@chatgramai REPORT_BUG the group call keeps ending again');
    await waitForAi(alice.accessToken, reportGroup, (rows) => rows.some((row) => /existing Chatgram team report/.test(textOf(row))), { timeoutMs: 20000 });
    reportRows = await db.collection('admininboxes').find({ title: reportTitle }).toArray();
    check(
      'a duplicate report increments the same record instead of creating another',
      reportRows.length === 1 && Number(reportRows[0].count) === 2,
      { rows: reportRows.length, count: reportRows[0]?.count },
    );
    const mergeReply = (await aiMessages(alice.accessToken, reportGroup)).find((row) => /existing Chatgram team report/.test(textOf(row)));
    check(
      'the duplicate reply still carries the reference',
      Boolean(mergeReply) && textOf(mergeReply).includes(reportRecord.ref),
      textOf(mergeReply || {}).slice(0, 160),
    );

    // A claim without a hidden action is rewritten honestly and creates no record.
    const claimBefore = await countAi(alice.accessToken, reportGroup);
    await sendMention(alice, reportGroup, '@chatgramai CLAIM_ONLY this should not be reported');
    const claimReplies = await waitForAi(alice.accessToken, reportGroup, (rows) => rows.length > claimBefore, { timeoutMs: 15000 });
    const claimReply = claimReplies[claimReplies.length - 1] || {};
    check(
      'a claim with no action is rewritten honestly (no AdminInbox record either)',
      !/forwarded/i.test(textOf(claimReply)) && /can't send that to the Chatgram team|email/i.test(textOf(claimReply)),
      textOf(claimReply).slice(0, 160),
    );
    const claimRows = await db.collection('admininboxes').find({ title: new RegExp(run), createdAt: { $gte: testStartedAt } }).toArray();
    check('the claim-only answer created no extra report row', claimRows.length === 1, claimRows.length);

    // ---- Telegram notifier: invoked once, honest on failure --------------------
    reportTelegramModule.isEnabled = async () => true;
    let notifierCalls = 0;
    reportTelegramModule.sendReport = async () => {
      notifierCalls += 1;
      return { ok: true, messageId: 4242 };
    };
    const notifiedReport = await reportsModule.handleModelReport({
      text: `[[CHATGRAM_REPORT]]${JSON.stringify({ type: 'bug_report', title: `E2E notifier ${run}`, summary: 'The notifier should be called exactly once.' })}[[/CHATGRAM_REPORT]]`,
      context: {
        userText: 'please report this notifier test',
        source: 'AI chat',
        askerId: alice.user.id,
        askerName: alice.user.displayName,
        fixPromptChat: async () => ({ text: FIX_PROMPT_MOCK }),
      },
    });
    if (notifiedReport.report?._id) created.reports.push(notifiedReport.report._id);
    check('the Telegram notifier is invoked exactly once per report', notifierCalls === 1 && notifiedReport.notified === true, { notifierCalls });
    check('a delivered report says it was sent', /I've sent this to the Chatgram team/i.test(notifiedReport.text || ''), notifiedReport.text);

    reportTelegramModule.sendReport = async () => {
      notifierCalls += 1;
      return { ok: false, skipped: false, error: 'telegram unreachable' };
    };
    const failedReport = await reportsModule.handleModelReport({
      text: `[[CHATGRAM_REPORT]]${JSON.stringify({ type: 'bug_report', title: `E2E notifier fail ${run}`, summary: 'The notifier should fail.' })}[[/CHATGRAM_REPORT]]`,
      context: {
        userText: 'please report this failing notifier test',
        source: 'AI chat',
        askerId: alice.user.id,
        askerName: alice.user.displayName,
        fixPromptChat: async () => ({ text: FIX_PROMPT_MOCK }),
      },
    });
    if (failedReport.report?._id) created.reports.push(failedReport.report._id);
    check('a notification failure still keeps the record', failedReport.created === true && Boolean(failedReport.ref));
    check(
      'a notification failure never claims it was sent',
      /RPT-[A-Z0-9]{4}/.test(failedReport.text || '') &&
        !/I've sent this to the Chatgram team/i.test(failedReport.text || '') &&
        /couldn't send the alert|couldn’t send/i.test(failedReport.text || ''),
      failedReport.text,
    );

    // ---- Unknown question: the asker's thread is stored, redacted --------------
    reportTelegramModule.sendReport = async () => ({ ok: false, skipped: true });
    const unknownTitle = `E2E unknown ${run}`;
    const unknownThread = [
      'User: how do I move my chat history to a new phone?',
      'AI: I could not confirm that from the Chatgram knowledge.',
      'User: my email is thread-test@example.com and my number is 0788123456',
    ].join('\n');
    const unknownReport = await reportsModule.handleModelReport({
      text: `[[CHATGRAM_REPORT]]${JSON.stringify({ type: 'unknown_question', title: unknownTitle, summary: 'Unknown Chatgram question', includeConversation: true })}[[/CHATGRAM_REPORT]]`,
      context: {
        userText: 'how do I move my chat history to a new phone?',
        source: 'Group: E2E REPORT',
        askerId: alice.user.id,
        askerName: alice.user.displayName,
        transcript: unknownThread,
        fixPromptChat: async () => ({ text: FIX_PROMPT_MOCK }),
      },
    });
    if (unknownReport.report?._id) created.reports.push(unknownReport.report._id);
    const unknownRows = await db.collection('admininboxes').find({ title: unknownTitle }).toArray();
    check('an unknown question creates exactly one AdminInbox record', unknownRows.length === 1, unknownRows.length);
    const storedTranscript = String(unknownReport.report?.transcript || '');
    check(
      'the unknown question stores the asker thread transcript',
      /move my chat history/i.test(storedTranscript) && /could not confirm/i.test(storedTranscript),
      storedTranscript.slice(0, 100),
    );
    check(
      'the stored thread is redacted (email/phone)',
      !/thread-test@example\.com|0788123456/.test(storedTranscript) && /redacted-(?:email|phone)/.test(storedTranscript),
      storedTranscript.slice(0, 140),
    );
    check('an unknown question does not get a code fix prompt', !unknownReport.report?.fixPrompt);

    reportTelegramModule.sendReport = savedTelegram.sendReport;
    reportTelegramModule.isEnabled = savedTelegram.isEnabled;
  } finally {
    // Cleanup: exact ids created by this run only. The Chatgram AI account is a
    // shared system account and is kept.
    reportTelegramModule.sendReport = savedTelegram.sendReport;
    reportTelegramModule.isEnabled = savedTelegram.isEnabled;
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
    if (created.reports.length) {
      await db.collection('admininboxes').deleteMany({ _id: { $in: created.reports } }).catch(() => {});
    }
    // Belt and braces: every report this run created carries the run token.
    await db.collection('admininboxes').deleteMany({ title: new RegExp(run) }).catch(() => {});
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
