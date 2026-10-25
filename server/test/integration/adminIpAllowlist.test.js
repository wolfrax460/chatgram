/**
 * 9a IP allowlist: off by default, lockout safety check, exact + CIDR matching,
 * blocking of other networks (API and sign-in), CSRF and auth gates.
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/adminIpAllowlist.test.js
 */
const mongoose = require('mongoose');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const ALLOWED_IP = '203.0.113.10';
const CIDR_IP = '198.51.100.77';
const BLOCKED_IP = '192.0.2.9';

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

async function api(method, route, { body, headers, token, ip } = {}) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(ip ? { 'X-Forwarded-For': ip } : {}),
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

async function adminLogin(ip) {
  const response = await fetch(`${API}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ip ? { 'X-Forwarded-For': ip } : {}) },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const payload = await response.json().catch(() => ({}));
  const cookie = (response.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; ');
  return { status: response.status, body: payload, headers: { Cookie: cookie, 'X-Admin-CSRF': payload.csrfToken } };
}

async function main() {
  console.log('\nadmin IP allowlist\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const AdminSecurity = require('../../src/models/AdminSecurity');
  await AdminSecurity.updateOne(
    { singleton: 'admin' },
    { $set: { ipAllowlistEnabled: false, ipAllowlist: [] } },
    { upsert: true },
  );

  const login = await adminLogin(ALLOWED_IP);
  check('admin login works from the first IP', login.status === 200 && Boolean(login.body.csrfToken), login.status);
  const headers = login.headers;

  try {
    const initial = await api('GET', '/api/admin/security', { headers, ip: ALLOWED_IP });
    check('the allowlist is off by default', initial.body.ipAllowlistEnabled === false, initial.body.ipAllowlistEnabled);
    check('the status reports the client IP', initial.body.currentIp === ALLOWED_IP, initial.body.currentIp);
    check('a normal user token is rejected', (await api('GET', '/api/admin/security', { token: 'fake-user-token', ip: ALLOWED_IP })).status === 401);
    check('saving the allowlist requires the CSRF header', (await api('PUT', '/api/admin/security/ip-allowlist', { headers: { Cookie: headers.Cookie }, ip: ALLOWED_IP, body: { enabled: false, ips: [] } })).status === 403);

    // Lockout safety check: enabling without the current IP is refused.
    const missingSelf = await api('PUT', '/api/admin/security/ip-allowlist', {
      headers,
      ip: ALLOWED_IP,
      body: { enabled: true, ips: ['198.51.100.5'] },
    });
    check('enabling without the current IP is refused', missingSelf.status === 400, missingSelf.status);
    check('the refusal explains the lockout risk', /lock you out/i.test(String(missingSelf.body?.message)), missingSelf.body?.message);

    const invalidEntry = await api('PUT', '/api/admin/security/ip-allowlist', {
      headers,
      ip: ALLOWED_IP,
      body: { enabled: false, ips: ['999.1.1.1'] },
    });
    check('invalid IP entries are rejected', invalidEntry.status === 400, invalidEntry.status);

    // Enable with the current IP plus a range.
    const enable = await api('PUT', '/api/admin/security/ip-allowlist', {
      headers,
      ip: ALLOWED_IP,
      body: { enabled: true, ips: ['203.0.113.10', '198.51.100.0/24'] },
    });
    check('enabling with the current IP works', enable.status === 200 && enable.body.ipAllowlistEnabled === true, enable.status);
    check('the saved list is normalized', JSON.stringify(enable.body.ipAllowlist) === JSON.stringify(['203.0.113.10', '198.51.100.0/24']), enable.body.ipAllowlist);

    check('the allowed exact IP can use the API', (await api('GET', '/api/admin/security', { headers, ip: ALLOWED_IP })).status === 200);
    check('an IP inside the allowed range can use the API', (await api('GET', '/api/admin/security', { headers, ip: CIDR_IP })).status === 200);
    const blocked = await api('GET', '/api/admin/security', { headers, ip: BLOCKED_IP });
    check('another network is blocked from the API', blocked.status === 403 && blocked.body.code === 'ADMIN_IP_BLOCKED', blocked.status);
    const blockedLogin = await adminLogin(BLOCKED_IP);
    check('another network cannot sign in', blockedLogin.status === 403 && blockedLogin.body.code === 'ADMIN_IP_BLOCKED', blockedLogin.status);

    // Disable from an allowed IP; the blocked IP works again.
    const disable = await api('PUT', '/api/admin/security/ip-allowlist', {
      headers,
      ip: ALLOWED_IP,
      body: { enabled: false, ips: ['203.0.113.10', '198.51.100.0/24'] },
    });
    check('the allowlist can be turned off from an allowed IP', disable.status === 200 && disable.body.ipAllowlistEnabled === false, disable.status);
    check('a previously blocked IP can sign in after turning it off', (await adminLogin(BLOCKED_IP)).status === 200);

    // Audit trail.
    const audit = await api('GET', '/api/admin/audit?search=admin_ip_allowlist&days=1', { headers, ip: ALLOWED_IP });
    check('allowlist changes are audited', (audit.body.entries || []).some((row) => row.action === 'admin_ip_allowlist_update'), (audit.body.entries || []).length);
  } finally {
    await AdminSecurity.updateOne({ singleton: 'admin' }, { $set: { ipAllowlistEnabled: false, ipAllowlist: [] } });
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', String((error && error.stack) || error).slice(0, 900));
  process.exit(1);
});
