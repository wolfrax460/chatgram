/**
 * Integration test: POST /api/auth/change-password
 *
 * Runs against a real local API + MongoDB (never production). Start the API
 * first (see docs/local-staging.md), then:
 *
 *   cd server && node test/integration/changePassword.test.js
 *
 * BASE_URL defaults to http://127.0.0.1:5000.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

async function api(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const run = Date.now().toString(36);
const strong = 'Str0ngPassw0rd!';
const stronger = 'EvenStr0nger!42';

async function createUser(label) {
  const identifier = `cp-${label}-${run}@chatgram.test`;
  const res = await api('POST', '/api/auth/register', {
    body: { displayName: `ChangePassword ${label}`, identifier, password: strong },
  });
  if (res.status !== 201) {
    throw new Error(`register ${label} failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { identifier, token: res.body.accessToken, refresh: res.body.refreshToken, userId: res.body.user.id };
}

async function login(identifier, password) {
  return api('POST', '/api/auth/login', { body: { identifier, password } });
}

async function main() {
  console.log(`\nchange-password integration test against ${BASE}\n`);

  const health = await api('GET', '/api/health');
  check('API is healthy', health.status === 200, `got ${health.status}`);
  if (health.status !== 200) {
    console.log('Start the local API first (docs/local-staging.md).');
    process.exit(1);
  }

  const user = await createUser('main');
  const secondDevice = await login(user.identifier, strong);
  check('second device signed in', secondDevice.status === 200, `got ${secondDevice.status}`);
  const secondToken = secondDevice.body.accessToken;
  const secondRefresh = secondDevice.body.refreshToken;

  // -------------------------------------------------- current password check
  const wrongCurrent = await api('POST', '/api/auth/change-password', {
    token: user.token,
    body: { currentPassword: 'definitely-wrong', newPassword: stronger, confirmPassword: stronger },
  });
  check('wrong current password -> 400', wrongCurrent.status === 400, `got ${wrongCurrent.status}`);
  check(
    'wrong current password code is CURRENT_PASSWORD_INVALID',
    wrongCurrent.body?.code === 'CURRENT_PASSWORD_INVALID',
    JSON.stringify(wrongCurrent.body),
  );

  // ------------------------------------------------------- new password rules
  const weak = await api('POST', '/api/auth/change-password', {
    token: user.token,
    body: { currentPassword: strong, newPassword: 'short', confirmPassword: 'short' },
  });
  check('weak new password -> 400', weak.status === 400, `got ${weak.status}`);
  check('weak new password code is WEAK_PASSWORD', weak.body?.code === 'WEAK_PASSWORD', JSON.stringify(weak.body));
  check('weak new password lists the problems', Array.isArray(weak.body?.problems) && weak.body.problems.length > 0);

  const noDigit = await api('POST', '/api/auth/change-password', {
    token: user.token,
    body: { currentPassword: strong, newPassword: 'onlyletters', confirmPassword: 'onlyletters' },
  });
  check('password without a number -> 400 WEAK_PASSWORD', noDigit.body?.code === 'WEAK_PASSWORD', JSON.stringify(noDigit.body));

  const mismatch = await api('POST', '/api/auth/change-password', {
    token: user.token,
    body: { currentPassword: strong, newPassword: stronger, confirmPassword: 'Different1!' },
  });
  check('mismatched confirmation -> 400', mismatch.status === 400, `got ${mismatch.status}`);
  check('mismatch code is PASSWORD_MISMATCH', mismatch.body?.code === 'PASSWORD_MISMATCH', JSON.stringify(mismatch.body));

  const same = await api('POST', '/api/auth/change-password', {
    token: user.token,
    body: { currentPassword: strong, newPassword: strong, confirmPassword: strong },
  });
  check('reusing the current password -> 400 PASSWORD_UNCHANGED', same.body?.code === 'PASSWORD_UNCHANGED', JSON.stringify(same.body));

  const unauthenticated = await api('POST', '/api/auth/change-password', {
    body: { currentPassword: strong, newPassword: stronger },
  });
  check('unauthenticated change -> 401', unauthenticated.status === 401, `got ${unauthenticated.status}`);

  // ------------------------------------------------------------- happy path
  const changed = await api('POST', '/api/auth/change-password', {
    token: user.token,
    body: { currentPassword: strong, newPassword: stronger, confirmPassword: stronger },
  });
  check('valid change -> 200', changed.status === 200, `got ${changed.status} ${JSON.stringify(changed.body)}`);
  check('change returns a new access token', typeof changed.body?.accessToken === 'string' && changed.body.accessToken.length > 20);
  check('change returns a new refresh token', typeof changed.body?.refreshToken === 'string');
  check('change reports the email notice shape', typeof changed.body?.notified === 'object', JSON.stringify(changed.body?.notified));
  check(
    'response never echoes the password',
    !JSON.stringify(changed.body).includes(stronger),
  );

  const newToken = changed.body.accessToken;

  // --------------------------------------------- other sessions are signed out
  const oldTokenMe = await api('GET', '/api/auth/me', { token: user.token });
  check('token from before the change -> 401', oldTokenMe.status === 401, `got ${oldTokenMe.status}`);
  check('revoked code is SESSION_REVOKED', oldTokenMe.body?.code === 'SESSION_REVOKED', JSON.stringify(oldTokenMe.body));

  const secondMe = await api('GET', '/api/auth/me', { token: secondToken });
  check('other signed-in device -> 401', secondMe.status === 401, `got ${secondMe.status}`);

  const oldRefresh = await api('POST', '/api/auth/refresh', { body: { refreshToken: user.refresh } });
  check('old refresh token -> 401', oldRefresh.status === 401, `got ${oldRefresh.status}`);
  check('old refresh code is SESSION_REVOKED', oldRefresh.body?.code === 'SESSION_REVOKED', JSON.stringify(oldRefresh.body));

  const otherRefresh = await api('POST', '/api/auth/refresh', { body: { refreshToken: secondRefresh } });
  check('other device refresh token -> 401', otherRefresh.status === 401, `got ${otherRefresh.status}`);

  // ------------------------------------------ current device stays signed in
  const newMe = await api('GET', '/api/auth/me', { token: newToken });
  check('new access token works immediately', newMe.status === 200, `got ${newMe.status}`);

  const refreshed = await api('POST', '/api/auth/refresh', { body: { refreshToken: changed.body.refreshToken } });
  check('new refresh token rotates', refreshed.status === 200, `got ${refreshed.status}`);
  check('rotated tokens still work', refreshed.body?.accessToken?.length > 20);

  // --------------------------------------------------------- sign-in changes
  const oldLogin = await login(user.identifier, strong);
  check('old password no longer signs in', oldLogin.status === 401, `got ${oldLogin.status}`);
  const newLogin = await login(user.identifier, stronger);
  check('new password signs in', newLogin.status === 200, `got ${newLogin.status}`);

  // ------------------------------------------------------------ brute force
  const throttleUser = await createUser('throttle');
  let throttled = null;
  for (let attempt = 1; attempt <= 7; attempt += 1) {
    const res = await api('POST', '/api/auth/change-password', {
      token: throttleUser.token,
      body: { currentPassword: `wrong-${attempt}`, newPassword: stronger, confirmPassword: stronger },
    });
    if (res.status === 429) {
      throttled = { attempt, res };
      break;
    }
  }
  check('repeated wrong current passwords are throttled (429)', Boolean(throttled), 'never returned 429');
  check(
    'throttle response carries a retryAfter',
    Boolean(throttled && (throttled.res.body?.retryAfter > 0)),
    JSON.stringify(throttled?.res.body),
  );

  // --------------------------------------------------------------- cleanup
  try {
    const mongoose = require('mongoose');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', {
      serverSelectionTimeoutMS: 4000,
    });
    const User = require('../../src/models/User');
    await User.deleteMany({ email: new RegExp(`^cp-(main|throttle)-${run}@chatgram\\.test$`) });
    await mongoose.disconnect();
  } catch (error) {
    console.log(`  (cleanup skipped: ${error.message})`);
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', error);
  process.exit(1);
});
