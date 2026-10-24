/**
 * Read-only dashboard pages: System health + Audit log endpoints.
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/adminHealthAudit.test.js
 */
const mongoose = require('mongoose');

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

async function api(method, route, { token, headers } = {}) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, body: payload, text };
}

async function main() {
  console.log('\nadmin system health + audit log\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const User = require('../../src/models/User');

  const login = await fetch(`${API}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const admin = await login.json();
  const headers = { Cookie: (login.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; '), 'X-Admin-CSRF': admin.csrfToken };
  check('admin login works', login.status === 200 && Boolean(admin.csrfToken), login.status);

  const user = await User.create({
    displayName: `HEALTH TEST ${Date.now().toString(36)}`,
    email: `health-test-${Date.now().toString(36)}@chatgram.test`,
    password: 'HealthTest1!',
  });

  try {
    // Authentication gates.
    for (const route of ['/api/admin/health', '/api/admin/audit']) {
      check(`GET ${route} requires the admin session`, (await api('GET', route)).status === 401);
      check(`GET ${route} rejects a normal user token`, (await api('GET', route, { token: 'not-an-admin' })).status === 401);
    }
    check('there is no write endpoint on the audit log', (await api('PUT', '/api/admin/audit', { headers })).status === 404);

    // System health payload.
    const health = await api('GET', '/api/admin/health', { headers });
    check('health returns 200', health.status === 200, health.status);
    check('health reports API uptime and version', typeof health.body?.api?.uptimeSeconds === 'number' && typeof health.body?.api?.version === 'string', health.body?.api);
    check('health reports memory', typeof health.body?.api?.memory?.rssBytes === 'number' && health.body.api.memory.rssBytes > 0);
    check('health reports the database state', health.body?.database?.state === 'connected', health.body?.database?.state);
    check('health reports socket counts', typeof health.body?.sockets?.connections === 'number' && typeof health.body?.sockets?.online === 'number');
    check('health reports the AI layer', typeof health.body?.ai?.degraded === 'boolean' && Array.isArray(health.body?.ai?.providers), health.body?.ai);
    check('health reports backup info (or null)', health.body?.backup === null || (typeof health.body.backup?.name === 'string' && typeof health.body.backup?.bytes === 'number'), health.body?.backup);
    check('health reports disk usage (or null)', health.body?.disk === null || typeof health.body?.disk?.totalBytes === 'number');
    check('health has a generated timestamp', Boolean(health.body?.generatedAt));

    // No secrets in the payload.
    const forbidden = ['mongodb+srv', 'MONGODB_URI', 'JWT_SECRET', 'AI_SETTINGS_SECRET', 'password', 'bcrypt', 'apiKey', 'sk-', 'Bearer '];
    const found = forbidden.filter((needle) => health.text.includes(needle));
    check('health never returns secrets', found.length === 0, found);

    // Audit log payload.
    const audit = await api('GET', '/api/admin/audit?limit=10', { headers });
    check('audit returns 200', audit.status === 200, audit.status);
    check('audit returns entries and pagination', Array.isArray(audit.body?.entries) && typeof audit.body?.total === 'number' && typeof audit.body?.pageCount === 'number', audit.body?.total);
    check('audit entries have action/detail/ip/at', (audit.body.entries || []).every((row) => typeof row.action === 'string' && typeof row.at === 'string' && 'detail' in row && 'ip' in row));
    check('audit respects the page size', (audit.body.entries || []).length <= 10);
    check('audit never contains secrets', !/mongodb\+srv|JWT_SECRET|AI_SETTINGS_SECRET|bcrypt|apiKey=/.test(audit.text));

    const search = await api('GET', '/api/admin/audit?search=login&limit=20', { headers });
    check('audit search returns only matching actions', (search.body.entries || []).every((row) => /login/i.test(row.action) || /login/i.test(row.detail || '')), (search.body.entries || []).map((row) => row.action).slice(0, 4));
    check('audit search reports a total', typeof search.body.total === 'number');

    const narrow = await api('GET', '/api/admin/audit?days=1&limit=5', { headers });
    check('audit supports a date window', narrow.status === 200 && narrow.body.days === 1, narrow.body?.days);

    // Today's login actions must be in the log (the login above was audited).
    const recent = await api('GET', '/api/admin/audit?search=login_success&days=1&limit=20', { headers });
    check('the admin login is audited', (recent.body.entries || []).length >= 1, (recent.body.entries || []).length);
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
