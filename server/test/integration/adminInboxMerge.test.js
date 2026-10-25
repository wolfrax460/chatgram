/**
 * 9b Inbox merge-duplicates: identical questions/records fold into one row while
 * the duplicates stay as ignored audit records. Admin session only.
 *
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/adminInboxMerge.test.js
 */
const mongoose = require('mongoose');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const run = Date.now().toString(36);
const QUESTION = `How do I export my data ${run}?`;

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` -> ${JSON.stringify(detail).slice(0, 240)}` : ''}`);
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
  return { status: response.status, body: payload, text };
}

async function main() {
  console.log('\ninbox merge duplicates (9b)\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const { AdminInbox } = require('../../src/ai/chatgram');
  const AdminAudit = require('../../src/models/AdminAudit');

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

  const normalized = `how do i export my data ${run}`;
  const target = await AdminInbox.create({ type: 'chatgram_unknown', question: QUESTION, normalized, status: 'new', count: 1 });
  const duplicateA = await AdminInbox.create({ type: 'chatgram_unknown', question: QUESTION.toUpperCase(), normalized, status: 'new', count: 1 });
  const duplicateB = await AdminInbox.create({ type: 'chatgram_unknown', question: QUESTION, normalized, status: 'new', count: 2 });
  const unrelated = await AdminInbox.create({ type: 'chatgram_unknown', question: `Something else ${run}`, normalized: `something else ${run}`, status: 'new' });

  const listBefore = await api('GET', '/api/admin/ai/inbox?status=all&limit=100', { headers });
  const targetRow = (listBefore.body?.items || []).find((row) => row.id === String(target._id));
  check('the inbox shows how many duplicates a record has', listBefore.status === 200 && targetRow?.duplicateCount === 2, targetRow?.duplicateCount);
  check('unrelated records have no duplicate count', (listBefore.body?.items || []).find((row) => row.id === String(unrelated._id))?.duplicateCount === 0, null);

  const userMerge = await api('POST', `/api/admin/ai/inbox/${target._id}/merge`, { token: 'not-a-real-token', body: {} });
  check('a normal user token cannot merge inbox records', userMerge.status === 401, userMerge.status);

  const merged = await api('POST', `/api/admin/ai/inbox/${target._id}/merge`, { headers, body: {} });
  check('merging duplicates succeeds', merged.status === 200 && merged.body?.mergedCount === 3 && merged.body?.totalCount === 4, { status: merged.status, mergedCount: merged.body?.mergedCount, totalCount: merged.body?.totalCount });

  const afterA = await AdminInbox.findById(duplicateA._id).lean();
  const afterB = await AdminInbox.findById(duplicateB._id).lean();
  const afterTarget = await AdminInbox.findById(target._id).lean();
  check('duplicates are kept but marked ignored + mergedInto', afterA?.status === 'ignored' && String(afterA?.mergedInto) === String(target._id) && afterB?.status === 'ignored', { a: afterA?.status, b: afterB?.status });
  check('the target absorbs the duplicate occurrences', afterTarget?.count === 4, afterTarget?.count);
  check('an unrelated record is untouched', (await AdminInbox.findById(unrelated._id).lean())?.status === 'new', null);

  const mergeAgain = await api('POST', `/api/admin/ai/inbox/${target._id}/merge`, { headers, body: {} });
  check('merging again finds nothing and does not double-count', mergeAgain.status === 200 && mergeAgain.body?.mergedCount === 0, mergeAgain.body);

  const audit = await AdminAudit.findOne({ action: 'ai_inbox_merge', detail: new RegExp(String(target._id)) }).lean();
  check('merging is audited', Boolean(audit), null);

  // Cleanup.
  await AdminInbox.deleteMany({ _id: { $in: [target._id, duplicateA._id, duplicateB._id, unrelated._id] } });
  await AdminAudit.deleteMany({ detail: new RegExp(`${target._id}|${run}`) });

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error('inbox merge test crashed:', error);
  try { await mongoose.disconnect(); } catch { /* closed */ }
  process.exit(1);
});
