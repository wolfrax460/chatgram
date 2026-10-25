/**
 * 9b Users extras: device sessions + login history, verify email, warn, rename,
 * remove photo, delete-with-30-day-grace and cancel — admin session only.
 *
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/adminUsersExtras.test.js
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

async function main() {
  console.log('\nusers extras (9b)\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const User = require('../../src/models/User');
  const UserSession = require('../../src/models/UserSession');
  const LoginEvent = require('../../src/models/LoginEvent');
  const UserWarning = require('../../src/models/UserWarning');
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

  const identifier = `ux-${run}@chatgram.test`;
  const register = await api('POST', '/api/auth/register', { body: { displayName: `UserX ${run}`, identifier, password: 'UserX1!' } });
  const userId = register.body?.user?.id;
  check('test account registers', register.status === 201 && Boolean(userId), register.status);
  const userLogin = await api('POST', '/api/auth/login', { body: { identifier, password: 'UserX1!' } });
  check('the user can sign in (records a session)', userLogin.status === 200 && Boolean(userLogin.body?.accessToken), userLogin.status);
  const userToken = userLogin.body.accessToken;

  const forbidden = await api('GET', `/api/admin/users/${userId}/sessions`, { token: userToken });
  check('a normal user token cannot read sessions', forbidden.status === 401, forbidden.status);

  const sessions = await api('GET', `/api/admin/users/${userId}/sessions`, { headers });
  check('device sessions and login history are recorded', sessions.status === 200 && sessions.body?.sessions?.length >= 1 && sessions.body?.logins?.length >= 1, { status: sessions.status, sessions: sessions.body?.sessions?.length, logins: sessions.body?.logins?.length });
  check('session payloads contain no tokens or secrets', !/accessToken|refreshToken|passwordHash|totpSecret/i.test(sessions.text), null);
  const sessionsAudit = await AdminAudit.findOne({ action: 'admin_user_sessions_view', detail: String(userId) }).lean();
  check('viewing sessions is audited', Boolean(sessionsAudit), null);

  const verify = await api('POST', `/api/admin/users/${userId}/verify-email`, { headers, body: {} });
  check('email verification works', verify.status === 200, verify.status);
  const afterVerify = await api('GET', `/api/admin/users/${userId}`, { headers });
  check('the account shows as verified', Boolean(afterVerify.body?.user?.verifiedAt), afterVerify.body?.user?.verifiedAt);

  const badWarn = await api('POST', `/api/admin/users/${userId}/warn`, { headers, body: { reason: 'x' } });
  check('a too-short warning reason is rejected', badWarn.status === 400, badWarn.status);
  const warn = await api('POST', `/api/admin/users/${userId}/warn`, { headers, body: { reason: `Spam links in groups ${run}` } });
  check('a warning is recorded', warn.status === 200, warn.status);
  const afterWarn = await api('GET', `/api/admin/users/${userId}`, { headers });
  check('the warning count and reason appear on the detail', afterWarn.body?.user?.warningCount === 1 && (afterWarn.body?.warnings || [])[0]?.reason?.includes('Spam links'), { count: afterWarn.body?.user?.warningCount, warnings: afterWarn.body?.warnings });

  const rename = await api('PATCH', `/api/admin/users/${userId}/profile`, { headers, body: { displayName: `Renamed ${run}` } });
  check('the display name can be edited', rename.status === 200, rename.status);
  const badRename = await api('PATCH', `/api/admin/users/${userId}/profile`, { headers, body: { displayName: 'a' } });
  check('an invalid display name is rejected', badRename.status === 400, badRename.status);

  await User.updateOne({ _id: userId }, { $set: { avatarUrl: 'https://example.test/avatar.png' } });
  const removePhoto = await api('POST', `/api/admin/users/${userId}/remove-photo`, { headers, body: {} });
  const afterPhoto = await User.findById(userId).select('avatarUrl').lean();
  check('the profile photo can be removed', removePhoto.status === 200 && !afterPhoto?.avatarUrl, { status: removePhoto.status, avatar: afterPhoto?.avatarUrl });

  // Deletion: schedule -> blocked sign-in -> cancel -> sign-in works again.
  const scheduled = await api('POST', `/api/admin/users/${userId}/delete`, { headers, body: {} });
  check('deletion can be scheduled with a 30-day grace', scheduled.status === 200 && Boolean(scheduled.body?.deletionScheduledAt), scheduled.status);
  const daysLeft = scheduled.body?.deletionScheduledAt ? Math.round((new Date(scheduled.body.deletionScheduledAt).getTime() - Date.now()) / 86400000) : 0;
  check('the grace period is about 30 days', daysLeft >= 29 && daysLeft <= 30, daysLeft);
  const blockedLogin = await api('POST', '/api/auth/login', { body: { identifier, password: 'UserX1!' } });
  check('a scheduled account cannot sign in', blockedLogin.status === 403 && blockedLogin.body?.code === 'ACCOUNT_DELETION_SCHEDULED', { status: blockedLogin.status, code: blockedLogin.body?.code });
  const cancelled = await api('POST', `/api/admin/users/${userId}/cancel-delete`, { headers, body: {} });
  check('the deletion can be cancelled', cancelled.status === 200, cancelled.status);
  const loginAgain = await api('POST', '/api/auth/login', { body: { identifier, password: 'UserX1!' } });
  check('the account works again after cancelling the deletion', loginAgain.status === 200, loginAgain.status);

  const audits = await AdminAudit.find({ detail: new RegExp(String(userId)) }).lean();
  const actions = new Set(audits.map((row) => row.action));
  check('every user action is audited', ['admin_user_verify_email', 'admin_user_warn', 'admin_user_rename', 'admin_user_remove_photo', 'admin_user_schedule_deletion', 'admin_user_cancel_deletion'].every((action) => actions.has(action)), [...actions]);

  // Cleanup.
  await UserSession.deleteMany({ userId });
  await LoginEvent.deleteMany({ userId });
  await UserWarning.deleteMany({ userId });
  await User.deleteOne({ _id: userId });
  await AdminAudit.deleteMany({ detail: new RegExp(String(userId)) });

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error('users extras test crashed:', error);
  try { await mongoose.disconnect(); } catch { /* closed */ }
  process.exit(1);
});
