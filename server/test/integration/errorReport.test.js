/**
 * Help tab "Errors": AI-turned error/feature prompt.
 *
 *   node server/test/integration/errorReport.test.js
 *
 * Requires a staging API on E2E_API_URL (default http://127.0.0.1:5000) and the
 * same Mongo database in MONGODB_URI. Run it against an isolated API with AI
 * disabled (no SUPPORT_AI_* / NVIDIA_API_KEY) to exercise the deterministic
 * template fallback; the suite never calls a real provider.
 *
 * Covers: 401 unauthenticated, validation + length caps, one AdminInbox row of
 * type error_report with count++ on duplicates, bug vs feature classification on
 * the template path, required prompt sections, HTML escaping/sanitisation, and
 * that the response never 500s when AI is unavailable.
 */
const mongoose = require('mongoose');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging';
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
      displayName: `Error Report ${label} ${run}`,
      identifier: `error-report-${label}-${run}@chatgram.test`,
      password: 'ErrorReport1!',
    },
  });
  if (res.status !== 201) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken, id: res.body.user.id };
}

async function main() {
  console.log('\nerror report -> AI debugging/feature prompt\n');
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const { AdminInbox } = require('../../src/ai/chatgram');
  const User = require('../../src/models/User');

  const user = await register('a');
  const bugReport = {
    message: 'The app crashes every time I open the Calls tab after updating.',
    context: { appVersion: '1.2.3', platform: 'android', screen: 'Calls', lastAction: 'Tapped the Call button', errorCode: 'E_CALL' },
  };

  try {
    /* ------------------------------------------------------------- auth */
    const anonymous = await api('POST', '/api/help/error-report', { body: bugReport });
    check('an unauthenticated report is rejected with 401', anonymous.status === 401, anonymous.status);

    /* ------------------------------------------------------- validation */
    const missing = await api('POST', '/api/help/error-report', { token: user.token, body: {} });
    check('a missing message is rejected (400)', missing.status === 400, missing.status);
    const wrongType = await api('POST', '/api/help/error-report', { token: user.token, body: { message: 42 } });
    check('a non-string message is rejected (400)', wrongType.status === 400, wrongType.status);
    const tooLong = await api('POST', '/api/help/error-report', { token: user.token, body: { message: 'x'.repeat(2001) } });
    check('an oversized message is rejected (400)', tooLong.status === 400, tooLong.status);
    const badContext = await api('POST', '/api/help/error-report', { token: user.token, body: { message: 'The app crashes on the settings screen.', context: ['nope'] } });
    check('a non-object context is rejected (400)', badContext.status === 400, badContext.status);
    const unknownContext = await api('POST', '/api/help/error-report', {
      token: user.token,
      body: { message: 'The app crashes on the settings screen.', context: { message: 'other user text', token: 'secret' } },
    });
    check('unknown context fields are rejected (400)', unknownContext.status === 400 && unknownContext.body?.code === 'INVALID_CONTEXT', unknownContext.body);

    /* --------------------------------------------- bug report + Inbox row */
    const created = await api('POST', '/api/help/error-report', { token: user.token, body: bugReport });
    check('a valid bug report returns 200 (AI disabled -> template path)', created.status === 200, created.status);
    check('the report is classified as a bug', created.body?.kind === 'bug', created.body?.kind);
    check('the response carries an Inbox id', typeof created.body?.id === 'string' && created.body.id.length > 0, created.body?.id);
    const prompt = String(created.body?.prompt || '');
    const requiredSections = ['Title:', 'What happened:', 'Steps to reproduce:', 'Expected:', 'Actual:', 'Version:', 'Platform:', 'Acceptance criteria:', 'Ready-to-paste prompt:'];
    check('the prompt contains every required section', requiredSections.every((section) => prompt.includes(section)), requiredSections.filter((section) => !prompt.includes(section)));
    check('the prompt carries the app version and platform', prompt.includes('1.2.3') && prompt.includes('android'), prompt.slice(0, 160));
    check('the report summary is returned', String(created.body?.summary || '').startsWith('Bug report:'), created.body?.summary);
    check('the prompt is capped', prompt.length <= 6000, prompt.length);

    const normalizedPrefix = `error_report:${user.id}:`;
    const row = await AdminInbox.findOne({ _id: created.body.id }).lean();
    check('one AdminInbox row of type error_report is created', row?.type === 'error_report' && row?.status === 'new', row?.type);
    check('the row key is the per-user report hash', String(row?.normalized || '').startsWith(normalizedPrefix), String(row?.normalized || '').slice(0, 60));
    check('the row stores the user text and the generated prompt', String(row?.userText || '').includes('Calls tab') && row?.fixPrompt === prompt, Boolean(row?.fixPrompt));
    check('the row is attributed to the reporter', String(row?.askerId) === String(user.id), row?.askerId);
    check('the row count starts at 1', Number(row?.count) === 1, row?.count);

    /* ------------------------------------------------- duplicate reports */
    const duplicate = await api('POST', '/api/help/error-report', { token: user.token, body: bugReport });
    const duplicateRow = await AdminInbox.findById(created.body.id).lean();
    check('a duplicate report returns the same Inbox id', duplicate.body?.id === created.body.id, duplicate.body?.id);
    check('a duplicate report increments the same row (count 2)', Number(duplicateRow?.count) === 2, duplicateRow?.count);
    check('only one row exists for the duplicate', (await AdminInbox.countDocuments({ normalized: row?.normalized })) === 1, null);

    /* --------------------------------------------- feature classification */
    const feature = await api('POST', '/api/help/error-report', {
      token: user.token,
      body: { message: 'Please add a dark mode option to the settings screen.', context: { appVersion: '1.2.3', platform: 'web', screen: 'Settings' } },
    });
    check('a feature request is classified as a feature', feature.body?.kind === 'feature', feature.body?.kind);
    check('a feature summary is returned', String(feature.body?.summary || '').startsWith('Feature request:'), feature.body?.summary);
    check('the feature prompt keeps the required structure', ['Steps to reproduce:', 'Expected:', 'Actual:', 'Acceptance criteria:'].every((section) => String(feature.body?.prompt).includes(section)), null);

    /* ------------------------------------------------ sanitisation + caps */
    const hostile = await api('POST', '/api/help/error-report', {
      token: user.token,
      body: { message: '<script>alert("x")</script> app crashes\r\n\r\n\r\n on login \u0000', context: { platform: 'web' } },
    });
    const hostilePrompt = String(hostile.body?.prompt || '');
    check('markup in the report is escaped in the prompt', !hostilePrompt.includes('<script>') && hostilePrompt.includes('&lt;script&gt;'), hostilePrompt.slice(0, 160));
    const hostileRow = await AdminInbox.findById(hostile.body?.id).lean();
    check('markup is escaped in the stored row', !String(hostileRow?.userText || '').includes('<script>') && String(hostileRow?.userText || '').includes('&lt;script&gt;'), String(hostileRow?.userText || '').slice(0, 120));
    check('control characters are removed', !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(String(hostileRow?.userText || '')), null);

    /* ------------------------------------------------------ no 500 on AI */
    check('AI-disabled reports never return a 500', [created.status, duplicate.status, feature.status, hostile.status].every((status) => status === 200), [created.status, duplicate.status, feature.status, hostile.status]);
  } finally {
    // Cleanup this run's Inbox rows and user only.
    await AdminInbox.deleteMany({ type: 'error_report', normalized: new RegExp(`^error_report:${user.id}:`) }).catch(() => {});
    await User.deleteMany({ email: new RegExp(`^error-report-.+-${run}@chatgram\\.test$`) });
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('error report test crashed:', String((error && error.stack) || error).slice(0, 1000));
  process.exit(1);
});
