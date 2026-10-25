/**
 * 9a admin TOTP: enrolment with QR, login gate, recovery codes (single use),
 * disable with password, regenerate codes, CSRF and auth gates.
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/adminTotp.test.js
 */
const mongoose = require('mongoose');

let authenticator;
try {
  ({ authenticator } = require('otplib'));
} catch {
  ({ authenticator } = require('../../server/node_modules/otplib'));
}

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only

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

async function api(method, route, { body, headers, token } = {}) {
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

async function adminLogin(password, code) {
  const response = await fetch(`${API}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(code === undefined ? { password } : { password, code }),
  });
  const payload = await response.json().catch(() => ({}));
  const cookie = (response.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; ');
  return { status: response.status, body: payload, headers: { Cookie: cookie, 'X-Admin-CSRF': payload.csrfToken } };
}

async function main() {
  console.log('\nadmin TOTP two-step\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const AdminSecurity = require('../../src/models/AdminSecurity');

  // Start from a clean, disabled state.
  await AdminSecurity.updateOne({ singleton: 'admin' }, { $set: { totpEnabled: false, totpSecret: '', recoveryCodes: [] } }, { upsert: true });

  let login = await adminLogin(ADMIN_PASSWORD);
  check('admin login works without a code while TOTP is off', login.status === 200 && Boolean(login.body.csrfToken), login.status);
  const headers = login.headers;

  try {
    // Auth + CSRF gates.
    check('GET /api/admin/security requires the admin session', (await api('GET', '/api/admin/security')).status === 401);
    check('GET /api/admin/security rejects a normal user token', (await api('GET', '/api/admin/security', { token: 'fake-user-token' })).status === 401);
    const noCsrf = await api('POST', '/api/admin/security/totp/start', { headers: { Cookie: headers.Cookie }, body: {} });
    check('starting enrolment requires the CSRF header', noCsrf.status === 403, noCsrf.status);

    const initial = await api('GET', '/api/admin/security', { headers });
    check('security status reports TOTP off', initial.body.totpEnabled === false, initial.body);

    // Enrolment: QR + secret, wrong code rejected, valid code enables.
    const start = await api('POST', '/api/admin/security/totp/start', { headers, body: {} });
    check('enrolment returns a secret and an otpauth URL', start.status === 200 && Boolean(start.body.secret) && String(start.body.otpauth).startsWith('otpauth://totp/'), start.status);
    check('enrolment returns a QR image data URL', String(start.body.qr).startsWith('data:image/png;base64,'), String(start.body.qr).slice(0, 30));
    const secret = start.body.secret;
    const wrongEnable = await api('POST', '/api/admin/security/totp/enable', { headers, body: { code: '000000' } });
    check('a wrong enrolment code is rejected', wrongEnable.status === 400, wrongEnable.status);
    const enable = await api('POST', '/api/admin/security/totp/enable', { headers, body: { code: authenticator.generate(secret) } });
    check('a valid code enables TOTP', enable.status === 200 && enable.body.totpEnabled === true, enable.status);
    check('ten single-use recovery codes are returned once', Array.isArray(enable.body.recoveryCodes) && enable.body.recoveryCodes.length === 10, enable.body.recoveryCodes?.length);
    const recoveryCodes = enable.body.recoveryCodes;

    const enabledStatus = await api('GET', '/api/admin/security', { headers });
    check('security status reports TOTP on with 10 codes', enabledStatus.body.totpEnabled === true && enabledStatus.body.recoveryCodesRemaining === 10, enabledStatus.body);
    check('the secret is never returned by the status endpoint', !enabledStatus.text.includes(secret), 'secret leaked');

    // Login gate.
    const missingCode = await adminLogin(ADMIN_PASSWORD);
    check('login without a code now returns ADMIN_TOTP_REQUIRED', missingCode.status === 401 && missingCode.body.code === 'ADMIN_TOTP_REQUIRED', missingCode.body?.code);
    const wrongCode = await adminLogin(ADMIN_PASSWORD, '000000');
    check('a wrong login code returns ADMIN_TOTP_INVALID', wrongCode.status === 401 && wrongCode.body.code === 'ADMIN_TOTP_INVALID', wrongCode.body?.code);
    const withCode = await adminLogin(ADMIN_PASSWORD, authenticator.generate(secret));
    check('login with a valid code works', withCode.status === 200 && Boolean(withCode.body.csrfToken), withCode.status);

    // Recovery codes work exactly once.
    const withRecovery = await adminLogin(ADMIN_PASSWORD, recoveryCodes[0]);
    check('a recovery code works at login', withRecovery.status === 200, withRecovery.status);
    const reused = await adminLogin(ADMIN_PASSWORD, recoveryCodes[0]);
    check('the same recovery code cannot be used twice', reused.status === 401 && reused.body.code === 'ADMIN_TOTP_INVALID', reused.body?.code);
    const afterRecovery = await api('GET', '/api/admin/security', { headers: withCode.headers });
    check('a used recovery code is consumed', afterRecovery.body.recoveryCodesRemaining === 9, afterRecovery.body.recoveryCodesRemaining);

    // Regenerate codes with the password.
    const regenerate = await api('POST', '/api/admin/security/recovery-codes', { headers: withCode.headers, body: { password: ADMIN_PASSWORD } });
    check('recovery codes can be regenerated with the password', regenerate.status === 200 && regenerate.body.recoveryCodes.length === 10, regenerate.status);
    check('the old recovery codes stop working', (await adminLogin(ADMIN_PASSWORD, recoveryCodes[1] ?? 'AAAA-BBBB')).status === 401);

    // Disable requires password and a valid code.
    const wrongPassword = await api('POST', '/api/admin/security/totp/disable', { headers: withCode.headers, body: { password: 'not-the-password', code: authenticator.generate(secret) } });
    check('disabling with a wrong password is rejected', wrongPassword.status === 401, wrongPassword.status);
    const wrongDisableCode = await api('POST', '/api/admin/security/totp/disable', { headers: withCode.headers, body: { password: ADMIN_PASSWORD, code: '000000' } });
    check('disabling with a wrong code is rejected', wrongDisableCode.status === 400, wrongDisableCode.status);
    const disabled = await api('POST', '/api/admin/security/totp/disable', { headers: withCode.headers, body: { password: ADMIN_PASSWORD, code: authenticator.generate(secret) } });
    check('disabling with password + code works', disabled.status === 200 && disabled.body.totpEnabled === false, disabled.status);
    const afterDisable = await adminLogin(ADMIN_PASSWORD);
    check('login works without a code again after disabling', afterDisable.status === 200, afterDisable.status);

    // Audit trail.
    const audit = await api('GET', '/api/admin/audit?search=admin_totp&days=1', { headers: afterDisable.headers });
    const actions = (audit.body.entries || []).map((row) => row.action);
    check('enrolment, recovery use and disable are audited', ['admin_totp_enable', 'admin_totp_recovery_used', 'admin_totp_disable'].every((action) => actions.includes(action)), actions.slice(0, 6));
  } finally {
    await AdminSecurity.updateOne({ singleton: 'admin' }, { $set: { totpEnabled: false, totpSecret: '', recoveryCodes: [] } });
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', String((error && error.stack) || error).slice(0, 900));
  process.exit(1);
});
