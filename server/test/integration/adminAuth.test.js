/**
 * Admin panel access gate: password login, session cookie + CSRF, sessions list,
 * logout, change password and audit trail.
 *
 *   cd server && node test/integration/adminAuth.test.js
 *
 * Requires the local staging API with ADMIN_PANEL_PASSWORD_HASH set to
 * "staging-admin-password-123" (scripts/start-staging.ps1 does this).
 */
const { io } = require('socket.io-client');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';
const PASSWORD = 'staging-admin-password-123';
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

async function request(method, route, { body, cookie, csrf, bearer, headers = {} } = {}) {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { 'X-Admin-CSRF': csrf } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  return { status: response.status, body: json, setCookies, headers: response.headers };
}

function sessionCookie(result) {
  const cookie = (result.setCookies || []).find((value) => value.startsWith('chatgram_admin='));
  if (!cookie) return '';
  return cookie.split(';')[0];
}

async function main() {
  console.log(`\nadmin auth integration test against ${BASE}\n`);

  const unauth = await request('GET', '/api/admin/auth/session');
  check('unauthenticated session -> 401', unauth.status === 401, `${unauth.status}`);

  // A normal user JWT must never open the admin panel.
  const reg = await request('POST', '/api/auth/register', {
    body: { displayName: `Admin Test ${Date.now().toString(36)}`, identifier: `admin-test-${Date.now().toString(36)}@chatgram.test`, password: 'AdminUser1!' },
  });
  const userToken = reg.body?.accessToken;
  const userTries = await request('GET', '/api/admin/auth/session', { bearer: userToken });
  check('a normal user token is rejected -> 401', userTries.status === 401, `${userTries.status}`);

  const wrong = await request('POST', '/api/admin/auth/login', { body: { password: 'definitely-wrong' } });
  check('wrong password -> 401', wrong.status === 401, `${wrong.status}`);
  check('wrong password response has no hash', !JSON.stringify(wrong.body).includes('$2b$'), JSON.stringify(wrong.body).slice(0, 120));

  const login = await request('POST', '/api/admin/auth/login', { body: { password: PASSWORD } });
  check('correct password -> 200', login.status === 200, `${login.status} ${JSON.stringify(login.body).slice(0, 160)}`);
  check('login returns a CSRF token', typeof login.body?.csrfToken === 'string' && login.body.csrfToken.length > 20);
  const setCookie = (login.setCookies || []).join('; ');
  check('session cookie is HttpOnly', /HttpOnly/i.test(setCookie), setCookie.slice(0, 160));
  check('session cookie is SameSite=Strict', /SameSite=Strict/i.test(setCookie), setCookie.slice(0, 160));
  check('session cookie is Path=/', /Path=\//i.test(setCookie), setCookie.slice(0, 160));
  check('login response never contains the hash', !JSON.stringify(login.body).includes('$2b$'), JSON.stringify(login.body).slice(0, 120));
  const cookie = sessionCookie(login);
  const csrf = login.body?.csrfToken;

  const info = await request('GET', '/api/admin/auth/session', { cookie });
  check('session info loads with the cookie', info.status === 200 && info.body?.authenticated === true, `${info.status}`);
  check('session info returns the CSRF token', info.body?.csrfToken === csrf, `${info.status}`);

  const noCsrf = await request('POST', '/api/admin/auth/logout', { cookie });
  check('state change without CSRF -> 403', noCsrf.status === 403, `${noCsrf.status}`);

  const sessions = await request('GET', '/api/admin/auth/sessions', { cookie });
  check('sessions list loads', sessions.status === 200 && Array.isArray(sessions.body?.sessions), `${sessions.status}`);
  check('sessions list marks the current session', sessions.body?.sessions?.some((row) => row.current === true) === true);
  check('sessions list never exposes tokens', !JSON.stringify(sessions.body).toLowerCase().includes('tokenhash'));

  const audit = await request('GET', '/api/admin/auth/audit', { cookie });
  check('audit trail lists the failed login', audit.status === 200 && (audit.body?.entries || []).some((row) => row.action === 'login_failure'), `${audit.status}`);

  const logout = await request('POST', '/api/admin/auth/logout', { cookie, csrf });
  check('logout with CSRF -> 200', logout.status === 200, `${logout.status}`);
  const afterLogout = await request('GET', '/api/admin/auth/session', { cookie });
  check('session is invalid after logout -> 401', afterLogout.status === 401, `${afterLogout.status}`);

  // Re-login and log out every session.
  const login2 = await request('POST', '/api/admin/auth/login', { body: { password: PASSWORD } });
  const cookie2 = sessionCookie(login2);
  const csrf2 = login2.body?.csrfToken;
  const all = await request('POST', '/api/admin/auth/logout-all', { cookie: cookie2, csrf: csrf2 });
  check('logout-all -> 200', all.status === 200, `${all.status}`);
  const afterAll = await request('GET', '/api/admin/auth/session', { cookie: cookie2 });
  check('all sessions invalid after logout-all', afterAll.status === 401, `${afterAll.status}`);

  // Brute-force lockout is per IP (fresh X-Forwarded-For so the tests above are
  // not locked out).
  const ip = `10.9.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;
  let locked = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = await request('POST', '/api/admin/auth/login', {
      body: { password: 'wrong-again' },
      headers: { 'X-Forwarded-For': ip },
    });
    if (result.status === 429) {
      locked = result;
      break;
    }
  }
  check('repeated failures lock the IP out -> 429', Boolean(locked), String(locked?.status));
  check('lockout response explains retry delay', Number(locked?.body?.retryAfter) > 0, JSON.stringify(locked?.body));

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', error.message);
  process.exit(1);
});
