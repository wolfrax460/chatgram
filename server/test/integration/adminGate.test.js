/**
 * 9a legacy-guard removal proof: every /api/admin route is behind the admin
 * session (never a user token), and the old support-account/help admin routes
 * are gone.
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/adminGate.test.js
 */
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

async function call(method, route, { token, headers, body } = {}) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body || {}),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, body: payload };
}

/** Walk an Express router stack and return "METHOD /path" strings. */
function flattenRouter(router, prefix, out) {
  const stack = router?.stack || [];
  for (const layer of stack) {
    if (layer.route) {
      const path = String(layer.route.path || '');
      const full = `${prefix}${path === '/' ? '' : path}`.replace(/\/$/, '') || prefix;
      for (const method of Object.keys(layer.route.methods || {})) {
        if (method === '_all') continue;
        out.add(`${method.toUpperCase()} ${full}`);
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      // Nested router: the mount path is not stored on the layer, so this is
      // only used for top-level mounted routers below.
      flattenRouter(layer.handle, prefix, out);
    }
  }
  return out;
}

async function main() {
  console.log('\nadmin route gate + legacy guard removal\n');
  const routes = new Set();
  flattenRouter(require('../../src/routes/adminRoutes'), '/api/admin', routes);
  flattenRouter(require('../../src/routes/adminProviderRoutes'), '/api/admin/providers', routes);
  flattenRouter(require('../../src/routes/adminAiRoutes'), '/api/admin/ai', routes);
  flattenRouter(require('../../src/routes/adminSupportRoutes'), '/api/admin/support', routes);

  const list = [...routes].filter((entry) => !entry.endsWith('POST /api/admin/auth/login'));
  check('the admin surface was enumerated', list.length >= 40, list.length);

  const login = await fetch(`${API}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const loginBody = await login.json();
  const cookie = (login.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; ');
  const adminHeaders = { Cookie: cookie, 'X-Admin-CSRF': loginBody.csrfToken };
  check('admin login works', login.status === 200 && Boolean(loginBody.csrfToken), login.status);

  const anonymousAllowed = [];
  const userAllowed = [];
  for (const entry of list) {
    const [method, route] = entry.split(' ');
    const anonymous = await call(method, route);
    if (anonymous.status !== 401) anonymousAllowed.push(`${entry} -> ${anonymous.status}`);
    const asUser = await call(method, route, { token: 'fake-normal-user-token' });
    if (asUser.status !== 401) userAllowed.push(`${entry} -> ${asUser.status}`);
  }
  check('no admin route answers without a session', anonymousAllowed.length === 0, anonymousAllowed.slice(0, 6));
  check('no admin route accepts a user token', userAllowed.length === 0, userAllowed.slice(0, 6));

  // The CSRF requirement stays on state-changing routes when a session exists.
  const overview = await call('GET', '/api/admin/overview?days=7', { headers: adminHeaders });
  check('the admin session still works', overview.status === 200, overview.status);
  const noCsrf = await call('POST', '/api/admin/auth/logout-all', { headers: { Cookie: cookie } });
  check('admin writes still require the CSRF header', noCsrf.status === 403, noCsrf.status);

  // Legacy support-account guarded endpoints are gone.
  for (const legacy of [
    'GET /api/support/admin/tickets',
    'GET /api/support/admin/settings',
    'GET /api/help/admin/collections',
    'GET /api/help/admin/articles',
  ]) {
    const [method, route] = legacy.split(' ');
    const anonymous = await call(method, route);
    const withUser = await call(method, route, { token: 'fake-support-token' });
    check(`${legacy} is removed`, anonymous.status === 404 && withUser.status === 404, `${anonymous.status}/${withUser.status}`);
  }

  // The support operations now live under the admin session.
  const supportTickets = await call('GET', '/api/admin/support/tickets', { headers: adminHeaders });
  check('support operations moved under the admin session', supportTickets.status === 200, supportTickets.status);
  const helpCollections = await call('GET', '/api/admin/support/help/collections', { headers: adminHeaders });
  check('the help-centre editor moved under the admin session', helpCollections.status === 200, helpCollections.status);

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', String((error && error.stack) || error).slice(0, 900));
  process.exit(1);
});
