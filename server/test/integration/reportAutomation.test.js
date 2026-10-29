/**
 * Report automation (Options B+C): GitHub issue creation + owner Telegram commands.
 *
 *   node server/test/integration/reportAutomation.test.js
 *
 * Self-contained: starts local GitHub/Telegram stubs, two isolated API instances
 * (GitHub enabled/disabled) on free ports sharing MONGODB_URI, and uses the real
 * report endpoint. Nothing touches the network. The real Bot/GitHub tokens are
 * fake and asserted to never appear in an issue body or a Telegram reply.
 */
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const SERVER_ROOT = path.resolve(__dirname, '../..');
const DB = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging';
const run = Date.now().toString(36);
const GH_TOKEN = `ghp_${'A'.repeat(30)}`;
const BOT_TOKEN = '123456789:TEST-TOKEN-that-must-never-be-printed-12345';
const OWNER_CHAT = '111';
const SECRET = `webhook-secret-${run}`;
const EMAIL = `automation-${run}@example.test`;
const PHONE = '+250788123456';
const USER_TOKEN = `ghp_${'B'.repeat(24)}`;
const REPORT_TEXT = `App crashes when opening calls. Contact me at ${EMAIL} or ${PHONE}; my token is ${USER_TOKEN}`;

let passed = 0;
const failures = [];
const startedAt = new Date();
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 240)}` : ''}`);
  }
}
function containsPII(text) {
  const value = String(text || '');
  return value.includes(EMAIL) || value.includes(PHONE) || value.includes(USER_TOKEN) || value.includes(GH_TOKEN) || value.includes(BOT_TOKEN);
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

async function waitFor(fn, timeoutMs = 12000, intervalMs = 200) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const value = await fn();
    if (value) return value;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

function spawnApi(port, extraEnv) {
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(port),
    MONGODB_URI: DB,
    JWT_SECRET: 'automation-test-jwt-secret-0123456789',
    JWT_REFRESH_SECRET: 'automation-test-refresh-0123456789',
    REQUIRE_VERIFICATION: 'false',
    DEV_SHOW_CODES: 'true',
    AUTH_RATE_LIMIT_DISABLED: 'true',
    HELP_RATE_LIMIT_DISABLED: 'true',
    EMAIL_ENABLED: 'false',
    EMAIL_PROVIDER: 'console',
    SMS_PROVIDER: 'console',
    SUPPORT_AI_ENABLED: '',
    SUPPORT_AI_LAYER: '',
    SUPPORT_AI_PROVIDER: '',
    SUPPORT_AI_MODEL: '',
    SUPPORT_AI_BASE_URL: '',
    SUPPORT_AI_API_KEY: '',
    AI_PROVIDER: '',
    NVIDIA_API_KEY: '',
    ...extraEnv,
  };
  const child = spawn(process.execPath, ['src/server.js'], { cwd: SERVER_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  return { child, baseUrl, output: () => output };
}

async function api(baseUrl, method, route, { token, body, headers } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
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
  return { status: response.status, body: payload };
}

async function register(baseUrl) {
  const identifier = `automation-${run}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  const res = await api(baseUrl, 'POST', '/api/auth/register', {
    body: { displayName: `Automation ${run}`, identifier, password: 'Automation1!' },
  });
  if (res.status !== 201) throw new Error(`register: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken, id: res.body.user.id, email: identifier };
}

async function main() {
  console.log('\nreport automation (GitHub issues + Telegram commands)\n');
  await mongoose.connect(DB, { serverSelectionTimeoutMS: 5000 });
  const inboxRows = mongoose.connection.collection('admininboxes');
  const users = mongoose.connection.collection('users');

  const githubState = { mode: 'ok', calls: [], nextNumber: 1 };
  const telegramMessages = [];
  const githubServer = await startStub((req, res, body) => {
    if (req.method === 'POST' && /\/issues$/.test(req.url || '')) {
      githubState.calls.push(body);
      if (githubState.mode === 'fail') return sendJson(res, 403, { message: 'forbidden' });
      const number = githubState.nextNumber;
      githubState.nextNumber += 1;
      return sendJson(res, 201, { number, html_url: `https://github.test/owner/repo/issues/${number}` });
    }
    return sendJson(res, 404, {});
  });
  const telegramServer = await startStub((req, res, body) => {
    if (/\/getUpdates$/.test(req.url || '')) return sendJson(res, 200, { ok: true, result: [] });
    if (/\/sendMessage$/.test(req.url || '')) {
      telegramMessages.push(String(body.text || ''));
      return sendJson(res, 200, { ok: true, result: { message_id: telegramMessages.length } });
    }
    return sendJson(res, 404, {});
  });
  const ghBase = `http://127.0.0.1:${githubServer.address().port}`;
  const tgBase = `http://127.0.0.1:${telegramServer.address().port}`;
  const portA = 5091;
  const portB = 5092;

  const apiA = spawnApi(portA, {
    GITHUB_TOKEN: GH_TOKEN,
    GITHUB_REPO: 'owner/repo',
    GITHUB_ISSUES_ENABLED: 'true',
    GITHUB_API_BASE: ghBase,
    TELEGRAM_API_BASE: tgBase,
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_CHAT_ID: OWNER_CHAT,
    TELEGRAM_WEBHOOK_SECRET: SECRET,
  });
  const apiB = spawnApi(portB, {
    GITHUB_TOKEN: '',
    GITHUB_REPO: '',
    GITHUB_ISSUES_ENABLED: 'false',
    GITHUB_API_BASE: ghBase,
    TELEGRAM_API_BASE: tgBase,
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_CHAT_ID: '',
    TELEGRAM_WEBHOOK_SECRET: '',
    AI_REPORT_TELEGRAM: 'false',
  });

  const createdUserIds = [];
  const createdRowIds = [];
  try {
    const readyA = await waitFor(async () => (await api(apiA.baseUrl, 'GET', '/api/health').catch(() => null))?.body?.database === 'connected');
    const readyB = await waitFor(async () => (await api(apiB.baseUrl, 'GET', '/api/health').catch(() => null))?.body?.database === 'connected');
    check('both isolated APIs boot without a real GitHub/Telegram token', Boolean(readyA) && Boolean(readyB), { readyA, readyB, log: apiA.output().slice(-300) });
    if (!readyA || !readyB) throw new Error('API did not boot');

    const userA = await register(apiA.baseUrl);
    createdUserIds.push(userA.id);

    /* ------------------------------------------------ GitHub issue + notify */
    const first = await api(apiA.baseUrl, 'POST', '/api/help/error-report', {
      token: userA.token,
      body: { message: REPORT_TEXT, context: { appVersion: '1.0.0', platform: 'android', screen: 'Calls' } },
    });
    check('a new error report still succeeds with GitHub configured', first.status === 200, first.body);
    const firstRow = await waitFor(async () => {
      const row = await inboxRows.findOne({ _id: new mongoose.Types.ObjectId(first.body.id) });
      return row && row.githubIssueNumber ? row : null;
    });
    check('the GitHub issue is created and stored on the row', Boolean(firstRow?.githubIssueNumber) && /^https:\/\/github\.test\//.test(String(firstRow?.githubIssueUrl)), firstRow?.githubIssueNumber);
    check('exactly one GitHub call was made for the new report', githubState.calls.length === 1, githubState.calls.length);
    const issueBody = String(githubState.calls[0]?.body || '');
    check('the issue body contains the fenced prompt and metadata footer', /(?:```|~~~|~~~~)text/.test(issueBody) && issueBody.includes('Inbox:') && issueBody.includes('Kind: bug'), issueBody.slice(0, 120));
    check('the issue title is prefixed and capped', String(githubState.calls[0]?.title || '').startsWith('[report] ') && String(githubState.calls[0]?.title || '').length <= 90, githubState.calls[0]?.title);
    check('the issue labels are chatgram-report + bug', JSON.stringify(githubState.calls[0]?.labels || []) === JSON.stringify(['chatgram-report', 'bug']), githubState.calls[0]?.labels);
    check('the issue body contains no email, phone or token', !containsPII(issueBody), null);

    const alertMessages = await waitFor(async () => (telegramMessages.length >= 2 ? telegramMessages.slice() : null));
    check('the Telegram alert includes the GitHub issue url', alertMessages?.some((text) => text.includes('GitHub: #1') && text.includes('github.test')), alertMessages);
    check('the Telegram follow-up carries the ready-to-use prompt', alertMessages?.some((text) => /(?:```|~~~|~~~~)text/.test(text) && /Steps to reproduce|What happened/.test(text)), alertMessages);
    check('Telegram messages contain no email, phone or token', (alertMessages || []).every((text) => !containsPII(text)), null);

    /* --------------------------------------------- duplicate never re-creates */
    const duplicate = await api(apiA.baseUrl, 'POST', '/api/help/error-report', {
      token: userA.token,
      body: { message: REPORT_TEXT, context: { appVersion: '1.0.0', platform: 'android', screen: 'Calls' } },
    });
    check('a duplicate report returns the same inbox id', duplicate.status === 200 && duplicate.body?.id === first.body.id, duplicate.body?.id);
    const duplicateRow = await inboxRows.findOne({ _id: new mongoose.Types.ObjectId(first.body.id) });
    check('the duplicate increments count without a second issue', Number(duplicateRow?.count) === 2 && githubState.calls.length === 1, { count: duplicateRow?.count, calls: githubState.calls.length });

    /* ----------------------------------------------------- failure + retry */
    githubState.mode = 'fail';
    const failing = await api(apiA.baseUrl, 'POST', '/api/help/error-report', {
      token: userA.token,
      body: { message: 'Please add a dark mode option.', context: { platform: 'web' } },
    });
    check('the user request still succeeds when GitHub fails', failing.status === 200, failing.body);
    const failedRow = await waitFor(async () => {
      const row = await inboxRows.findOne({ _id: new mongoose.Types.ObjectId(failing.body.id) });
      return row?.githubError ? row : null;
    });
    check('the failure status is recorded on the row', String(failedRow?.githubError) === '403', failedRow?.githubError);
    check('a failed issue is not stored as created', !failedRow?.githubIssueNumber && !failedRow?.githubIssueUrl, failedRow?.githubIssueNumber);
    createdRowIds.push(String(failing.body.id));

    // Admin retry endpoint requires an admin session (401, or 503 when the admin
    // panel has no credentials configured on this isolated instance).
    const adminUnauth = await api(apiA.baseUrl, 'POST', `/api/admin/inbox/${failing.body.id}/github-issue`);
    check('the admin retry route is admin-only (not accessible unauthenticated)', [401, 403, 503].includes(adminUnauth.status), adminUnauth.status);

    // Same idempotent logic as the admin route (direct call, same database).
    process.env.GITHUB_API_BASE = ghBase;
    process.env.GITHUB_TOKEN = GH_TOKEN;
    process.env.GITHUB_REPO = 'owner/repo';
    process.env.GITHUB_ISSUES_ENABLED = 'true';
    const github = require('../../src/utils/githubIssues');
    githubState.mode = 'ok';
    const retry1 = await github.retryForInbox(String(failing.body.id));
    check('the retry creates the issue', retry1.ok === true && retry1.created === true && Boolean(retry1.url), retry1);
    const retry2 = await github.retryForInbox(String(failing.body.id));
    check('the retry is idempotent (no second GitHub call)', retry2.ok === true && retry2.created === false, retry2);
    check('only one additional GitHub call happened for the retry', githubState.calls.length === 3, githubState.calls.length);

    /* --------------------------------------------------------- webhook auth */
    const url = `${apiA.baseUrl}/api/telegram/webhook`;
    const noSecret = await api(apiA.baseUrl, 'POST', '/api/telegram/webhook', { body: { message: { text: '/help', chat: { id: Number(OWNER_CHAT) } } } });
    check('a missing webhook secret is rejected (401)', noSecret.status === 401, noSecret.status);
    const wrongSecret = await api(apiA.baseUrl, 'POST', '/api/telegram/webhook', {
      headers: { 'x-telegram-bot-api-secret-token': 'wrong-secret' },
      body: { message: { text: '/help', chat: { id: Number(OWNER_CHAT) } } },
    });
    check('a wrong webhook secret is rejected (401)', wrongSecret.status === 401, wrongSecret.status);

    /* ------------------------------------------------ owner commands */
    // Seed call_quality/push_failure rows so /inbox covers all three types.
    await inboxRows.insertMany([
      { type: 'call_quality', question: 'call quality', normalized: `call_quality:${run}`, summary: 'Bad audio', status: 'new', count: 1, createdAt: new Date(), lastSeenAt: new Date() },
      { type: 'push_failure', question: 'push failure', normalized: `push:${run}`, summary: 'Notification not delivered', status: 'new', count: 1, createdAt: new Date(), lastSeenAt: new Date() },
    ]).then((result) => { for (const id of Object.values(result.insertedIds)) createdRowIds.push(String(id)); }).catch(() => {});

    const conversationsBefore = telegramMessages.length;
    const foreign = await api(apiA.baseUrl, 'POST', '/api/telegram/webhook', {
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      body: { message: { text: '/inbox', chat: { id: 999 } } },
    });
    check('a foreign chat id is ignored (200, no reply)', foreign.status === 200 && foreign.body?.ignored === true && telegramMessages.length === conversationsBefore, foreign.body);
    await new Promise((resolve) => setTimeout(resolve, 300));
    check('a foreign chat id produced no Telegram message', telegramMessages.length === conversationsBefore, telegramMessages.length - conversationsBefore);

    const sentCount = telegramMessages.length;
    const inboxCmd = await api(apiA.baseUrl, 'POST', '/api/telegram/webhook', {
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      body: { message: { text: '/inbox', chat: { id: Number(OWNER_CHAT) } } },
    });
    check('/inbox command answers', inboxCmd.status === 200 && telegramMessages.length === sentCount + 1, inboxCmd.body);
    const inboxReply = telegramMessages[telegramMessages.length - 1];
    check('/inbox lists open reports with type and issue state', /error_report/.test(inboxReply) && (/call_quality|push_failure/.test(inboxReply)) && /GitHub #/.test(inboxReply), inboxReply.slice(0, 160));
    check('/inbox reply contains no email, phone or token', !containsPII(inboxReply), null);

    const promptCount = telegramMessages.length;
    const promptCmd = await api(apiA.baseUrl, 'POST', '/api/telegram/webhook', {
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      body: { message: { text: `/prompt ${first.body.id}`, chat: { id: Number(OWNER_CHAT) } } },
    });
    const promptReply = telegramMessages[promptCount] || '';
    check('/prompt returns the stored AI prompt in a fenced block', promptCmd.status === 200 && /(?:```|~~~|~~~~)text/.test(promptReply) && /Steps to reproduce|What happened/.test(promptReply), promptReply.slice(0, 120));
    check('/prompt reply contains no email, phone or token', !containsPII(promptReply), null);

    const issueCallsBefore = githubState.calls.length;
    const issueCount = telegramMessages.length;
    await api(apiA.baseUrl, 'POST', '/api/telegram/webhook', {
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      body: { message: { text: `/issue ${failing.body.id}`, chat: { id: Number(OWNER_CHAT) } } },
    });
    const issueReply = telegramMessages[issueCount] || '';
    check('/issue returns the existing GitHub issue url (no new call)', issueReply.includes('github.test') && githubState.calls.length === issueCallsBefore, issueReply.slice(0, 160));
    check('/issue reply contains no email, phone or token', !containsPII(issueReply), null);

    const unknownCount = telegramMessages.length;
    await api(apiA.baseUrl, 'POST', '/api/telegram/webhook', {
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      body: { message: { text: '/nope', chat: { id: Number(OWNER_CHAT) } } },
    });
    const unknownReply = telegramMessages[unknownCount] || '';
    check('an unknown command answers with help', /Unknown command/.test(unknownReply) && /\/inbox/.test(unknownReply), unknownReply.slice(0, 120));

    /* -------------------------------------------- GitHub disabled (API B) */
    const userB = await register(apiB.baseUrl);
    createdUserIds.push(userB.id);
    const callsBeforeB = githubState.calls.length;
    const disabled = await api(apiB.baseUrl, 'POST', '/api/help/error-report', {
      token: userB.token,
      body: { message: 'The app crashes on the settings screen.' },
    });
    check('the report endpoint works with GitHub disabled', disabled.status === 200, disabled.body);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const disabledRow = await inboxRows.findOne({ _id: new mongoose.Types.ObjectId(disabled.body.id) });
    check('GitHub disabled means no issue and no error on the row', !disabledRow?.githubIssueNumber && !disabledRow?.githubIssueUrl && !disabledRow?.githubError, disabledRow);
    check('GitHub disabled means no GitHub call was attempted', githubState.calls.length === callsBeforeB, githubState.calls.length);
    createdRowIds.push(String(disabled.body.id));

    /* ------------------------------------------- zero PII in every outbound */
    check('no issue body contains an email/phone/token', githubState.calls.every((call) => !containsPII(call.body)), null);
    check('no Telegram message contains an email/phone/token', telegramMessages.every((text) => !containsPII(text)), null);
    check('the issue body never contains the GitHub token', githubState.calls.every((call) => !String(call.body || '').includes(GH_TOKEN)), null);
  } finally {
    for (const entry of [apiA, apiB]) {
      try { entry.child.kill('SIGTERM'); } catch { /* ignore */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
    const ids = createdUserIds.filter(Boolean).map((id) => new mongoose.Types.ObjectId(id));
    await Promise.all([
      users.deleteMany({ _id: { $in: ids } }),
      inboxRows.deleteMany({ _id: { $in: createdRowIds.filter(Boolean).map((id) => new mongoose.Types.ObjectId(id)) } }),
      inboxRows.deleteMany({ createdAt: { $gte: startedAt }, type: { $in: ['error_report', 'call_quality', 'push_failure'] } }),
    ]).catch(() => {});
    await new Promise((resolve) => githubServer.close(resolve));
    await new Promise((resolve) => telegramServer.close(resolve));
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('report automation test crashed:', String((error && error.stack) || error).slice(0, 1500));
  process.exit(1);
});
