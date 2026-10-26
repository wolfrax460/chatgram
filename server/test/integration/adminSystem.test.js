/**
 * System health extras: MongoDB storage usage + allowlisted host diagnostics.
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/adminSystem.test.js
 *
 * Security focus: the endpoints require an admin session, the diagnostics
 * endpoint accepts only an allowlisted check id (never a command line), and
 * nothing in the responses leaks the database connection string.
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
    console.log(`  FAIL  ${name}${detail ? ` -> ${JSON.stringify(detail).slice(0, 220)}` : ''}`);
  }
}

async function api(method, route, { body, headers } = {}) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, body: payload, text };
}

async function main() {
  console.log('\nadmin system storage + diagnostics\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', {
    serverSelectionTimeoutMS: 5000,
  });
  const AdminAudit = require('../../src/models/AdminAudit');

  const login = await fetch(`${API}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const admin = await login.json();
  const headers = {
    Cookie: (login.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; '),
    'X-Admin-CSRF': admin.csrfToken,
  };
  check('admin login works', login.status === 200 && Boolean(admin.csrfToken), login.status);

  try {
    /* ------------------------------------------------------------ auth gates */
    for (const route of ['/api/admin/system/storage', '/api/admin/system/diagnostics']) {
      check(`GET ${route} requires the admin session`, (await api('GET', route)).status === 401);
    }
    check(
      'POST /api/admin/system/diagnostics/run requires the admin session',
      (await api('POST', '/api/admin/system/diagnostics/run', { body: { checkId: 'disk' } })).status === 401,
    );

    /* ------------------------------------------------------------- storage */
    const storage = await api('GET', '/api/admin/system/storage', { headers });
    check('storage returns 200', storage.status === 200, storage.status);
    const body = storage.body || {};
    check('storage reports the database name', typeof body.database === 'string' && body.database.length > 0, body.database);
    check(
      'storage reports used, limit and remaining bytes',
      Number.isFinite(body.usedBytes) && Number.isFinite(body.limitBytes) && Number.isFinite(body.remainingBytes) &&
        body.limitBytes > 0 && body.usedBytes >= 0 && body.remainingBytes >= 0,
      { used: body.usedBytes, limit: body.limitBytes, remaining: body.remainingBytes },
    );
    check('used never exceeds the reported limit', body.usedBytes <= body.limitBytes, {
      used: body.usedBytes,
      limit: body.limitBytes,
    });
    check(
      'percent used is a 0-100 number',
      typeof body.percentUsed === 'number' && body.percentUsed >= 0 && body.percentUsed <= 100,
      body.percentUsed,
    );
    check('remaining equals limit minus used', body.remainingBytes === Math.max(0, body.limitBytes - body.usedBytes), {
      remaining: body.remainingBytes,
    });
    check('storage lists collections with sizes', Array.isArray(body.collectionsTable) && body.collectionsTable.length > 0, body.collectionsTable?.length);
    const firstCollection = body.collectionsTable?.[0];
    check(
      'each collection row has a name and byte counts',
      Boolean(firstCollection) && typeof firstCollection.name === 'string' &&
        Number.isFinite(firstCollection.dataSizeBytes) && Number.isFinite(firstCollection.storageSizeBytes),
      firstCollection,
    );
    check('storage never returns the connection string', !/mongodb(\+srv)?:\/\//i.test(storage.text));
    check('storage never returns a password field', !/"password"/i.test(storage.text));

    /* --------------------------------------------------------- diagnostics */
    const list = await api('GET', '/api/admin/system/diagnostics', { headers });
    check('diagnostics list returns 200', list.status === 200, list.status);
    const checks = list.body?.checks ?? [];
    const ids = checks.map((row) => row.id);
    check('diagnostics list includes the disk check', ids.includes('disk'), ids);
    check('diagnostics list includes the PM2 check', ids.includes('pm2'), ids);
    check(
      'every check has an id, label and description',
      checks.every((row) => row.id && row.label && row.description),
      checks[0],
    );
    check(
      'the list does not expose command lines',
      !/(execFile|systemctl is-active \w+|pm2 logs)/.test(JSON.stringify(checks)),
      JSON.stringify(checks).slice(0, 160),
    );

    const run = await api('POST', '/api/admin/system/diagnostics/run', { headers, body: { checkId: 'disk' } });
    check('running the disk check returns 200', run.status === 200, run.status);
    check('the run reports which check ran', run.body?.id === 'disk', run.body?.id);
    check('the run returns text output', typeof run.body?.output === 'string' && run.body.output.length > 0, run.body?.output?.slice(0, 80));
    check(
      'the run reports timing and an exit code',
      typeof run.body?.durationMs === 'number' && (typeof run.body?.exitCode === 'number' || run.body?.exitCode === null),
      { durationMs: run.body?.durationMs, exitCode: run.body?.exitCode },
    );
    check('the run never returns the connection string', !/mongodb(\+srv)?:\/\//i.test(run.text));

    /* ------------------------------------------------- command injection */
    const shellAttempt = await api('POST', '/api/admin/system/diagnostics/run', {
      headers,
      body: { checkId: 'rm -rf /' },
    });
    check('a shell command is rejected with 400', shellAttempt.status === 400, shellAttempt.status);
    check('the rejected command produces no output', !shellAttempt.body?.output);

    const unknown = await api('POST', '/api/admin/system/diagnostics/run', { headers, body: { checkId: 'not_a_check' } });
    check('an unknown check id is rejected with 404', unknown.status === 404, unknown.status);

    const objectId = await api('POST', '/api/admin/system/diagnostics/run', { headers, body: { checkId: { $ne: null } } });
    check('a non-string check id is rejected', objectId.status === 400, objectId.status);

    const missing = await api('POST', '/api/admin/system/diagnostics/run', { headers, body: {} });
    check('a missing check id is rejected with 400', missing.status === 400, missing.status);

    /* ------------------------------------------------------------- audit */
    await new Promise((resolve) => setTimeout(resolve, 300));
    const audited = await AdminAudit.findOne({ action: 'system_diagnostic' }).sort({ at: -1 }).lean();
    check('running a diagnostic is written to the audit log', Boolean(audited), audited?.detail);
    check('the audit detail names the check', Boolean(audited?.detail?.includes('disk')), audited?.detail);
    const rejected = await AdminAudit.findOne({ action: 'system_diagnostic_rejected' }).sort({ at: -1 }).lean();
    check('a rejected diagnostic is audited too', Boolean(rejected), rejected?.detail);
  } finally {
    await AdminAudit.deleteMany({ action: { $in: ['system_diagnostic', 'system_diagnostic_rejected'] } }).catch(() => {});
    await mongoose.disconnect().catch(() => {});
  }

  console.log(`\n${passed}/${passed + failures.length} checks passed`);
  if (failures.length > 0) {
    console.log('failed:', failures.join(', '));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('adminSystem test crashed:', error.message);
  process.exit(1);
});
