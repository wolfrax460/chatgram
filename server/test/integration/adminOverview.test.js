/**
 * Admin dashboard endpoints (Change 2): Overview KPIs/series and Users.
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/adminOverview.test.js
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
    console.log(`  FAIL  ${name}${detail ? ` -> ${JSON.stringify(detail).slice(0, 200)}` : ''}`);
  }
}

async function api(method, route, { token, body, headers } = {}) {
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
  return { status: response.status, body: payload };
}

async function adminSession() {
  const login = await fetch(`${API}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const body = await login.json();
  const cookie = (login.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; ');
  return { cookie, csrf: body.csrfToken, status: login.status };
}

async function main() {
  console.log('\nadmin dashboard API tests\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const User = require('../../src/models/User');
  const admin = await adminSession();
  check('admin login works', admin.status === 200 && Boolean(admin.csrf), admin.status);
  const headers = { Cookie: admin.cookie };

  const user = await User.create({
    displayName: `DASH TEST ${run}`,
    email: `dash-test-${run}@chatgram.test`,
    password: 'DashTest1!',
    twoFactorEnabled: true,
    twoFactorSecret: 'SHOULD-NOT-LEAK',
    recoveryCodes: ['HASHED-SHOULD-NOT-LEAK'],
  });

  try {
    // Authentication gate on every endpoint.
    for (const [method, route] of [
      ['GET', '/api/admin/overview'],
      ['GET', '/api/admin/users'],
      ['GET', `/api/admin/users/${user._id}`],
      ['POST', `/api/admin/users/${user._id}/force-logout`],
      ['POST', `/api/admin/users/${user._id}/reset-2fa`],
    ]) {
      const response = await api(method, route);
      check(`${method} ${route} rejects a request without an admin session`, response.status === 401, response.status);
    }

    // Overview payload.
    const overview = await api('GET', '/api/admin/overview', { headers });
    check('overview returns 200', overview.status === 200, overview.status);
    const kpis = overview.body?.kpis || {};
    const requiredKpis = ['usersTotal', 'newUsersToday', 'dailyActive', 'monthlyActive', 'messagesToday', 'groups', 'statuses', 'storageBytes', 'onlineNow', 'openTickets', 'inboxNew', 'aiRequestsToday'];
    check('overview has every KPI', requiredKpis.every((key) => typeof kpis[key] === 'number'), Object.keys(kpis));
    check('overview KPI values are non-negative', requiredKpis.every((key) => kpis[key] >= 0), kpis);
    check('overview has a 14-day signup series', Array.isArray(overview.body.series?.signups) && overview.body.series.signups.length === 14, overview.body.series?.signups?.length);
    check('overview has a messages series', Array.isArray(overview.body.series?.messages) && overview.body.series.messages.length === 14);
    check('overview has an active-users series', Array.isArray(overview.body.series?.activeUsers) && overview.body.series.activeUsers.length === 14);
    check('overview has AI usage per provider', Array.isArray(overview.body.series?.aiByProvider));

    // Users list: search, pagination, no secrets.
    const list = await api('GET', `/api/admin/users?search=${encodeURIComponent(`DASH TEST ${run}`)}`, { headers });
    check('users list returns 200', list.status === 200, list.status);
    const row = (list.body.users || []).find((candidate) => candidate.id === String(user._id));
    check('users search finds the account', Boolean(row), list.body.total);
    check('users rows never carry password or 2FA secrets', row && !('password' in row) && !('twoFactorSecret' in row) && !('recoveryCodes' in row), row && Object.keys(row));
    check('users rows expose the 2FA badge state', row?.twoFactorEnabled === true, row?.twoFactorEnabled);
    check('users list is paginated', typeof list.body.total === 'number' && typeof list.body.pageCount === 'number');

    const paged = await api('GET', '/api/admin/users?page=1&limit=2', { headers });
    check('page size is honoured', paged.status === 200 && (paged.body.users || []).length <= 2, (paged.body.users || []).length);

    // Detail page.
    const detail = await api('GET', `/api/admin/users/${user._id}`, { headers });
    check('user detail returns 200', detail.status === 200, detail.status);
    check('user detail has counters', ['messages', 'chats', 'groups', 'statuses', 'reportsAgainst', 'reportsMade'].every((key) => typeof detail.body?.counts?.[key] === 'number'), detail.body?.counts);
    check('user detail never leaks 2FA secrets', !JSON.stringify(detail.body).includes('SHOULD-NOT-LEAK'), 'secret found');
    check('missing user returns 404', (await api('GET', '/api/admin/users/5f0000000000000000000000', { headers })).status === 404);

    // Actions: force logout bumps tokenVersion, reset 2FA clears the flags.
    const logout = await api('POST', `/api/admin/users/${user._id}/force-logout`, { headers: { ...headers, 'X-Admin-CSRF': admin.csrf }, body: {} });
    check('force logout returns 200', logout.status === 200, logout.status);
    const afterLogout = await User.findById(user._id).select('tokenVersion').lean();
    check('force logout bumped the session generation', afterLogout.tokenVersion >= 1, afterLogout.tokenVersion);

    const reset = await api('POST', `/api/admin/users/${user._id}/reset-2fa`, { headers: { ...headers, 'X-Admin-CSRF': admin.csrf }, body: {} });
    check('reset 2FA returns 200', reset.status === 200, reset.status);
    const afterReset = await User.findById(user._id).select('twoFactorEnabled twoFactorSecret recoveryCodes').lean();
    check('reset 2FA disabled it and removed the secret', afterReset.twoFactorEnabled === false && !afterReset.twoFactorSecret && (afterReset.recoveryCodes || []).length === 0, afterReset);

    // CSRF is required for actions.
    const noCsrf = await api('POST', `/api/admin/users/${user._id}/force-logout`, { headers, body: {} });
    check('actions require the CSRF header', noCsrf.status === 403, noCsrf.status);

    // Audit rows were written for both actions.
    const auditResponse = await api('GET', '/api/admin/auth/audit', { headers });
    const auditText = JSON.stringify(auditResponse.body || {});
    check('admin actions are audited', auditText.includes('admin_user_force_logout') && auditText.includes('admin_user_reset_2fa'), auditText.slice(0, 160));
  } finally {
    await User.deleteOne({ _id: user._id });
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', String((error && error.stack) || error).slice(0, 900));
  process.exit(1);
});
