/**
 * 9b Users table bulk actions: suspend / restore / force-logout for a selection,
 * with official accounts skipped and everything audited. Admin session only.
 *
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/adminBulkUsers.test.js
 */
const mongoose = require('mongoose');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const run = Date.now().toString(36);

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

async function register(label) {
  const identifier = `bulk-${label}-${run}@chatgram.test`;
  const result = await api('POST', '/api/auth/register', { body: { displayName: `Bulk ${label} ${run}`, identifier, password: 'BulkTest1!' } });
  if (result.status !== 201) throw new Error(`register ${label}: ${result.status}`);
  return { user: result.body.user, token: result.body.accessToken };
}

async function main() {
  console.log('\nusers bulk actions (9b)\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const User = require('../../src/models/User');
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

  const a = await register('a');
  const b = await register('b');
  const ids = [a.user.id, b.user.id];

  const userTokenAsk = await api('POST', '/api/admin/users/bulk', { token: a.token, body: { action: 'force-logout', ids } });
  check('a normal user token cannot run bulk actions', userTokenAsk.status === 401, userTokenAsk.status);
  const noIds = await api('POST', '/api/admin/users/bulk', { headers, body: { action: 'suspend', ids: [] } });
  check('an empty selection is rejected', noIds.status === 400, noIds.status);
  const badAction = await api('POST', '/api/admin/users/bulk', { headers, body: { action: 'delete-everything', ids } });
  check('an unknown bulk action is rejected', badAction.status === 400, badAction.status);
  const noCsrf = await api('POST', '/api/admin/users/bulk', { headers: { Cookie: headers.Cookie }, body: { action: 'force-logout', ids } });
  check('bulk actions require the CSRF token', noCsrf.status === 403, noCsrf.status);

  const suspended = await api('POST', '/api/admin/users/bulk', { headers, body: { action: 'suspend', ids, days: 7, reason: 'Bulk test' } });
  check('bulk suspend updates the selected accounts', suspended.status === 200 && suspended.body?.changed === 2, suspended.body);
  const blocked = await api('GET', `/api/users/${a.user.id}`, { token: a.token });
  check('suspended accounts are blocked from the API', (blocked.status === 403 && blocked.body?.code === 'ACCOUNT_SUSPENDED') || (blocked.status === 401 && blocked.body?.code === 'SESSION_REVOKED'), { status: blocked.status, code: blocked.body?.code });
  const afterSuspend = await User.find({ _id: { $in: ids } }).select('status suspendedUntil moderationReason').lean();
  check('the suspension window and reason are stored', afterSuspend.every((row) => row.status === 'suspended' && row.suspendedUntil && row.moderationReason === 'Bulk test'), afterSuspend);

  const unbanned = await api('POST', '/api/admin/users/bulk', { headers, body: { action: 'unban', ids } });
  const afterUnban = await User.find({ _id: { $in: ids } }).select('status').lean();
  check('bulk restore clears the suspension', unbanned.status === 200 && afterUnban.every((row) => row.status === 'active'), afterUnban);

  const before = await User.find({ _id: { $in: ids } }).select('tokenVersion').lean();
  const forced = await api('POST', '/api/admin/users/bulk', { headers, body: { action: 'force-logout', ids } });
  const after = await User.find({ _id: { $in: ids } }).select('tokenVersion').lean();
  check('bulk force-logout bumps every session generation', forced.status === 200 && after.every((row, index) => row.tokenVersion === (before[index].tokenVersion || 0) + 1), { before, after });
  const revoked = await api('GET', `/api/users/${a.user.id}`, { token: a.token });
  check('the old token no longer works after a forced logout', revoked.status === 401, revoked.status);

  // Official accounts are skipped.
  const official = await User.create({ displayName: `Bulk Official ${run}`, email: `bulk-official-${run}@chatgram.test`, phone: `+25078${String(Date.now()).slice(-8)}`, password: 'BulkTest1!', isSupportAccount: true });
  const withOfficial = await api('POST', '/api/admin/users/bulk', { headers, body: { action: 'force-logout', ids: [official._id.toString(), a.user.id] } });
  check('official accounts are skipped by bulk actions', withOfficial.status === 200 && withOfficial.body?.skipped === 1 && withOfficial.body?.changed === 1, withOfficial.body);

  const audit = await AdminAudit.findOne({ action: 'admin_users_bulk', detail: /action=suspend/ }).lean();
  check('bulk actions are audited with the action and counts', Boolean(audit), null);

  // Cleanup.
  await User.deleteMany({ _id: { $in: [a.user.id, b.user.id, official._id] } });
  await AdminAudit.deleteMany({ action: 'admin_users_bulk', detail: new RegExp(run) });

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error('bulk users test crashed:', error);
  try { await mongoose.disconnect(); } catch { /* closed */ }
  process.exit(1);
});
