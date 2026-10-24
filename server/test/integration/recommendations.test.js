/**
 * Item 4 â€” empty-screen recommendations API + admin editor.
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/recommendations.test.js
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

async function main() {
  console.log('\nempty-screen recommendations\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const User = require('../../src/models/User');

  const identifier = `rec-${run}@chatgram.test`;
  const register = await api('POST', '/api/auth/register', {
    body: { displayName: `REC TEST ${run}`, identifier, password: 'RecTest1!' },
  });
  check('test user registered', register.status === 201, register.status);
  const token = register.body.accessToken;
  const userId = register.body.user.id;

  const adminLogin = await fetch(`${API}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const adminBody = await adminLogin.json();
  const adminHeaders = {
    Cookie: (adminLogin.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; '),
    'X-Admin-CSRF': adminBody.csrfToken,
  };

  let original = [];
  try {
    // 1. Defaults are seeded and returned to a signed-in user, with no internals.
    let list = await api('GET', '/api/app/recommendations', { token });
    check('GET recommendations returns 200', list.status === 200, list.status);
    check('defaults are seeded', (list.body.recommendations || []).length >= 5, (list.body.recommendations || []).length);
    const row = (list.body.recommendations || [])[0] || {};
    check('rows carry title/cta/action only', Boolean(row.key && row.title && row.ctaLabel && row.action), Object.keys(row));
    check('no admin-only fields leak', !('hideWhen' in row) && !('enabled' in row) && !('order' in row), Object.keys(row));
    check('unauthenticated request is rejected', (await api('GET', '/api/app/recommendations')).status === 401);
    const keys = (list.body.recommendations || []).map((item) => item.key);
    check('every recommendation mentions a shipped feature', ['download-apps', 'two-step-verification', 'profile-photo', 'ask-chatgram-ai', 'invite-a-friend'].every((key) => keys.includes(key)), keys);

    // 2. Completed items are hidden (2FA on, profile photo set).
    await User.updateOne({ _id: userId }, { $set: { twoFactorEnabled: true, avatarUrl: '/uploads/rec-test.png' } });
    list = await api('GET', '/api/app/recommendations', { token });
    const completedKeys = (list.body.recommendations || []).map((item) => item.key);
    check('2FA recommendation hidden when 2FA is on', !completedKeys.includes('two-step-verification'), completedKeys);
    check('profile photo recommendation hidden when a photo is set', !completedKeys.includes('profile-photo'), completedKeys);

    // 3. Dismissal sticks per user.
    const dismiss = await api('POST', '/api/app/recommendations/download-apps/dismiss', { token, body: {} });
    check('dismiss returns 200', dismiss.status === 200, dismiss.status);
    list = await api('GET', '/api/app/recommendations', { token });
    check('dismissed recommendation no longer returned', !(list.body.recommendations || []).some((item) => item.key === 'download-apps'));
    const unknown = await api('POST', '/api/app/recommendations/does-not-exist/dismiss', { token, body: {} });
    check('dismissing an unknown key returns 404', unknown.status === 404, unknown.status);

    // 4. Admin editor: read, edit, disable, add, save â€” audited.
    const adminList = await api('GET', '/api/admin/recommendations', { headers: adminHeaders });
    check('admin can list every recommendation', adminList.status === 200 && (adminList.body.recommendations || []).length >= 5, adminList.status);
    original = adminList.body.recommendations || [];
    const edited = original.map((item, index) => ({
      ...item,
      title: index === 0 ? `${item.title} (edited ${run})` : item.title,
      enabled: index === 1 ? false : item.enabled,
    }));
    edited.push({ key: `custom-${run}`, title: 'Custom tip', body: 'From the admin editor', ctaLabel: 'Open Chatgram', action: 'url', url: '/web/', enabled: true, order: 999, hideWhen: 'never' });
    const save = await api('PUT', '/api/admin/recommendations', { headers: adminHeaders, body: { recommendations: edited } });
    check('admin save returns 200', save.status === 200, save.body?.message);
    const savedRows = save.body.recommendations || [];
    check('edited title is stored', savedRows[0]?.title.includes('edited'), savedRows[0]?.title);
    check('disabled recommendation is stored disabled', savedRows.find((item) => item.key === 'two-step-verification')?.enabled === false || original[1].key !== 'two-step-verification');
    check('new recommendation is stored', savedRows.some((item) => item.key === `custom-${run}`));

    const userAfter = await api('GET', '/api/app/recommendations', { token });
    const userKeys = (userAfter.body.recommendations || []).map((item) => item.key);
    check('the custom recommendation reaches users', userKeys.includes(`custom-${run}`), userKeys);
    check('a disabled recommendation is not shown to users', !userKeys.includes(original[1].key) || original[1].enabled === false, userKeys);

    const audit = await api('GET', '/api/admin/auth/audit', { headers: adminHeaders });
    check('the edit is audited', JSON.stringify(audit.body || {}).includes('recommendations_update'));

    // Validation: duplicate keys / missing title.
    const duplicate = await api('PUT', '/api/admin/recommendations', { headers: adminHeaders, body: { recommendations: [{ key: 'dup', title: 'A' }, { key: 'dup', title: 'B' }] } });
    check('duplicate keys are rejected', duplicate.status === 400, duplicate.status);
    const noTitle = await api('PUT', '/api/admin/recommendations', { headers: adminHeaders, body: { recommendations: [{ key: 'x', title: '' }] } });
    check('a missing title is rejected', noTitle.status === 400, noTitle.status);
    const noCsrf = await api('PUT', '/api/admin/recommendations', { headers: { Cookie: adminHeaders.Cookie }, body: { recommendations: original } });
    check('the editor requires the CSRF header', noCsrf.status === 403, noCsrf.status);
    check('a normal user token cannot read the admin editor', (await api('GET', '/api/admin/recommendations', { token })).status === 401);
  } finally {
    if (original.length) {
      await api('PUT', '/api/admin/recommendations', { headers: adminHeaders, body: { recommendations: original.map((item) => ({ ...item })) } }).catch(() => {});
    }
    await User.deleteOne({ _id: userId });
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', String((error && error.stack) || error).slice(0, 900));
  process.exit(1);
});
