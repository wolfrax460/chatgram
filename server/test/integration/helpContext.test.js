/**
 * PROJECT CONTEXT for the Help / Chatgram AI assistants.
 *
 *   node server/test/integration/helpContext.test.js
 *
 * Self-contained: a temporary database, a local OpenAI-compatible stub and an
 * isolated API on :5095. Verifies the snapshot contents, sanitisation, the
 * 5-minute cache, missing-KB degradation, the prompt budget and that the
 * injected prompt really reaches the provider on a Chatgram AI request.
 */
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const SERVER_ROOT = path.resolve(__dirname, '../..');
const DB = 'mongodb://127.0.0.1:27017/chatgram_helpcontext_test';
const PORT = 5095;
const run = Date.now().toString(36);
const FORBIDDEN = ['mongodb+srv', 'TELEGRAM_', 'GITHUB_TOKEN', 'NVIDIA_API_KEY', 'TURN_SECRET', 'duckdns.org', '84.12.64.204'];

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 260)}` : ''}`);
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
        handler(req, res, body);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
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
async function api(method, route, { token, body } = {}) {
  const response = await fetch(`http://127.0.0.1:${PORT}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, body: payload };
}
function containsForbidden(text) {
  const value = String(text || '');
  return FORBIDDEN.some((literal) => value.includes(literal))
    || /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(value);
}

function spawnApi(aiBase) {
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(PORT),
    MONGODB_URI: DB,
    JWT_SECRET: 'help-context-test-jwt-secret-0123456789',
    JWT_REFRESH_SECRET: 'help-context-test-refresh-0123456789',
    REQUIRE_VERIFICATION: 'false',
    DEV_SHOW_CODES: 'true',
    AUTH_RATE_LIMIT_DISABLED: 'true',
    HELP_RATE_LIMIT_DISABLED: 'true',
    EMAIL_ENABLED: 'false',
    EMAIL_PROVIDER: 'console',
    SMS_PROVIDER: 'console',
    SUPPORT_AI_LAYER: '',
    SUPPORT_AI_ENABLED: 'true',
    SUPPORT_AI_PROVIDER: 'custom',
    SUPPORT_AI_MODEL: 'context-test-model',
    SUPPORT_AI_BASE_URL: `${aiBase}/v1`,
    SUPPORT_AI_API_KEY: 'context-test-key-123456789012',
    NVIDIA_API_KEY: '',
    HELP_KB_PATH: '',
  };
  const child = spawn(process.execPath, ['src/server.js'], { cwd: SERVER_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  return { child, output: () => output };
}

async function register() {
  const identifier = `help-context-${run}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await api('POST', '/api/auth/register', {
    body: { displayName: `Context User ${run}`, identifier, password: 'HelpContext1!' },
  });
  if (res.status !== 201) throw new Error(`register: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.accessToken;
}

async function main() {
  console.log('\nhelp/AI project context\n');
  await mongoose.connect(DB, { serverSelectionTimeoutMS: 5000 });
  const AppRelease = require('../../src/models/AppRelease');
  const inbox = mongoose.connection.collection('admininboxes');
  const createdInboxIds = [];

  // Season the database BEFORE the API boots so its boot-time warm-up sees it.
  await AppRelease.deleteMany({});
  await AppRelease.create([
    { platform: 'windows', version: '9.9.9', published: true, withdrawn: false, sizeBytes: 12 * 1024 * 1024, fileUrl: 'https://chatgram-xi.vercel.app/downloads/chatgram-windows-setup.exe', releaseNotes: 'Windows context release', releasedAt: new Date() },
    { platform: 'android', version: '8.8.8', published: true, withdrawn: false, sizeBytes: 4 * 1024 * 1024, releaseNotes: 'Android context release', releasedAt: new Date(Date.now() - 3600000) },
    { platform: 'web', version: '7.7.7', published: true, withdrawn: false, releaseNotes: 'Web context release', releasedAt: new Date(Date.now() - 7200000) },
  ]);
  const inserted = await inbox.insertMany([
    { type: 'feature_request', title: `Known request: dark mode ${run}`, question: 'ignored reporter text', status: 'new', normalized: `ctx-${run}-1`, count: 1, createdAt: new Date(), lastSeenAt: new Date() },
    { type: 'error_report', title: `Known bug: call audio ${run}`, question: 'ignored reporter text', status: 'in_progress', normalized: `ctx-${run}-2`, count: 1, createdAt: new Date(), lastSeenAt: new Date() },
  ]);
  for (const id of Object.values(inserted.insertedIds)) createdInboxIds.push(id);

  const aiSystems = [];
  const aiStub = await startStub((req, res, body) => {
    if (!/\/chat\/completions$/.test(req.url || '')) return sendJson(res, 404, {});
    const system = body?.messages?.find((message) => message.role === 'system')?.content || '';
    aiSystems.push(system);
    return sendJson(res, 200, {
      choices: [{ message: { content: 'I can help with that from the project context.' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
  });
  const aiBase = `http://127.0.0.1:${aiStub.address().port}`;
  const app = spawnApi(aiBase);

  const projectContext = require('../../src/help/projectContext');
  try {
    const ready = await waitFor(async () => {
      const health = await api('GET', '/api/health').catch(() => null);
      return health?.body?.database === 'connected';
    });
    check('the isolated API boots with the context provider', Boolean(ready), app.output().slice(-300));
    if (!ready) throw new Error('API did not boot');

    /* ------------------------------------------------ snapshot contents */
    projectContext.resetCacheForTests();
    const snapshot = await projectContext.getProjectContextText();
    check('the snapshot has the PROJECT CONTEXT header and rules', snapshot.includes('PROJECT CONTEXT') && /answer.*ONLY from this PROJECT CONTEXT/is.test(snapshot), snapshot.slice(0, 120));
    check('the snapshot contains the current released versions + sizes', snapshot.includes('windows 9.9.9') && snapshot.includes('android 8.8.8') && snapshot.includes('7.7.7') && /MB/.test(snapshot), snapshot.slice(0, 400));
    // AppRelease has one row per platform: flip the web row to prove exclusion.
    await AppRelease.updateOne({ platform: 'web' }, { $set: { withdrawn: true, version: '6.6.6', releasedAt: new Date() } });
    projectContext.resetCacheForTests();
    const withdrawnSnapshot = await projectContext.getProjectContextText();
    check('withdrawn releases are not in the snapshot', !withdrawnSnapshot.includes('6.6.6') && !withdrawnSnapshot.includes('7.7.7'), withdrawnSnapshot.slice(0, 300));
    await AppRelease.updateOne({ platform: 'web' }, { $set: { withdrawn: false, published: false, version: '5.5.5' } });
    projectContext.resetCacheForTests();
    const draftSnapshot = await projectContext.getProjectContextText();
    check('draft releases are not in the snapshot', !draftSnapshot.includes('5.5.5') && !draftSnapshot.includes('web 7.7.7'), draftSnapshot.slice(0, 300));
    await AppRelease.updateOne({ platform: 'web' }, { $set: { published: true, version: '7.7.7' } });
    projectContext.resetCacheForTests();
    check('the snapshot contains changelog entries', /CHANGELOG/.test(snapshot) && /wallpaper|voice notes|screen-share/i.test(snapshot), snapshot.slice(0, 600));
    check('the snapshot contains feature/how-to facts from the KB', /FEATURES \/ HOW-TO/.test(snapshot) && /smart reply|auto-reply|changelog/i.test(snapshot), snapshot.slice(0, 600));
    check('the snapshot contains open Inbox titles only', snapshot.includes(`Known request: dark mode ${run}`) && !snapshot.includes('ignored reporter text'), null);
    check('the rendered snapshot stays within the hard budget', snapshot.length <= projectContext.MAX_CONTEXT_CHARS, snapshot.length);
    check('the context prompt prefix stays under the budget', projectContext.withProjectContext('SYSTEM', snapshot).length <= projectContext.MAX_CONTEXT_CHARS + 10, projectContext.withProjectContext('SYSTEM', snapshot).length);

    /* -------------------------------------------------------- sanitising */
    check('the snapshot has no forbidden strings/emails/addresses', !containsForbidden(snapshot), containsForbidden(snapshot));
    const hostile = projectContext.sanitize(`mongodb+srv://x TELEGRAM_BOT_TOKEN GITHUB_TOKEN NVIDIA_API_KEY TURN_SECRET user@example.com https://x.duckdns.org 84.12.64.204 /home/ubuntu/chatgram server/src/help/secret.js`);
    check('the sanitizer removes secrets, emails, addresses and server paths', !containsForbidden(hostile) && !hostile.includes('/home/ubuntu') && !hostile.includes('server/src/'), hostile.slice(0, 160));

    /* ---------------------------------------------------------- caching */
    projectContext.resetCacheForTests();
    const first = await projectContext.getProjectContextText();
    const buildsAfterFirst = projectContext.stats.builds;
    const cached = await projectContext.getProjectContextText();
    check('the snapshot is built once and then served from memory', buildsAfterFirst === 1 && projectContext.stats.builds === 1 && cached === first && projectContext.stats.cacheHits >= 1, { builds: projectContext.stats.builds, hits: projectContext.stats.cacheHits });

    /* ---------------------------------------------- missing KB degrades */
    const previousKb = process.env.HELP_KB_PATH;
    process.env.HELP_KB_PATH = path.join(SERVER_ROOT, 'does-not-exist', `kb-${run}.md`);
    projectContext.resetCacheForTests();
    const withoutKb = await projectContext.getProjectContextText();
    check('a missing knowledge base still yields a usable snapshot (versions/changelog)', withoutKb.length > 0 && withoutKb.includes('9.9.9') && withoutKb.includes('CHANGELOG'), withoutKb.slice(0, 200));
    check('the missing-KB snapshot reports the KB unavailable without inventing content', withoutKb.includes('knowledge base unavailable') && !containsForbidden(withoutKb), null);
    if (previousKb === undefined) delete process.env.HELP_KB_PATH;
    else process.env.HELP_KB_PATH = previousKb;
    projectContext.resetCacheForTests();

    /* ------------------------------------- injection reaches the provider */
    const token = await register();
    const firstAi = await api('POST', '/api/ai/messages', { token, body: { text: "What's new in Chatgram, and is the mobile app updated?" } });
    const secondAi = await api('POST', '/api/ai/messages', { token, body: { text: 'How do I use auto-reply?' } });
    check('two Chatgram AI requests succeed', firstAi.status === 200 && secondAi.status === 200, [firstAi.status, secondAi.status]);
    check('the injected system prompt reaches the provider on every request', aiSystems.length >= 2, aiSystems.length);
    check('the provider system prompt contains the project context and current versions', aiSystems.every((system) => system.includes('PROJECT CONTEXT') && system.includes('9.9.9')), aiSystems.length);
    check('the provider system prompt contains no forbidden strings', aiSystems.every((system) => !containsForbidden(system)), null);
    check('the provider system prompt stays within a sane prompt budget', aiSystems.every((system) => system.length < 12000), aiSystems.map((system) => system.length));
  } finally {
    try { app.child.kill('SIGTERM'); } catch { /* ignore */ }
    await new Promise((resolve) => setTimeout(resolve, 800));
    await AppRelease.deleteMany({}).catch(() => {});
    await inbox.deleteMany({ _id: { $in: createdInboxIds } }).catch(() => {});
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
  console.error('help context test crashed:', String((error && error.stack) || error).slice(0, 1500));
  process.exit(1);
});
